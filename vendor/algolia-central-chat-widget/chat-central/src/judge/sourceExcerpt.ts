/**
 * sourceExcerpt — relevance-based excerpting of retrieved sources before they
 * reach the judge.
 *
 * Extracted from upstream's chiefJudge.ts (smomin/algolia-central-chat-widget
 * PR #12) during the 2026-08 merge. ACS declined the chief-judge/orchestrator
 * architecture that module belonged to (see vendor/README.md and
 * .development-loop/run-2026-08-03-001/04-architecture-decision.md), but this
 * excerpting algorithm is self-contained and fixes a real grounding
 * false-negative: head-truncating a source hands the judges a page's nav menu
 * instead of the prose that documents a claim. Not yet wired into
 * hostedJudgeClient's postToHostedJudge — see 06-merge-report.md follow-ups.
 */
import type { JudgeSourceInput } from './types';

const TOTAL_SOURCE_BUDGET = 24_000;

/** Characters every source is guaranteed, however little it has to offer. */
const MIN_SOURCE_CHARS = 800;

/** Leading characters always kept, so every source carries its own intro. */
const SOURCE_HEAD_CHARS = 300;

/** Target size of one candidate passage when carving up a long source. */
const BLOCK_CHARS = 400;

/** Marker inserted where the excerpt skips over unselected text. */
const ELLIPSIS = '\n…\n';

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'you',
  'your',
  'with',
  'this',
  'that',
  'from',
  'are',
  'can',
  'use',
  'used',
  'using',
  'how',
  'what',
  'when',
  'where',
  'which',
  'not',
  'but',
  'all',
  'any',
  'its',
  'has',
  'have',
  'was',
  'were',
  'will',
  'would',
  'should',
  'there',
  'here',
  'them',
  'they',
  'then',
  'than',
  'into',
  'onto',
  'over',
  'more',
  'each',
  'via',
  'per',
  'set',
  'get',
  'new',
  'one',
  'two',
  'also',
  'like',
  'want',
]);

/**
 * Split text into search terms.
 *
 * `/` and `-` are kept inside tokens so token syntax the answer relies on
 * (`accent-900/50`) survives as one discriminative term instead of shattering
 * into the useless words around it.
 */
function extractTerms(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9_/-]+/)) {
    const term = raw.replace(/^[-/]+|[-/]+$/g, '');
    if (term.length < 3 || STOPWORDS.has(term)) continue;
    seen.add(term);
  }
  return [...seen];
}

