import { describe, it, expect, vi } from 'vitest';
import { configureHostedJudge, configureOpenMode } from './main';

/**
 * These pin the ONE decision in the enhancement layer that can silently break
 * the demo: whether the vendored confidence panel is pointed at our judge.
 *
 * The failure this guards against is not hypothetical. On 2026-07-28 a client
 * shipped against a judge that did not return what it expected and production
 * read "Grounding · unavailable" for about two hours. A half-written hosted
 * config — a `mode="hosted"` with no URL — produces exactly that class of
 * failure, so the no-URL case must leave their working config alone rather than
 * half-apply ours.
 */

/** Minimal stand-in for a custom element: just attributes. No DOM needed. */
function fakeElement() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    getAttribute: (k: string) => attrs.get(k) ?? null,
  };
}

function fakeRoot(elements: ReturnType<typeof fakeElement>[]) {
  return { querySelectorAll: () => elements } as unknown as ParentNode;
}

describe('configureHostedJudge', () => {
  it('points the confidence panel at our hosted judge', () => {
    const el = fakeElement();
    const applied = configureHostedJudge(fakeRoot([el]), 'https://judge.example.com', 'k123');

    expect(applied).toBe(true);
    expect(el.getAttribute('mode')).toBe('hosted');
    expect(el.getAttribute('url')).toBe('https://judge.example.com');
    expect(el.getAttribute('api-key')).toBe('k123');
  });

  it('configures every panel on the page, not just the first', () => {
    const a = fakeElement();
    const b = fakeElement();
    configureHostedJudge(fakeRoot([a, b]), 'https://judge.example.com', 'k');
    expect(a.getAttribute('mode')).toBe('hosted');
    expect(b.getAttribute('mode')).toBe('hosted');
  });

  it('leaves their config untouched when no judge URL was built in', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = fakeElement();

    const applied = configureHostedJudge(fakeRoot([el]), undefined, 'k123');

    expect(applied).toBe(false);
    // Nothing half-applied: no mode, no url, and crucially no api-key either.
    expect(el.attrs.size).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('still switches to hosted when no api key is configured (open local judge)', () => {
    const el = fakeElement();
    const applied = configureHostedJudge(fakeRoot([el]), 'http://localhost:8788', undefined);

    expect(applied).toBe(true);
    expect(el.getAttribute('url')).toBe('http://localhost:8788');
    expect(el.getAttribute('api-key')).toBeNull();
  });

  it('reports false, and warns nothing, when the page has no confidence panel', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(configureHostedJudge(fakeRoot([]), undefined, undefined)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

/**
 * This pins the per-surface open-mode decision: docked on the /demo/ pages
 * (so the visitor keeps reading while the panel talks), normal everywhere
 * else (so a streaming answer plus its source list has room to breathe).
 */
describe('configureOpenMode', () => {
  it('leaves the demo pages alone — their own markup already ships docked', () => {
    const el = fakeElement();

    const applied = configureOpenMode(fakeRoot([el]), '/demo/foundations/color.html');

    expect(applied).toBe(true);
    // No attribute written: their markup is the source of truth here.
    expect(el.attrs.size).toBe(0);
  });

  it('sets normal everywhere outside /demo/', () => {
    const el = fakeElement();

    const applied = configureOpenMode(fakeRoot([el]), '/');

    expect(applied).toBe(true);
    expect(el.getAttribute('default-open-mode')).toBe('normal');
  });

  it('reports false when the page has no chat element, on either surface', () => {
    expect(configureOpenMode(fakeRoot([]), '/demo/whatever.html')).toBe(false);
    expect(configureOpenMode(fakeRoot([]), '/')).toBe(false);
  });
});
