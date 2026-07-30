/**
 * Proactive Chat — end-to-end tests
 *
 * The concierge agent call (~12 s real latency) is intercepted and replaced
 * with an instant mock SSE stream so the suite runs in seconds.
 *
 * Shadow DOM: Playwright automatically pierces open Shadow DOM so normal
 * locators work inside <algolia-chat>'s shadow root.
 */
import { test, expect, Page, Route } from '@playwright/test';

// ── Helpers ───────────────────────────────────────────────────────────────────

const CONCIERGE_ID = '213315ed-0488-4329-8fc6-db4691148a09';
const CONCIERGE_URL = `**/agents/${CONCIERGE_ID}/completions**`;

/** Build an AI-SDK v4 SSE body that callAgentJson can parse. */
function mockConciergeSSE(decision: {
  engage: boolean;
  greeting?: string;
  suggestions?: string[];
  persona?: string;
}): string {
  const json = JSON.stringify({
    engage: decision.engage,
    persona: decision.persona ?? 'developer',
    greeting: decision.greeting ?? '',
    suggestions: decision.suggestions ?? [],
  });
  const delta = JSON.stringify(json);
  return [
    `f:{"messageId":"mock-msg-id"}`,
    `0:${delta}`,
    `d:{"finishReason":"stop","usage":{"promptTokens":50,"completionTokens":20}}`,
    '',
  ].join('\n');
}

/**
 * Intercept the concierge completions endpoint and return a mock.
 * `delayMs` simulates the real ~7 s agent latency so the FAB spinner is observable.
 */
async function mockConcierge(
  page: Page,
  decision: Parameters<typeof mockConciergeSSE>[0],
  delayMs = 0,
) {
  await page.route(CONCIERGE_URL, async (route: Route) => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: mockConciergeSSE(decision),
    });
  });
}

/** Clear demo tracking + widget preference keys so each test starts fresh. */
async function clearStorage(page: Page) {
  await page.evaluate(() => {
    [
      'acs_profile',
      'acs_session',
      'acs_events',
      'acs_pending_greeting',
      'algolia-chat:auto-engage',
    ].forEach((k) => localStorage.removeItem(k));
  });
}

/**
 * The chat panel is visible when `div.pointer-events-auto` is rendered inside
 * the shadow root (it's hidden with `pointer-events-none` on the wrapper when closed).
 * The close button [aria-label="Close chat"] is the simplest open-state indicator.
 */
