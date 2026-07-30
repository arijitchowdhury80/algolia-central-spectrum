/**
 * useChat — orchestrates the Primary → [offer? → Specialist] agent flow.
 *
 * After Primary answers, a classifier agent (if configured) decides whether to
 * offer a specialist deep-dive and which specialist to route to. Deep-dive is
 * human-gated: the specialist only runs when the user explicitly accepts.
 * Prior-turn answers are condensed into history entries so each agent call
 * stays within context limits.
 *
 * Agent config is read from the IS renderState via `useWidgetState()`, which
 * subscribes to the external store updated by the chat renderer on every IS
 * render pass. This means agent widgets registered after the initial mount
 * (e.g. child `<algolia-agent>` elements that connect later in the DOM
 * lifecycle) automatically propagate to the hook without remounting.
 *
 * Fallback: when renderState has no agents (e.g. no IS instance, legacy embed),
 * the hook falls back to `activeInstance.agents` for backward compat.
 *
 * Every agent in the flow is sent the host's visitor context — see
 * `config/visitorContext`. The answering agents (primary and specialist) get it
 * as a preamble on the question; the classifier gets the same JSON framed as
 * routing evidence (see `lib/classifier`).
 *
 * The classifier used to be excluded, on the reasoning that a deep-dive
 * decision has no bearing on browsing history. It does. Context reached the
 * classifier only transitively, inside the primary's answer, so it worked when
 * the context had visibly changed that answer and failed when it had not: a
 * visitor who had spent the session in implementation pages got no code
 * deep-dive whenever the primary happened to answer in design terms. Routing
 * was blind while the specialist it routed to was context-aware.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { callWithRetry, type CompletionsConfig } from '../shared/agentStudio';
import { classifyOffer, SPECIALIST_PREFIX, parseSpecialistLine } from './lib/classifier';
import { getAgentConfig } from '../shared/agents';
import { normalizeHit, groupSources, totalSources } from './lib/sources';
import { activeInstance } from '../config/active';
import { proactiveStore } from '../config/proactive';
import { composeVisitorMessage, visitorContextStore } from '../config/visitorContext';
import { useWidgetState } from './widgetContext';
import type { ChatAgentDescriptor } from '../connectAgent';
import type { AnswerSegment, AnswerSource, ChatTurn, HistoryEntry } from './types';

// ── Agent resolution ──────────────────────────────────────────────────────────

/**
 * Resolved agents built from the IS renderState. Mirrors AgentsConfig but
 * sources from `Record<string, ChatAgentDescriptor>` keyed by agentKey.
 */
interface ResolvedAgents {
  primary: ChatAgentDescriptor | undefined;
  classifier: ChatAgentDescriptor | undefined;
  specialists: ChatAgentDescriptor[];
}

function resolveAgents(contextAgents: Record<string, ChatAgentDescriptor>): ResolvedAgents {
  const keys = Object.keys(contextAgents);
  if (keys.length === 0) {
    // Fallback to activeInstance for backward compat (legacy embed without IS)
    const inst = activeInstance.agents;
    return {
      primary: inst.primary
        ? {
            role: 'primary',
            key: inst.primary.key,
            id: inst.primary.id,
            label: inst.primary.label,
            accentToken: inst.primary.accentToken,
          }
        : undefined,
      classifier: inst.classifier
        ? {
            role: 'classifier',
            key: inst.classifier.key,
            id: inst.classifier.id,
            label: inst.classifier.label,
            accentToken: inst.classifier.accentToken,
          }
        : undefined,
      specialists: inst.specialists.map((s) => ({
        role: 'specialist' as const,
        key: s.key,
        id: s.id,
        label: s.label,
        accentToken: s.accentToken,
      })),
    };
  }

  return {
    primary: contextAgents['primary'],
    classifier: contextAgents['classifier'],
    specialists: Object.values(contextAgents).filter((a) => a.role === 'specialist'),
  };
}

// ── Deep-dive helpers ─────────────────────────────────────────────────────────