/** Group lines into passages of roughly BLOCK_CHARS, never splitting a line. */
function toBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && current.length + line.length + 1 > BLOCK_CHARS) {
      blocks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

/**
 * Choose passages so that as many of the answer's terms as possible are
 * evidenced at least once, cheapest-first.
 *
 * Ranking passages by raw score does not work here, because the two kinds of
 * evidence a docs page holds are not interchangeable: a value table proves
 * which token names exist, while the prose proves what a utility does. Whenever
 * one kind outranks the other it crowds it out entirely and the judges flag
 * whatever was evicted. Scoring on *newly* covered terms makes a second passage
 * about an already-evidenced term worth nothing, so the budget spreads across
 * distinct claims instead of piling onto one.
 *
 * Terms are counted rather than weighted by rarity: one sighting is all the
 * judges need, and penalising terms that recur would suppress exactly the value
 * tables whose whole purpose is to repeat token names.
 */
function selectBlocks(blocks: string[], terms: string[], budget: number): number[] {
  const blockTerms = blocks.map((block) => {
    const haystack = block.toLowerCase();
    return terms.filter((term) => haystack.includes(term));
  });

  const state: BlockSelection = {
    blocks,
    blockTerms,
    remaining: new Set(blocks.map((_, i) => i)),
    covered: new Set<string>(),
  };
  const picked: number[] = [];
  let used = 0;

  for (;;) {
    const best = bestBlock(state, used, budget);
    if (best < 0) break;

    state.remaining.delete(best);
    picked.push(best);
    used += blocks[best].length + ELLIPSIS.length;
    for (const term of blockTerms[best]) state.covered.add(term);
  }

  return growSelection(blocks, picked, used, budget);
}

/** Passages under consideration, and what they have already evidenced. */
interface BlockSelection {
  blocks: string[];
  blockTerms: string[][];
  remaining: Set<number>;
  covered: Set<string>;
}

/** How many of a passage's terms are not yet evidenced elsewhere. */
function countNewTerms(blockTerms: string[], covered: Set<string>): number {
  let gain = 0;
  for (const term of blockTerms) if (!covered.has(term)) gain += 1;
  return gain;
}

/**
 * Index of the affordable passage adding the most new coverage per character,
 * or -1 when nothing left either fits or adds anything.
 */
function bestBlock(state: BlockSelection, used: number, budget: number): number {
  let best = -1;
  let bestDensity = 0;

  for (const i of state.remaining) {
    const cost = state.blocks[i].length + ELLIPSIS.length;
    if (used + cost > budget) continue;
    const density = countNewTerms(state.blockTerms[i], state.covered) / cost;
    if (density > bestDensity) {
      bestDensity = density;
      best = i;
    }
  }

  return best;
}

/**
 * Spend whatever budget is left widening the chosen passages outwards.
 *
 * Passage boundaries fall at arbitrary points, so a selection routinely stops
 * one block short of the code example that illustrates a definition, or clips
 * the tail off a list of token names. Neighbours cost nothing extra to splice
 * in — they join an existing run rather than opening a new one — so growing
 * outwards recovers that context for free. Forward first, since examples
 * follow the prose they illustrate.
 */
function growSelection(blocks: string[], picked: number[], used: number, budget: number): number[] {
  const growth: Growth = { blocks, chosen: new Set(picked), budget };
  let spent = used;
  let previous = -1;

  while (previous !== growth.chosen.size) {
    previous = growth.chosen.size;
    for (const index of [...growth.chosen].sort((a, b) => a - b)) {
      spent = absorbNeighbours(growth, index, spent);
    }
  }

  return [...growth.chosen];
}

/** The passages a selection may still grow into, and what it may spend. */
interface Growth {
  blocks: string[];
  chosen: Set<number>;
  budget: number;
}

/** Pull the passages either side of `index` into the selection if they fit. */
function absorbNeighbours(growth: Growth, index: number, spent: number): number {
  const { blocks, chosen, budget } = growth;
  let total = spent;

  for (const neighbour of [index + 1, index - 1]) {
    if (neighbour < 0 || neighbour >= blocks.length || chosen.has(neighbour)) continue;
    if (total + blocks[neighbour].length > budget) continue;
    chosen.add(neighbour);
    total += blocks[neighbour].length;
  }

  return total;
}

/**
 * Excerpt one source down to the budget, keeping the passages most likely to
 * settle the answer's claims.
 *
 * Head truncation is the wrong tool here: documentation pages open with
 * navigation and value enumerations, so the first N characters are mostly the
 * table of contents while the prose that supports (or refutes) a claim sits
 * deep in the page. Selecting on relevance means a claim the source genuinely
 * documents is visible to the judges rather than being scored as unsupported.
 */
function excerptRelevant(text: string, terms: string[], limit: number): string {
  if (text.length <= limit) return text;

  const head = text.slice(0, SOURCE_HEAD_CHARS);
  const rest = text.slice(SOURCE_HEAD_CHARS);
  const budget = limit - head.length;

  const blocks = toBlocks(rest);
  const picked = selectBlocks(blocks, terms, budget).sort((a, b) => a - b);

  // Nothing matched — fall back to contiguous head truncation.
  if (picked.length === 0) return `${text.slice(0, limit)}…`;

  let out = head;
  let prev = -1;
  for (const index of picked) {
    out += index === prev + 1 ? `\n${blocks[index]}` : ELLIPSIS + blocks[index];
    prev = index;
  }
  return prev === blocks.length - 1 ? out : `${out}…`;
}

/**
 * Excerpt every source against the question and answer being judged.
 *
 * Terms come from both: the question sets the topic, and the answer supplies
 * the specific claims whose supporting text the judges need to see.
 */
export function excerptSources(
  sources: JudgeSourceInput[],
  question: string,
  answer: string,
  totalBudget: number = TOTAL_SOURCE_BUDGET,
): JudgeSourceInput[] {
  const terms = extractTerms(`${question}\n${answer}`);
  const limits = allocateBudget(sources, terms, totalBudget);
  return sources.map((source, i) =>
    source.text && source.text.length > limits[i]
      ? { ...source, text: excerptRelevant(source.text, terms, limits[i]) }
      : source,
  );
}

/**
 * Split the corpus budget across sources by how much each can actually prove.
 *
 * A uniform per-source slice is what let the original bug through: retrieval
 * returns one page carrying nearly every claim alongside several that carry
 * none, yet each got the same allowance — too small for the page that mattered
 * and wasted on the ones that did not. Weighting by how many of the answer's
 * terms a source could evidence spends the same total where it settles claims.
 */
function allocateBudget(
  sources: JudgeSourceInput[],
  terms: string[],
  totalBudget: number,
): number[] {
  const lengths = sources.map((s) => s.text?.length ?? 0);
  const weights = relevanceWeights(sources, terms);

  const alloc = lengths.map((len) => Math.min(len, MIN_SOURCE_CHARS));
  let remaining = totalBudget - alloc.reduce((a, b) => a + b, 0);

  // Water-fill: hand out the rest by weight, then redistribute whatever spills
  // off sources that are already fully included.
  for (let pass = 0; pass < WATERFILL_PASSES && remaining > 0; pass++) {
    const spent = distribute(alloc, lengths, weights, remaining);
    if (spent <= 0) break;
    remaining -= spent;
  }

  return alloc.map((a) => Math.floor(a));
}

/** Passes used to redistribute budget that spills off fully-included sources. */
const WATERFILL_PASSES = 4;

/**
 * Rate each source by the rarity of the answer terms it carries.
 *
 * A term present in every source ("color") says nothing about which source is
 * worth reading; one present in a single source ("colormix") points straight at
 * the page that can settle that claim.
 */
function relevanceWeights(sources: JudgeSourceInput[], terms: string[]): number[] {
  const haystacks = sources.map((s) => (s.text ?? '').toLowerCase());

  const sourceFreq = new Map<string, number>();
  for (const term of terms) {
    sourceFreq.set(term, haystacks.filter((h) => h.includes(term)).length || 1);
  }

  return haystacks.map((haystack) =>
    terms.reduce(
      (total, term) => (haystack.includes(term) ? total + 1 / (sourceFreq.get(term) ?? 1) : total),
      0,
    ),
  );
}

/** Hand `remaining` characters to sources by weight; returns how much was used. */
function distribute(
  alloc: number[],
  lengths: number[],
  weights: number[],
  remaining: number,
): number {
  const active = alloc.map((_, i) => i).filter((i) => alloc[i] < lengths[i] && weights[i] > 0);
  const totalWeight = active.reduce((sum, i) => sum + weights[i], 0);
  if (totalWeight === 0) return 0;

  let spent = 0;
  for (const i of active) {
    const give = Math.min((remaining * weights[i]) / totalWeight, lengths[i] - alloc[i]);
    alloc[i] += give;
    spent += give;
  }

  return spent;
}