const CLOSE_BUTTON = '[aria-label="Close chat"]';
const TEXTAREA = 'textarea#acs-composer-input';
/** FAB in its analyzing state — aria-label comes from strings.widget.analyzing. */
const FAB_ANALYZING = 'button[aria-busy="true"]';

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Proactive Chat', () => {
  test.beforeEach(async ({ page }) => {
    // Default: block real concierge traffic so tests stay hermetic and fast.
    // Per-test page.route() calls registered later take precedence.
    await mockConcierge(page, { engage: false });
    await page.goto('/demo/');
    await clearStorage(page);
  });

  // ── 1. Widget renders ──────────────────────────────────────────────────────

  test('chat FAB is visible on demo pages', async ({ page }) => {
    await page.goto('/demo/button.html');
    const fab = page.locator('algolia-chat').getByRole('button').first();
    await expect(fab).toBeVisible({ timeout: 5000 });
  });

  // ── 2. FAB opens the chat panel ────────────────────────────────────────────

  test('clicking the FAB opens the chat panel', async ({ page }) => {
    await page.goto('/demo/button.html');
    await mockConcierge(page, { engage: false });

    const fab = page.locator('algolia-chat').getByRole('button').first();
    await fab.click();

    // The close button only appears when the panel is open
    const closeBtn = page.locator('algolia-chat').locator(CLOSE_BUTTON);
    await expect(closeBtn).toBeVisible({ timeout: 5000 });
  });

  // ── 3. Proactive engagement — stay on page ────────────────────────────────

  test('chat opens automatically after concierge decides to engage', async ({ page }) => {
    // Register mock BEFORE navigation so the 0 ms analysis timer is intercepted
    await mockConcierge(page, {
      engage: true,
      greeting: 'I see you are exploring the Button component!',
      suggestions: ['How do I use isPending?', 'What variants exist?', 'Show me ButtonGroup'],
    });
    await page.goto('/demo/button.html');

    // context-engine fires immediately; mock responds instantly → greeting appears
    const greeting = page.locator('algolia-chat').getByText('I see you are exploring the Button component!');
    await expect(greeting).toBeVisible({ timeout: 5000 });
  });

  // ── 4. Suggestion chips are clickable ─────────────────────────────────────

  test('clicking a suggestion chip sends the message', async ({ page }) => {
    // Register mock BEFORE navigation so the 0 ms analysis timer is intercepted
    await mockConcierge(page, {
      engage: true,
      greeting: 'Happy to help with Button!',
      suggestions: ['How do I use isPending?', 'What variants exist?', 'Show me ButtonGroup'],
    });
    await page.goto('/demo/button.html');

    await expect(page.locator('algolia-chat').getByText('Happy to help with Button!')).toBeVisible({
      timeout: 5000,
    });

    // Click the first suggestion chip — it should populate and send the message
    const chip = page.locator('algolia-chat').getByRole('button', { name: 'How do I use isPending?' });
    await chip.click();

    // The suggestion text should appear as a user message in the conversation
    const userMsg = page.locator('algolia-chat').getByText('How do I use isPending?').first();
    await expect(userMsg).toBeVisible({ timeout: 5000 });
  });

  // ── 5. Cached greeting shows on next page ────────────────────────────────
  //
  // showCachedGreeting() reads acs_pending_greeting from localStorage and
  // calls widget.engage() ~800 ms after init. We pre-populate the cache and
  // verify it renders on the next page (simulating a cross-page scenario where
  // the concierge responded while the previous page was hidden).

  test('cached greeting from localStorage appears on page load', async ({ page }) => {
    // Pre-populate the cache (as if the concierge finished on the previous page)
    await page.goto('/demo/');
    await page.evaluate(() => {
      localStorage.setItem('acs_pending_greeting', JSON.stringify({
        greeting: 'Welcome back! I noticed you were checking out Button.',
        suggestions: ['Button variants?', 'isPending prop?', 'ButtonGroup usage?'],
        ts: Date.now(),
      }));
    });

    // Navigate to the next page — showCachedGreeting() fires at ~800 ms
    await page.goto('/demo/button.html');

    const greeting = page.locator('algolia-chat').getByText(
      'Welcome back! I noticed you were checking out Button.',
    );
    await expect(greeting).toBeVisible({ timeout: 5000 });

    // Cache should be cleared after showing (only shows once)
    const cacheAfter = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('acs_pending_greeting') ?? 'null'),
    );
    expect(cacheAfter).toBeNull();
  });

  // ── 6. Persona dropdown ───────────────────────────────────────────────────

  test('persona dropdown is visible and has the correct options', async ({ page }) => {
    await page.goto('/demo/button.html');

    const dropdown = page.locator('#acs-persona-dropdown select');
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    const options = await dropdown.locator('option').allTextContents();
    expect(options.some((o) => o.includes('Designer'))).toBeTruthy();
    expect(options.some((o) => o.includes('Developer'))).toBeTruthy();
    expect(options.some((o) => o.includes('Product Manager'))).toBeTruthy();
  });

  test('switching persona clears session, events, and pending greeting', async ({ page }) => {
    await page.goto('/demo/button.html');
    await mockConcierge(page, { engage: false });

    // Seed storage to verify it gets cleared
    await page.evaluate(() => {
      localStorage.setItem('acs_session', JSON.stringify({
        pages: [{ path: '/demo/button.html', title: 'Button' }, { path: '/demo/', title: 'Overview' }],
        startedAt: Date.now(),
      }));
      localStorage.setItem('acs_events', JSON.stringify([
        { type: 'page_view', page: '/demo/button.html', ts: Date.now() },
        { type: 'cta_click', page: '/demo/button.html', ts: Date.now() },
      ]));
      localStorage.setItem('acs_pending_greeting', JSON.stringify({
        greeting: 'old greeting',
        suggestions: [],
        ts: Date.now(),
      }));
    });

    // Switch persona via the dropdown
    const dropdown = page.locator('#acs-persona-dropdown select');
    await dropdown.selectOption('designer');
    await page.waitForTimeout(300); // allow onPersonaChange to complete

    // Session should be re-seeded with only the current page (1 entry, not 2)
    const session = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('acs_session') ?? 'null'),
    );
    expect(session?.pages?.length).toBe(1);

    // Events should be cleared (null stored means no events)
    const events = await page.evaluate(() => localStorage.getItem('acs_events'));
    expect(events === 'null' || events === null || events === '[]').toBeTruthy();

    // Pending greeting should be cleared
    const pending = await page.evaluate(() => localStorage.getItem('acs_pending_greeting'));
    expect(pending === 'null' || pending === null).toBeTruthy();

    // Profile persona should be updated
    const profile = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('acs_profile') ?? 'null'),
    );
    expect(profile?.persona).toBe('designer');
  });

  // ── 7. FAB loading indicator ──────────────────────────────────────────────

  test('FAB shows a loading indicator while the concierge is analyzing', async ({ page }) => {
    // Delay the mock so the analyzing window is observable
    await mockConcierge(
      page,
      { engage: true, greeting: 'Ready to help with Button!', suggestions: ['A?', 'B?', 'C?'] },
      2000,
    );
    await page.goto('/demo/button.html');

    // While the call is in flight the FAB reports aria-busy
    const busyFab = page.locator('algolia-chat').locator(FAB_ANALYZING);
    await expect(busyFab).toBeVisible({ timeout: 3000 });
    await expect(busyFab).toHaveAttribute('aria-label', /preparing/i);

    // Once the greeting lands the panel opens and the FAB is gone
    await expect(page.locator('algolia-chat').getByText('Ready to help with Button!')).toBeVisible({
      timeout: 6000,
    });
    await expect(busyFab).toBeHidden();
  });

  test('loading indicator clears when the concierge declines to engage', async ({ page }) => {
    await mockConcierge(page, { engage: false }, 1500);
    await page.goto('/demo/button.html');

    const busyFab = page.locator('algolia-chat').locator(FAB_ANALYZING);
    await expect(busyFab).toBeVisible({ timeout: 3000 });

    // After the decline, the spinner clears but the FAB stays (chat never opened)
    await expect(busyFab).toBeHidden({ timeout: 6000 });
    const fab = page.locator('algolia-chat').getByRole('button').first();
    await expect(fab).toBeVisible();
    await expect(fab).toHaveAttribute('aria-label', /open ai chat/i);
  });

  test('no loading indicator is shown once the chat panel is open', async ({ page }) => {
    await mockConcierge(
      page,
      { engage: true, greeting: 'Hello from concierge', suggestions: [] },
      2000,
    );
    await page.goto('/demo/button.html');

    // Open the chat manually while the concierge is still analyzing
    const fab = page.locator('algolia-chat').getByRole('button').first();
    await fab.click();

    // Panel is open, so the FAB (and its spinner) must not be rendered at all
    await expect(page.locator('algolia-chat').locator(CLOSE_BUTTON)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('algolia-chat').locator(FAB_ANALYZING)).toHaveCount(0);
  });

  // ── 8. No double-engagement ───────────────────────────────────────────────

  test('concierge is not called when a valid cached greeting already exists', async ({ page }) => {
    // Pre-populate a fresh cache
    await page.goto('/demo/');
    await page.evaluate(() => {
      localStorage.setItem('acs_pending_greeting', JSON.stringify({
        greeting: 'Cached greeting already here',
        suggestions: [],
        ts: Date.now(),
      }));
    });

    let conciergeCallCount = 0;
    await page.route(CONCIERGE_URL, (route) => {
      conciergeCallCount++;
      route.fulfill({
        status: 200,
        body: mockConciergeSSE({ engage: true, greeting: 'Should not appear' }),
      });
    });

    // Navigate — showCachedGreeting fires, runProactiveAnalysis skips concierge
    await page.goto('/demo/button.html');

    const greeting = page.locator('algolia-chat').getByText('Cached greeting already here');
    await expect(greeting).toBeVisible({ timeout: 5000 });

    // Wait past the 1.5 s analysis timer to confirm concierge is skipped
    await page.waitForTimeout(2500);
    expect(conciergeCallCount).toBe(0);
  });
});