interface OfferState {
  deepDiveOffered: boolean;
  followUp?: string;
  deepDiveQuery?: string;
  deepDiveSpecialist?: string;
}

/**
 * Resolve which agent answers this turn. A persona set by the host via
 * `setPersona()` takes precedence over the declared primary agent, so the
 * answering voice can be switched at runtime without remounting the widget.
 */
function resolveAnsweringAgentId(primaryId: string): string {
  return proactiveStore.getSnapshot().personaAgentId ?? primaryId;
}

function extractDeepDiveOffer(suggestions: string[]): {
  offer?: string;
  specialistKey?: string;
  rest: string[];
} {
  const idx = suggestions.findIndex((s) => s.trim().toUpperCase().startsWith('SPECIALIST:'));
  if (idx === -1) return { rest: suggestions };
  const line = suggestions[idx].trim();
  const { key } = parseSpecialistLine(line);
  return {
    offer: line.slice(SPECIALIST_PREFIX.length).trim(),
    specialistKey: key,
    rest: suggestions.filter((_, i) => i !== idx),
  };
}

/**
 * Resolve the specialist key from the classifier output against the configured
 * specialists. Falls back to the first specialist when the key is absent or
 * unknown — this lets single-specialist setups work without changing the
 * classifier agent's prompt.
 */
function resolveSpecialistKey(
  classifierKey: string | undefined,
  specialists: ChatAgentDescriptor[],
): string | undefined {
  if (!specialists.length) return undefined;
  if (!classifierKey) return specialists[0].key;
  const found = specialists.find((s) => s.key === classifierKey);
  return found ? found.key : specialists[0].key;
}

function deriveOfferState(
  suggestions: string[],
  turnQuery: string,
  specialists: ChatAgentDescriptor[],
): OfferState {
  const { offer, specialistKey, rest } = extractDeepDiveOffer(suggestions);
  if (!offer) return { deepDiveOffered: false, followUp: rest[0] };
  const resolvedKey = resolveSpecialistKey(specialistKey, specialists);
  return {
    deepDiveOffered: !!resolvedKey,
    followUp: rest[0],
    deepDiveQuery: resolvedKey ? turnQuery : undefined,
    deepDiveSpecialist: resolvedKey,
  };
}

interface OfferPatchInput {
  classifierConfig: CompletionsConfig;
  query: string;
  primaryAnswer: string;
  hits: Record<string, unknown>[];
  specialists: ChatAgentDescriptor[];
}

async function resolveOfferPatch({
  classifierConfig,
  query,
  primaryAnswer,
  hits,
  specialists,
}: OfferPatchInput): Promise<OfferState> {
  if (!primaryAnswer.trim()) return deriveOfferState([], query, specialists);

  let suggestions: string[] = [];
  try {
    // Read at call time, not at turn start: the visitor may have navigated
    // between the primary answering and this classification, and the page they
    // are on now is part of what makes a deep-dive worth offering.
    suggestions = await classifyOffer(
      classifierConfig,
      query,
      primaryAnswer,
      hits,
      visitorContextStore.read(),
    );
  } catch (err) {
    console.error('[useChat] classifier failed — no deep-dive offer this turn', err);
  }
  return deriveOfferState(suggestions, query, specialists);
}

// ── History helpers ───────────────────────────────────────────────────────────

/** Specialist history: user query and Primary's answer as separate entries. */
function buildSpecialistHistory(
  priorHistory: HistoryEntry[],
  query: string,
  primaryText: string,
): HistoryEntry[] {
  return [
    ...priorHistory,
    { role: 'user', content: query },
    { role: 'assistant', content: primaryText },
  ];
}

/** Truncate a text to a word boundary for safe history replay. */
function summarizeForHistory(text: string, maxLen = 240): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen - 2);
  const atBoundary = slice.replace(/\S*$/, '').trimEnd();
  if (atBoundary.length === 0) return text.slice(0, maxLen - 1) + '…';
  return atBoundary + ' …';
}

