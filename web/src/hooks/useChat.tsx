/**
 * useChat — the chat engine. Drives the conversation with react-instantsearch's
 * `useChat` (transport/streaming/tools against Agent Studio) and exposes a
 * `UseChatResult` (turns + actions) that the UI components (`ChatPanel`/
 * `ChatMessage`/`SourcePills`) render from directly.
 *
 * Judge + cost need no wiring here: `ChatMessage`/`SegmentView` call `useJudge`
 * + `useCostRecording` per segment, so every segment gets its Confidence chip
 * and cost badge automatically.
 *
 * What this hook orchestrates:
 *  - Generic leg (one `useChat`), mapped to `ChatTurn[]` via `chatTurns`.
 *  - The classifier deep-dive OFFER: on the Generic answer's `onFinish`, call
 *    `classifyOffer` (the ACS-classifier-neural agent) and stamp
 *    `deepDiveOffered`/`deepDiveQuery`/`followUp` onto that turn.
 *  - The Technical deep-dive: a SECOND `useChat({type:'technical'})` run on user
 *    consent; its answer is grafted onto the turn as `segments[1]`. Finished
 *    technical answers are kept per-turn so several deep-dives coexist.
 *
 * Must be rendered inside an `<InstantSearch>` provider (`ChatApp` supplies it).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useChat as useChatCore, createDefaultTools } from 'react-instantsearch';
import { activeInstance } from '../config/active';
import { getEnvConfig } from '../lib/agents';
import { buildSegment, latestAssistant, messagesToTurns } from '../lib/chatTurns';
import {
  answerText,
  canClassify,
  questionFromMessages,
  rawHitsFromParts,
  type ChatMessageLike,
} from '../lib/chatMessage';
import { classifyOffer } from '../lib/classifier';
import { deriveOfferState } from '../lib/offer';
import { resetCostEntries } from '../lib/costStore';
import type { CompletionsConfig } from '../lib/agentStudio';
import type { ChatTurn, UseChatResult } from '../types';

// The search tool MUST be registered so the native Chat resolves the agent's
// server-side retrieval tool-call and reaches `ready` (an unregistered tool
// leaves the call pending → status stuck "streaming", hits never finalize —
// root-caused live). We render sources via ChatPanel/SourcePills, so the tool's
// own itemComponent renders nothing — it exists only to satisfy the contract.
const searchTool = createDefaultTools(() => <></>);

const { appId, searchKey } = getEnvConfig();
const classifierConfig: CompletionsConfig = {
  appId,
  searchKey,
  agentId: activeInstance.agents.classifier.id,
};

interface OfferState {
  deepDiveOffered: boolean;
  deepDiveQuery?: string;
  followUp?: string;
  deepDiveDeclined?: boolean;
}

/** Loose shape of react-instantsearch's `useChat`'s onFinish argument (ai-lite
 *  ChatOnFinishCallback) — only the fields we read. */
interface FinishArgs {
  message: ChatMessageLike;
  messages: ChatMessageLike[];
  isAbort?: boolean;
  isError?: boolean;
}

type ChatHookProps = Parameters<typeof useChatCore>[0];