// ── Persona direction attributes ──────────────────────────────────────────────
//
// Switching persona used to do two things: swap the agent, and relabel the
// header. What the persona meant for an answer lived only in the agent's
// published prompt, so nothing on the page could be checked against it. The
// attributes now live in the visitor's stored profile and travel with every
// message, which is what these assert — that picking "Developer" demonstrably
// asks for code, "Designer" for colour and styling, and "Product Manager" for
// migration and altitude.

test.describe('Persona direction attributes', () => {
  /**
   * The primary agent declared by the demo pages. It answers whenever no
   * persona overrides it, which is the `auto` case.
   */
  const DEMO_PRIMARY_ID = '95826da6-d1b6-4b81-b061-bfb52b881356';

  /** An instant one-frame completion, enough to satisfy the widget. */
  const ANSWER_BODY = '0:"Sourced answer."\n';

  /** Persona agent IDs, read from the generated config rather than duplicated. */
  async function personaAgentIds(page: Page): Promise<Record<string, string>> {
    const res = await page.request.get('/context/agents.generated.json');
    return (await res.json()).personaAgents;
  }

  /**
   * Record the bodies sent to one agent, with everything else on the page
   * silenced.
   *
   * The scoping matters: the demo declares a classifier and four confidence
   * judges alongside the answering agent, and they all POST to
   * `/agents/<id>/completions`. A single catch-all route would collect their
   * bodies too and there would be no telling which one carried the persona.
   */
  async function captureAgentCalls(page: Page, agentId: string): Promise<string[]> {
    const bodies: string[] = [];

    // Registered first, so the specific routes below take precedence.
    await page.route('**/agents/*/completions**', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: ANSWER_BODY }),
    );
    await page.route(`**/agents/${CONCIERGE_ID}/completions**`, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: mockConciergeSSE({ engage: false }),
      }),
    );
    await page.route(`**/agents/${agentId}/completions**`, (route: Route) => {
      bodies.push(route.request().postData() ?? '');
      return route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: ANSWER_BODY,
      });
    });

    return bodies;
  }

  /**
   * The `content` of the last user message in a captured request body. Parsing
   * rather than substring-matching the raw body: the context block is JSON
   * nested inside JSON, so every quote in it is escaped on the wire.
   */
  function userMessage(body: string): string {
    const { messages } = JSON.parse(body);
    return messages[messages.length - 1].content;
  }

  function lastUserMessage(bodies: string[]): string {
    return userMessage(bodies[bodies.length - 1]);
  }

  /** Switch to `persona`, ask a question, and return what the agent was sent. */
  async function askAs(page: Page, persona: string, question: string): Promise<string> {
    const ids = await personaAgentIds(page);
    const bodies = await captureAgentCalls(page, ids[persona]);

    await page.goto('/demo/button.html');
    await page.locator('#acs-persona-dropdown select').selectOption(persona);
    await page.evaluate((q) => document.querySelector('algolia-chat')?.ask(q), question);

    await expect.poll(() => bodies.length).toBeGreaterThan(0);
    return lastUserMessage(bodies);
  }

  test('the developer persona asks the agent for code, not design detail', async ({ page }) => {
    const sent = await askAs(page, 'developer', 'how do I disable this?');

    expect(sent).toContain('"key": "developer"');
    expect(sent).toContain('"code": "high"');
    expect(sent).toContain('CODE: high.');
    // The dial is what changes per persona, so the low ends matter as much.
    expect(sent).toContain('"visual": "low"');
    expect(sent).toContain('"strategy": "low"');
  });

  test('the designer persona asks for colour and styling, and suppresses code', async ({
    page,
  }) => {
    const sent = await askAs(page, 'designer', 'how do I disable this?');

    expect(sent).toContain('"key": "designer"');
    expect(sent).toContain('"visual": "high"');
    expect(sent).toContain('VISUAL: high.');
    expect(sent).toContain('design tokens');
    // Code is off entirely for designers, not merely deprioritised.
    expect(sent).toContain('"code": "none"');
    expect(sent).toContain('CODE: none.');
  });

  test('the pm persona asks for migration and the high-level view', async ({ page }) => {
    const sent = await askAs(page, 'pm', 'how do I disable this?');

    expect(sent).toContain('"key": "pm"');
    expect(sent).toContain('"strategy": "high"');
    expect(sent).toContain('STRATEGY: high.');
    expect(sent).toContain('migration');
    expect(sent).toContain('"code": "low"');
  });

  test('the attributes reach the concierge, so greetings are aimed too', async ({ page }) => {
    const conciergeBodies: string[] = [];
    await page.route('**/agents/*/completions**', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: ANSWER_BODY }),
    );
    await page.route(`**/agents/${CONCIERGE_ID}/completions**`, (route: Route) => {
      conciergeBodies.push(route.request().postData() ?? '');
      return route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: mockConciergeSSE({ engage: false }),
      });
    });

    await page.goto('/demo/button.html');
    // The concierge also runs on page load, as `auto` — wait for the call that
    // the persona switch triggers rather than whichever arrived first.
    await page.locator('#acs-persona-dropdown select').selectOption('designer');

    const designerCall = () =>
      conciergeBodies.map(userMessage).find((sent) => sent.includes('"persona": "designer"'));
    await expect.poll(() => designerCall() !== undefined).toBe(true);

    const sent = designerCall() ?? '';
    expect(sent).toContain('personaProfile');
    expect(sent).toContain('VISUAL: high.');
    // The greeting hook the concierge is told to open on for a designer.
    expect(sent).toContain('colour: semantic roles and the exact design tokens involved');
  });

  test('the auto persona steers the declared primary agent', async ({ page }) => {
    // `auto` has no agent of its own, so the stored profile is the only steer the
    // widget's declared primary gets.
    const bodies = await captureAgentCalls(page, DEMO_PRIMARY_ID);

    await page.goto('/demo/button.html');
    await page.evaluate(() => document.querySelector('algolia-chat')?.ask('what changed in S2?'));

    await expect.poll(() => bodies.length).toBeGreaterThan(0);
    const sent = lastUserMessage(bodies);
    expect(sent).toContain('"key": "auto"');
    expect(sent).toContain('CODE: medium.');
    // Only `auto` carries this: the other personas were chosen explicitly, so
    // second-guessing the choice from browsing history would override the visitor.
    expect(sent).toContain('inferLens');
  });

  test('the stored profile record is what gets sent, not the catalog', async ({ page }) => {
    // The payoff of storing the profile: editing the record changes the next
    // answer. A designer whose stored dial is turned up to `code: high` must be
    // sent the code directive, even though the catalog says designers get none.
    const ids = await personaAgentIds(page);
    const bodies = await captureAgentCalls(page, ids.designer);

    await page.goto('/demo/button.html');
    await page.locator('#acs-persona-dropdown select').selectOption('designer');

    await page.evaluate(() => {
      const profile = JSON.parse(localStorage.getItem('acs_profile') ?? '{}');
      profile.personaProfile.detail.code = 'high';
      profile.personaProfile.focus = 'Whatever the profile service says it is.';
      localStorage.setItem('acs_profile', JSON.stringify(profile));
    });
    await page.evaluate(() => document.querySelector('algolia-chat')?.ask('how do I disable this?'));

    await expect.poll(() => bodies.length).toBeGreaterThan(0);
    const sent = lastUserMessage(bodies);
    expect(sent).toContain('Whatever the profile service says it is.');
    // The dial is stored and its prose is rendered from it, so moving the level
    // moves the directive with it.
    expect(sent).toContain('"code": "high"');
    expect(sent).toContain('CODE: high.');
    expect(sent).not.toContain('CODE: none.');
    // Untouched attributes still come through as stored.
    expect(sent).toContain('VISUAL: high.');
  });
});