/** Summarize multiple answer segments for history, giving each its own budget. */
function summarizeSegmentsForHistory(texts: string[], maxLen = 240): string {
  if (texts.length === 0) return '';
  if (texts.length === 1) return summarizeForHistory(texts[0], maxLen);
  const sepBudget = (texts.length - 1) * 2;
  const budget = maxLen - sepBudget;
  const totalWeight = texts.length - 1 + 2;
  const unit = Math.floor(budget / totalWeight);
  return texts
    .map((t, i) => {
      const isLast = i === texts.length - 1;
      const segBudget = isLast ? budget - unit * (texts.length - 1) : unit;
      return summarizeForHistory(t, segBudget);
    })
    .join('\n\n');
}

function turnToHistory(t: ChatTurn): HistoryEntry[] {
  const answered = t.segments.filter((s) => s.status === 'success' && s.text.trim());
  if (answered.length === 0) return [];
  return [
    { role: 'user', content: t.query },
    { role: 'assistant', content: summarizeSegmentsForHistory(answered.map((s) => s.text)) },
  ];
}

function historyBefore(turns: ChatTurn[], turnId: string | null): HistoryEntry[] {
  const idx = turnId ? turns.findIndex((t) => t.id === turnId) : turns.length;
  const prior = idx === -1 ? turns : turns.slice(0, idx);
  return prior.flatMap(turnToHistory);
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ── Specialist leg ────────────────────────────────────────────────────────────

interface SpecialistLegInput {
  turnId: string;
  query: string;
  priorHistory: HistoryEntry[];
  primaryText: string;
  specialistKey: string;
}

interface DeepDiveInputs {
  query: string;
  specialistKey: string;
  primaryText: string;
}

function getDeepDivePrimaryText(segments: AnswerSegment[]): string {
  const text = segments[0]?.text;
  return text ?? '';
}

function getDeepDiveSpecialistKey(turn: ChatTurn, specialists: ChatAgentDescriptor[]): string {
  const key = turn.deepDiveSpecialist;
  const fallback = specialists[0]?.key;
  return key ?? fallback ?? '';
}

function resolveDeepDiveInputs(
  turn: ChatTurn,
  specialists: ChatAgentDescriptor[],
): DeepDiveInputs | null {
  if (!turn.deepDiveOffered || turn.handoff) return null;
  return {
    primaryText: getDeepDivePrimaryText(turn.segments),
    query: turn.deepDiveQuery ?? turn.query,
    specialistKey: getDeepDiveSpecialistKey(turn, specialists),
  };
}

// ── Sources ───────────────────────────────────────────────────────────────────

function normalizeSources(hits: Record<string, unknown>[]): AnswerSource[] {
  const sources: AnswerSource[] = [];
  for (const h of hits) {
    const s = normalizeHit(h);
    if (s) sources.push(s);
  }
  return groupSources(sources).flatMap((g) => g.sources);
}

/**
 * Patch a segment's grounded sources from a streaming partial. Agent Studio
 * emits the search tool results (`a:` hit frames) early in the stream — before
 * the answer text finishes — so surfacing them as they arrive lets the source
 * pills appear immediately rather than only once the whole answer completes.
 */
function applyStreamingSources(
  updateSegment: (turnId: string, index: number, patch: Partial<AnswerSegment>) => void,
  turnId: string,
  index: number,
  hits: Record<string, unknown>[],
): void {
  if (!hits.length) return;
  const sources = normalizeSources(hits);
  updateSegment(turnId, index, {
    sources,
    searchCount: totalSources(groupSources(sources)),
    rawHits: hits,
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseChatResult {
  turns: ChatTurn[];
  isStreaming: boolean;
  sendMessage: (query: string) => Promise<void>;
  retryTurn: (turnId: string) => Promise<void>;
  runDeepDive: (turnId: string) => Promise<void>;
  declineDeepDive: (turnId: string) => void;
  reset: () => void;
}

export function useChat(): UseChatResult {
  const { agents: contextAgents } = useWidgetState();

  // Keep a ref that callbacks always read from so we get the latest agents
  // without listing them as dependencies of every useCallback.
  const agentsRef = useRef<ResolvedAgents>(resolveAgents(contextAgents));
  useEffect(() => {
    agentsRef.current = resolveAgents(contextAgents);
  });

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const turnsRef = useRef<ChatTurn[]>([]);
  useEffect(() => {
    turnsRef.current = turns;
  });

  const updateSegment = useCallback(
    (turnId: string, index: number, patch: Partial<AnswerSegment>) => {
      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== turnId) return t;
          const segments = t.segments.slice();
          segments[index] = { ...segments[index], ...patch };
          return { ...t, segments };
        }),
      );
    },
    [],
  );

  const appendSegment = useCallback((turnId: string, segment: AnswerSegment) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId
          ? { ...t, segments: [...t.segments, segment], handoff: true, deepDiveOffered: false }
          : t,
      ),
    );
  }, []);

  const runTurn = useCallback(
    async (turnId: string, query: string, priorHistory: HistoryEntry[]) => {
      setIsStreaming(true);
      try {
        const { primary, classifier, specialists } = agentsRef.current;

        if (!primary?.id) {
          updateSegment(turnId, 0, {
            status: 'error',
            error: activeInstance.strings.error.noPrimaryAgent,
          });
          return;
        }

        const primaryId = resolveAnsweringAgentId(primary.id);

        // Clear any proactive greeting once the user sends their first real message.
        proactiveStore.clearGreeting();

        // Sent instead of the bare question so the agent can see what the host
        // knows about this visitor. Resolved per turn: the snapshot changes as
        // they navigate, and a `<algolia-chat>` provider may be registered at
        // any time after mount.
        const primaryMessage = composeVisitorMessage(query);

        let primaryResult;
        try {
          primaryResult = await callWithRetry(
            getAgentConfig(primaryId),
            { history: priorHistory, query: primaryMessage },
            (accumulated) => {
              updateSegment(turnId, 0, { status: 'streaming', text: accumulated });
            },
            (partial) => applyStreamingSources(updateSegment, turnId, 0, partial.hits),
          );
        } catch (err) {
          updateSegment(turnId, 0, { status: 'error', error: toErrorMessage(err) });
          return;
        }

        const primaryText = primaryResult.content;
        const primarySources = normalizeSources(primaryResult.hits);

        if (primaryResult.error) {
          updateSegment(turnId, 0, {
            status: 'error',
            text: primaryText,
            sources: primarySources,
            searchCount: totalSources(groupSources(primarySources)),
            error: primaryResult.error,
            rawHits: primaryResult.hits,
          });
          return;
        }

        updateSegment(turnId, 0, {
          status: 'success',
          text: primaryText,
          sources: primarySources,
          searchCount: totalSources(groupSources(primarySources)),
          rawHits: primaryResult.hits,
        });

        // Only run classifier and offer a deep-dive when a classifier agent is
        // configured and at least one specialist exists.
        if (!classifier?.id || !specialists.length) return;

        const patch = await resolveOfferPatch({
          classifierConfig: getAgentConfig(classifier.id),
          query,
          primaryAnswer: primaryText,
          hits: primaryResult.hits,
          specialists,
        });
        setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, ...patch } : t)));
      } finally {
        setIsStreaming(false);
      }
    },
    [updateSegment],
  );

  const runSpecialistLeg = useCallback(
    async ({ turnId, query, priorHistory, primaryText, specialistKey }: SpecialistLegInput) => {
      setIsStreaming(true);
      try {
        const { specialists } = agentsRef.current;
        const descriptor = specialists.find((s) => s.key === specialistKey) ?? specialists[0];
        if (!descriptor?.id) {
          console.warn('[useChat] No specialist agent configured — skipping deep-dive.');
          return;
        }

        appendSegment(turnId, {
          agent: descriptor.key,
          status: 'loading',
          text: '',
          sources: [],
          searchCount: 0,
        });

        const specialistHistory = buildSpecialistHistory(priorHistory, query, primaryText);
        const onSpecialistToken = (acc: string) =>
          updateSegment(turnId, 1, { status: 'streaming', text: acc });

        let specialistResult;
        try {
          specialistResult = await callWithRetry(
            getAgentConfig(descriptor.id),
            { history: specialistHistory, query: composeVisitorMessage(query) },
            onSpecialistToken,
            (partial) => applyStreamingSources(updateSegment, turnId, 1, partial.hits),
          );
        } catch (err) {
          updateSegment(turnId, 1, { status: 'error', error: toErrorMessage(err) });
          return;
        }

        const specialistSources = normalizeSources(specialistResult.hits);
        const { rest: specialistRest } = extractDeepDiveOffer(specialistResult.suggestions);

        if (specialistResult.error) {
          updateSegment(turnId, 1, {
            status: 'error',
            text: specialistResult.content,
            sources: specialistSources,
            searchCount: totalSources(groupSources(specialistSources)),
            error: specialistResult.error,
            rawHits: specialistResult.hits,
          });
          return;
        }

        updateSegment(turnId, 1, {
          status: 'success',
          text: specialistResult.content,
          sources: specialistSources,
          searchCount: totalSources(groupSources(specialistSources)),
          rawHits: specialistResult.hits,
        });
        if (specialistRest[0]) {
          setTurns((prev) =>
            prev.map((t) => (t.id === turnId ? { ...t, followUp: specialistRest[0] } : t)),
          );
        }
      } finally {
        setIsStreaming(false);
      }
    },
    [appendSegment, updateSegment],
  );

  const runDeepDive = useCallback(
    async (turnId: string) => {
      if (isStreaming) return;
      const turn = turnsRef.current.find((t) => t.id === turnId);
      if (!turn) return;
      const inputs = resolveDeepDiveInputs(turn, agentsRef.current.specialists);
      if (!inputs) return;
      const priorHistory = historyBefore(turnsRef.current, turnId);
      await runSpecialistLeg({ turnId, priorHistory, ...inputs });
    },
    [isStreaming, runSpecialistLeg],
  );

  const declineDeepDive = useCallback((turnId: string) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId ? { ...t, deepDiveOffered: false, deepDiveDeclined: true } : t,
      ),
    );
  }, []);

  const sendMessage = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed || isStreaming) return;

      const turnId = crypto.randomUUID();
      const priorHistory = historyBefore(turnsRef.current, null);
      const newTurn: ChatTurn = {
        id: turnId,
        query: trimmed,
        handoff: false,
        deepDiveOffered: false,
        segments: [{ agent: 'primary', status: 'loading', text: '', sources: [], searchCount: 0 }],
      };
      setTurns((prev) => [...prev, newTurn]);

      await runTurn(turnId, trimmed, priorHistory);
    },
    [isStreaming, runTurn],
  );

  const retryTurn = useCallback(
    async (turnId: string) => {
      if (isStreaming) return;
      const turn = turnsRef.current.find((t) => t.id === turnId);
      if (!turn) return;

      const priorHistory = historyBefore(turnsRef.current, turnId);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                handoff: false,
                deepDiveOffered: false,
                deepDiveDeclined: false,
                followUp: undefined,
                deepDiveQuery: undefined,
                segments: [
                  { agent: 'primary', status: 'loading', text: '', sources: [], searchCount: 0 },
                ],
              }
            : t,
        ),
      );

      await runTurn(turnId, turn.query, priorHistory);
    },
    [isStreaming, runTurn],
  );

  const reset = useCallback(() => {
    turnsRef.current = [];
    setTurns([]);
    setIsStreaming(false);
  }, []);

  return { turns, isStreaming, sendMessage, retryTurn, runDeepDive, declineDeepDive, reset };
}