export function useChat(): UseChatResult {
  const [offers, setOffers] = useState<Record<string, OfferState>>({});
  const [deepDiveTurnId, setDeepDiveTurnId] = useState<string | null>(null);
  const [technicalByTurn, setTechnicalByTurn] = useState<Record<string, ChatMessageLike>>({});
  // Synchronous mirror of the active deep-dive turn so the Technical leg's
  // onFinish closure records against the right turn even before state settles.
  const deepDiveTurnIdRef = useRef<string | null>(null);

  // Stable handler identities — react-instantsearch's `useChat` re-initializes its Chat
  // instance when props change identity, so an inline closure here would loop
  // ("Too many re-renders"). useCallback pins them.
  const onGenericFinish = useCallback(async (args: FinishArgs) => {
    const { message, messages, isAbort, isError } = args;
    const text = answerText(message.parts);
    const question = questionFromMessages(messages, message.id);
    if (!canClassify({ isAbort, isError, text, question })) return;
    try {
      const suggestions = await classifyOffer(classifierConfig, question, text, rawHitsFromParts(message.parts));
      const { deepDiveOffered, deepDiveQuery, followUp } = deriveOfferState(suggestions, question);
      setOffers((prev) => ({ ...prev, [message.id]: { deepDiveOffered, deepDiveQuery, followUp } }));
    } catch {
      /* classification hiccup → no offer this turn */
    }
  }, []);

  const onTechnicalFinish = useCallback((args: FinishArgs) => {
    const turnId = deepDiveTurnIdRef.current;
    if (turnId) setTechnicalByTurn((prev) => ({ ...prev, [turnId]: args.message }));
  }, []);

  const generic = useChatCore({
    agentId: activeInstance.agents.generic.id,
    tools: searchTool,
    onFinish: onGenericFinish,
  } as ChatHookProps);

  const technical = useChatCore({
    agentId: activeInstance.agents.technical.id,
    type: 'technical',
    tools: searchTool,
    onFinish: onTechnicalFinish,
  } as ChatHookProps);

  const turns = useMemo<ChatTurn[]>(() => {
    const base = messagesToTurns(generic.messages as unknown as ChatMessageLike[], generic.status);
    return base.map((turn) => {
      const offer = offers[turn.id];
      let t: ChatTurn = offer
        ? {
            ...turn,
            deepDiveOffered: offer.deepDiveOffered,
            deepDiveQuery: offer.deepDiveQuery,
            followUp: offer.followUp,
            deepDiveDeclined: offer.deepDiveDeclined,
          }
        : turn;

      // Grafted Technical segment: the settled (persisted) answer takes
      // precedence; otherwise, if this turn is the active deep-dive, the live
      // streaming one.
      const settled = technicalByTurn[turn.id];
      if (settled) {
        t = {
          ...t,
          segments: [t.segments[0], buildSegment(settled, false, 'ready', 'technical')],
          handoff: true,
          deepDiveOffered: false,
        };
      } else if (turn.id === deepDiveTurnId) {
        const live = latestAssistant(technical.messages as unknown as ChatMessageLike[]);
        t = {
          ...t,
          segments: [t.segments[0], buildSegment(live, true, technical.status, 'technical')],
          handoff: true,
          deepDiveOffered: false,
        };
      }
      return t;
    });
  }, [generic.messages, generic.status, offers, deepDiveTurnId, technicalByTurn, technical.messages, technical.status]);

  const isStreaming =
    generic.status === 'submitted' ||
    generic.status === 'streaming' ||
    technical.status === 'submitted' ||
    technical.status === 'streaming';

  const sendMessage = useCallback(
    async (query: string) => {
      generic.sendMessage({ text: query });
    },
    [generic],
  );

  const retryTurn = useCallback(async () => {
    generic.regenerate();
  }, [generic]);

  const runDeepDive = useCallback(
    async (turnId: string) => {
      const query = offers[turnId]?.deepDiveQuery;
      if (!query) return;
      deepDiveTurnIdRef.current = turnId;
      setDeepDiveTurnId(turnId);
      // Clear the technical leg's prior conversation so `latestAssistant`
      // tracks THIS deep-dive while it streams (the finished prior one is
      // already preserved in `technicalByTurn`).
      technical.setMessages([]);
      technical.sendMessage({ text: query });
    },
    [offers, technical],
  );

  const declineDeepDive = useCallback((turnId: string) => {
    setOffers((prev) => ({
      ...prev,
      [turnId]: { ...(prev[turnId] ?? { deepDiveOffered: false }), deepDiveDeclined: true },
    }));
  }, []);

  const reset = useCallback(() => {
    generic.setMessages([]);
    technical.setMessages([]);
    setOffers({});
    setTechnicalByTurn({});
    setDeepDiveTurnId(null);
    deepDiveTurnIdRef.current = null;
    resetCostEntries();
  }, [generic, technical]);

  return { turns, isStreaming, sendMessage, retryTurn, runDeepDive, declineDeepDive, reset };
}