// ── The stored profile record ─────────────────────────────────────────────────
//
// `acs_profile` stands in for a profile service. These cover the record itself:
// that it is populated, that it survives, and how it recovers when the two
// fields that could disagree — `persona` and `personaProfile` — do.

test.describe('Stored persona profile', () => {
  /** The parsed `acs_profile` record. */
  async function storedProfile(page: Page) {
    return page.evaluate(() => JSON.parse(localStorage.getItem('acs_profile') ?? 'null'));
  }

  test.beforeEach(async ({ page }) => {
    await mockConcierge(page, { engage: false });
    await page.goto('/demo/');
    await clearStorage(page);
  });

  test('a first page load materialises the profile body in localStorage', async ({ page }) => {
    await page.goto('/demo/button.html');

    // Seeded on load rather than on the first question, so the record is
    // complete and inspectable before the visitor does anything.
    await expect.poll(async () => (await storedProfile(page))?.personaProfile?.key).toBe('auto');
    const profile = await storedProfile(page);
    expect(profile.personaProfile.detail).toEqual({
      code: 'medium',
      visual: 'medium',
      strategy: 'medium',
    });
  });

  test('switching persona writes that persona attributes into the record', async ({ page }) => {
    await page.goto('/demo/button.html');
    await page.locator('#acs-persona-dropdown select').selectOption('pm');

    await expect.poll(async () => (await storedProfile(page))?.personaProfile?.key).toBe('pm');
    const profile = await storedProfile(page);
    expect(profile.persona).toBe('pm');
    expect(profile.personaProfile.detail.strategy).toBe('high');
    expect(profile.personaProfile.leadWith[0]).toContain('migration');
  });

  test('a hand-tuned profile survives page loads instead of being re-seeded', async ({ page }) => {
    await page.goto('/demo/button.html');
    await page.locator('#acs-persona-dropdown select').selectOption('developer');
    await expect.poll(async () => (await storedProfile(page))?.personaProfile?.key).toBe('developer');

    await page.evaluate(() => {
      const profile = JSON.parse(localStorage.getItem('acs_profile') ?? '{}');
      profile.personaProfile.detail.strategy = 'high';
      localStorage.setItem('acs_profile', JSON.stringify(profile));
    });
    await page.reload();

    // Re-seeding on every load would silently revert whatever wrote the record.
    await expect
      .poll(async () => (await storedProfile(page))?.personaProfile?.detail?.strategy)
      .toBe('high');
  });

  test('renaming the persona alone refetches the matching profile body', async ({ page }) => {
    await page.goto('/demo/button.html');
    await page.locator('#acs-persona-dropdown select').selectOption('developer');
    await expect.poll(async () => (await storedProfile(page))?.personaProfile?.key).toBe('developer');

    // Changing only the name would otherwise send the developer body under the
    // designer's label, and pick the designer's agent to receive it.
    await page.evaluate(() => {
      const profile = JSON.parse(localStorage.getItem('acs_profile') ?? '{}');
      profile.persona = 'designer';
      localStorage.setItem('acs_profile', JSON.stringify(profile));
    });
    await page.reload();

    await expect.poll(async () => (await storedProfile(page))?.personaProfile?.key).toBe('designer');
    expect((await storedProfile(page)).personaProfile.detail.code).toBe('none');
  });

  test('a persona this build no longer has resets to auto', async ({ page }) => {
    // A record written by an older build, or by a profile service that knows
    // personas this one does not. Sending no direction at all would silently
    // un-tune the agent, so it falls back rather than passing nothing through.
    await page.goto('/demo/button.html');
    await page.evaluate(() => {
      localStorage.setItem(
        'acs_profile',
        JSON.stringify({ persona: 'retired-persona', firstSeen: Date.now(), visits: 2 }),
      );
    });
    await page.reload();

    await expect.poll(async () => (await storedProfile(page))?.persona).toBe('auto');
    const profile = await storedProfile(page);
    expect(profile.personaProfile.key).toBe('auto');
    // Normalising the name too, so the mismatch is not re-detected every turn.
    expect(profile.personaProfile.inferLens).toBeTruthy();
  });
});

