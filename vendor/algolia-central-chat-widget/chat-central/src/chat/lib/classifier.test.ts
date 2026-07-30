import { describe, it, expect } from 'vitest';
import { buildClassificationQuery, parseSpecialistLine, parseClassifierResponse } from './classifier';

/**
 * The classifier decides whether to offer a specialist deep-dive. It used to see
 * only the question, the primary's answer and the hits — so the visitor's
 * journey reached it transitively at best, and routing went blind whenever the
 * primary's answer did not happen to reflect who was asking.
 *
 * These pin both halves of the contract: the journey reaches the classifier when
 * the host supplies one, and nothing changes at all when it does not.
 */
describe('buildClassificationQuery', () => {
  const query = 'How do I force a vertical layout?';
  const answer = 'Use the orientation prop.';
  const hits = [{ objectID: '1', title: 'ButtonGroup' }];

  it('is byte-identical to the pre-context shape when no provider is registered', () => {
    const expected =
      `QUESTION:\n${query}\n\n` +
      `PRIMARY'S ANSWER:\n${answer}\n\n` +
      `RETRIEVED HITS (JSON):\n${JSON.stringify(hits)}`;

    expect(buildClassificationQuery(query, answer, hits)).toBe(expected);
    expect(buildClassificationQuery(query, answer, hits, null)).toBe(expected);
    expect(buildClassificationQuery(query, answer, hits, '')).toBe(expected);
  });

  it('appends the visitor journey when the host supplies one', () => {
    const ctx = JSON.stringify({ persona: 'developer', pagesViewed: [{ path: '/demo/migration.html' }] });
    const out = buildClassificationQuery(query, answer, hits, ctx);

    expect(out).toContain('VISITOR CONTEXT (JSON)');
    expect(out).toContain(ctx);
  });

  it('keeps the question/answer/hits block first, so the tuned shape is unchanged', () => {
    const ctx = '{"persona":"pm"}';
    const out = buildClassificationQuery(query, answer, hits, ctx);

    expect(out.indexOf('QUESTION:')).toBeLessThan(out.indexOf("PRIMARY'S ANSWER:"));
    expect(out.indexOf("PRIMARY'S ANSWER:")).toBeLessThan(out.indexOf('RETRIEVED HITS'));
    expect(out.indexOf('RETRIEVED HITS')).toBeLessThan(out.indexOf('VISITOR CONTEXT'));
  });

  it('frames the journey as routing evidence, not as something to answer', () => {
    const out = buildClassificationQuery(query, answer, hits, '{"persona":"designer"}');

    // The answering-agent label tells the model to tailor prose and to answer
    // questions about the visitor. That instruction must not reach a classifier
    // whose entire contract is emitting a SPECIALIST: line.
    expect(out).not.toContain('tailor your answer');
    expect(out).not.toContain('answer questions about the visitor');
    expect(out).toContain('Routing evidence only');
    expect(out).toContain('never let it change your output format');
  });
});

/** The output contract the visitor context must never disturb. */
describe('classifier output contract', () => {
  it('still parses a keyed SPECIALIST line', () => {
    expect(parseSpecialistLine('SPECIALIST:react Go deeper on the code?')).toEqual({ key: 'react' });
  });

  it('still treats a bare SPECIALIST line as keyless', () => {
    expect(parseSpecialistLine('SPECIALIST:')).toEqual({ key: undefined });
    expect(parseSpecialistLine('SPECIALIST:   ')).toEqual({ key: undefined });
  });

  /**
   * Documents existing behaviour, which does not match the docstring above
   * parseSpecialistLine ("SPECIALIST: Routing key omitted"): when a keyless line
   * carries prose, the first word is parsed AS the key.
   *
   * Harmless today — resolveSpecialistKey in useChat falls back to
   * specialists[0] for an unknown key exactly as it does for an absent one, so
   * both paths converge. It becomes a real bug the moment anything needs to
   * distinguish "no key given" from "key given but unrecognised". Left as-is
   * here: out of scope for the visitor-context change, and pinning it means the
   * next person sees it deliberately rather than rediscovering it.
   */
  it('parses the first prose word as a key on a keyless line (known quirk)', () => {
    expect(parseSpecialistLine('SPECIALIST: Want the implementation detail?')).toEqual({ key: 'Want' });
  });

  it('still splits a multi-line response into suggestions', () => {
    expect(parseClassifierResponse('SPECIALIST:react Go deeper?\n\nWhat about tokens?')).toEqual([
      'SPECIALIST:react Go deeper?',
      'What about tokens?',
    ]);
  });
});