// ── Reusable element API ──────────────────────────────────────────────────────
//
// These exercise <algolia-chat> as a standalone component, independent of the
// demo's context-engine, to guard the contract third-party hosts rely on.

test.describe('Element API (host integration contract)', () => {
  test.beforeEach(async ({ page }) => {
    await mockConcierge(page, { engage: false });
  });

  test('commands issued before the React tree mounts are replayed, not dropped', async ({
    page,
  }) => {
    // Fire engage() at the earliest possible instant: the moment the element is
    // both parsed into the DOM and upgraded. That is still during HTML parsing,
    // long before the React effect that populates the internal API — so this
    // only works because the element buffers the command.
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        const el = document.querySelector('algolia-chat');
        if (!el || typeof el.engage !== 'function') return;
        observer.disconnect();
        el.engage({ greeting: 'Buffered before mount', suggestions: ['Replayed chip'] });
      });
      // `document`, not documentElement — this runs before <html> exists.
      observer.observe(document, { childList: true, subtree: true });
    });

    await page.goto('/demo/button.html');

    const chat = page.locator('algolia-chat');
    await expect(chat.getByText('Buffered before mount')).toBeVisible({ timeout: 5000 });
    await expect(chat.getByRole('button', { name: 'Replayed chip' })).toBeVisible();
  });

  test('engage() emits algolia-chat-engaged with the greeting detail', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __engaged: unknown[] }).__engaged = [];
      document.addEventListener('algolia-chat-engaged', (e) => {
        (window as unknown as { __engaged: unknown[] }).__engaged.push(
          (e as CustomEvent).detail,
        );
      });
    });

    await page.goto('/demo/button.html');
    await page.evaluate(() => {
      document.querySelector('algolia-chat')?.engage({
        greeting: 'Event payload greeting',
        suggestions: ['a', 'b'],
      });
    });

    const detail = await page.evaluate(
      () => (window as unknown as { __engaged: Array<Record<string, unknown>> }).__engaged,
    );
    expect(detail).toHaveLength(1);
    expect(detail[0]).toEqual({
      greeting: 'Event payload greeting',
      suggestions: ['a', 'b'],
    });
  });

  test('setPersona() emits persona-change and normalises empty ids to null', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __persona: unknown[] }).__persona = [];
      document.addEventListener('algolia-chat-persona-change', (e) => {
        (window as unknown as { __persona: unknown[] }).__persona.push(
          (e as CustomEvent).detail,
        );
      });
    });

    await page.goto('/demo/button.html');
    await page.evaluate(() => {
      const el = document.querySelector('algolia-chat');
      el?.setPersona('agent-123', 'Developer');
      el?.setPersona('   '); // whitespace-only → treated as "clear override"
    });

    const events = await page.evaluate(
      () => (window as unknown as { __persona: Array<Record<string, unknown>> }).__persona,
    );
    expect(events).toEqual([
      { agentId: 'agent-123', label: 'Developer' },
      { agentId: null, label: null },
    ]);
  });

  test('engage() ignores an empty greeting instead of opening a blank panel', async ({ page }) => {
    await page.goto('/demo/button.html');

    await page.evaluate(() => {
      document.querySelector('algolia-chat')?.engage({ greeting: '   ' });
    });

    // Panel must stay closed — no close button is rendered
    await expect(page.locator('algolia-chat').locator(CLOSE_BUTTON)).toHaveCount(0);
  });

  test('open/close transitions emit algolia-chat-open-change once each', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __open: boolean[] }).__open = [];
      document.addEventListener('algolia-chat-open-change', (e) => {
        (window as unknown as { __open: boolean[] }).__open.push(
          (e as CustomEvent<{ open: boolean }>).detail.open,
        );
      });
    });

    await page.goto('/demo/button.html');
    const chat = page.locator('algolia-chat');

    await chat.getByRole('button').first().click();
    await expect(chat.locator(CLOSE_BUTTON)).toBeVisible({ timeout: 5000 });

    // open() while already open must not emit a duplicate
    await page.evaluate(() => document.querySelector('algolia-chat')?.open());
    await chat.locator(CLOSE_BUTTON).click();
    await expect(chat.locator(CLOSE_BUTTON)).toHaveCount(0);

    expect(await page.evaluate(() => (window as unknown as { __open: boolean[] }).__open)).toEqual([
      true,
      false,
    ]);
  });
});

// ── Auto-engage preference ────────────────────────────────────────────────────

test.describe('Auto-engage toggle', () => {
  const TOGGLE_ON = 'button[aria-pressed="true"]';
  const TOGGLE_OFF = 'button[aria-pressed="false"]';

  test.beforeEach(async ({ page }) => {
    await mockConcierge(page, { engage: false });
    await page.goto('/demo/');
    await clearStorage(page);
  });

  test('toggle is shown in the header and defaults to on', async ({ page }) => {
    await page.goto('/demo/button.html');
    const chat = page.locator('algolia-chat');
    await chat.getByRole('button').first().click();

    await expect(chat.locator(TOGGLE_ON)).toBeVisible({ timeout: 5000 });
  });

  test('turning it off persists the preference and blocks proactive greetings', async ({ page }) => {
    await page.goto('/demo/button.html');
    const chat = page.locator('algolia-chat');

    await chat.getByRole('button').first().click();
    await chat.locator(TOGGLE_ON).click();
    await expect(chat.locator(TOGGLE_OFF)).toBeVisible();

    // Preference is persisted under the widget's namespaced key
    expect(await page.evaluate(() => localStorage.getItem('algolia-chat:auto-engage'))).toBe('off');

    // engage() is now refused, so no greeting appears
    const accepted = await page.evaluate(() =>
      document.querySelector('algolia-chat')?.engage({ greeting: 'Should be blocked' }),
    );
    expect(accepted).toBe(false);
    await expect(chat.getByText('Should be blocked')).toHaveCount(0);
  });

  test('preference survives navigation and suppresses the concierge call', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('algolia-chat:auto-engage', 'off'));

    let conciergeCalls = 0;
    await page.route(CONCIERGE_URL, (route) => {
      conciergeCalls++;
      route.fulfill({
        status: 200,
        body: mockConciergeSSE({ engage: true, greeting: 'Should never appear' }),
      });
    });

    await page.goto('/demo/button.html');
    await page.waitForTimeout(2500);

    const chat = page.locator('algolia-chat');
    await expect(chat.getByText('Should never appear')).toHaveCount(0);
    expect(conciergeCalls).toBe(0);

    // The control reflects the persisted choice on the new page
    await chat.getByRole('button').first().click();
    await expect(chat.locator(TOGGLE_OFF)).toBeVisible({ timeout: 5000 });
  });

  test('toggling emits algolia-chat-auto-engage-change', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __pref: boolean[] }).__pref = [];
      document.addEventListener('algolia-chat-auto-engage-change', (e) => {
        (window as unknown as { __pref: boolean[] }).__pref.push(
          (e as CustomEvent<{ enabled: boolean }>).detail.enabled,
        );
      });
    });

    await page.goto('/demo/button.html');
    const chat = page.locator('algolia-chat');
    await chat.getByRole('button').first().click();

    await chat.locator(TOGGLE_ON).click();
    await expect(chat.locator(TOGGLE_OFF)).toBeVisible();
    await chat.locator(TOGGLE_OFF).click();
    await expect(chat.locator(TOGGLE_ON)).toBeVisible();

    expect(await page.evaluate(() => (window as unknown as { __pref: boolean[] }).__pref)).toEqual([
      false,
      true,
    ]);
  });

  test('closing an auto-opened chat still allows engagement on the next page', async ({ page }) => {
    // The originally reported problem: a once-per-session lock meant dismissing
    // the panel permanently stopped re-engagement for the rest of the session.
    await mockConcierge(page, { engage: true, greeting: 'Greeting one', suggestions: [] });
    await page.goto('/demo/button.html');

    const chat = page.locator('algolia-chat');
    await expect(chat.getByText('Greeting one')).toBeVisible({ timeout: 10000 });

    // Dismiss it, then navigate on
    await chat.locator(CLOSE_BUTTON).click();
    await expect(chat.locator(CLOSE_BUTTON)).toHaveCount(0);

    await mockConcierge(page, { engage: true, greeting: 'Greeting two', suggestions: [] });
    await page.goto('/demo/combobox.html');

    await expect(page.locator('algolia-chat').getByText('Greeting two')).toBeVisible({
      timeout: 10000,
    });
  });
});
