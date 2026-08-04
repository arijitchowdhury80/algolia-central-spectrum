/**
 * <algolia-chat> configuration surface — end-to-end tests
 *
 * Proves the proactive/launcher options are configurable from the host page via
 * attributes, slots, and the strings override, rather than being hardcoded.
 *
 * Each test serves its own minimal host page (no context-engine, no demo chrome)
 * so the widget is exercised as a standalone embeddable component.
 */
import { test, expect, type Page } from '@playwright/test';

const APP_ID = '0EXRPAXB56';
const API_KEY = 'REDACTED';
const INDEX = 'ACS_SPECTRUM_MULTI';
const PRIMARY_AGENT = '95826da6-d1b6-4b81-b061-bfb52b881356';

const FIXTURE_URL = 'http://localhost:5174/__config-fixture.html';

/**
 * Serve a bare host page containing a single <algolia-chat> configured with the
 * given attributes and inner markup, loading the real built bundles.
 */
async function serveFixture(
  page: Page,
  { attrs = '', children = '' }: { attrs?: string; children?: string },
) {
  await page.route(FIXTURE_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
<html><head><meta charset="utf-8"><title>config fixture</title></head>
<body>
<script src="/widget-bundles/algolia-confidence-badge.js"></script>
<script src="/widget-bundles/algolia-chat.js"></script>
<algolia-instant-search app-id="${APP_ID}" api-key="${API_KEY}" index-name="${INDEX}">
  <algolia-chat app-id="${APP_ID}" search-api-key="${API_KEY}" index-name="${INDEX}" ${attrs}>
    <algolia-agent role="primary" agent-id="${PRIMARY_AGENT}" label="Assistant"></algolia-agent>
    ${children}
  </algolia-chat>
</algolia-instant-search>
</body></html>`,
    }),
  );

  await page.goto(FIXTURE_URL);
  // The launcher only exists once the element has mounted its React tree.
  await page.locator('algolia-chat').getByRole('button').first().waitFor({ timeout: 10_000 });
}

/** Clear the widget's persisted visitor preference. */
async function clearPref(page: Page) {
  await page.goto(FIXTURE_URL).catch(() => {});
  await page.evaluate(() => localStorage.removeItem('algolia-chat:auto-engage')).catch(() => {});
}

const TOGGLE_ON = 'button[aria-pressed="true"]';
const TOGGLE_OFF = 'button[aria-pressed="false"]';
const CLOSE_BUTTON = '[aria-label="Close chat"]';

test.describe('Launcher icon', () => {
  test('defaults to the built-in inline mark (no host asset required)', async ({ page }) => {
    await serveFixture(page, {});
    const fab = page.locator('algolia-chat').getByRole('button').first();

    // Built-in glyph is inline SVG using currentColor, not an <img>
    expect(await fab.locator('svg').count()).toBeGreaterThan(0);
    await expect(fab.locator('img')).toHaveCount(0);
    expect(await fab.locator('svg path').first().getAttribute('fill')).toBe('currentColor');
  });

  test('is configurable via the launcher-icon attribute', async ({ page }) => {
    await serveFixture(page, { attrs: 'launcher-icon="/brand/new-chat.svg"' });
    const img = page.locator('algolia-chat').getByRole('button').first().locator('img');

    await expect(img).toHaveAttribute('src', '/brand/new-chat.svg');
  });

  test('is configurable via an <img slot="launcher-icon"> child', async ({ page }) => {
    await serveFixture(page, {
      children: '<img slot="launcher-icon" src="/brand/algolia-mark.svg" alt="">',
    });
    const img = page.locator('algolia-chat').getByRole('button').first().locator('img');

    await expect(img).toHaveAttribute('src', '/brand/algolia-mark.svg');
  });
});

test.describe('Slot config is read after parsing', () => {
  /**
   * Regression: the parser upgrades a custom element at its start tag, so a
   * connectedCallback that reads children sees none of them when the widget
   * script loads before the markup (the documented order). Slot-based config was
   * silently ignored — attributes worked, slots didn't.
   */
  test('slots are honoured when the widget script loads before the markup', async ({ page }) => {
    const url = 'http://localhost:5174/__slot-order.html';
    await page.route(url, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script src="/widget-bundles/algolia-confidence-badge.js"></script>
<script src="/widget-bundles/algolia-chat.js"></script>
<algolia-instant-search app-id="${APP_ID}" api-key="${API_KEY}" index-name="${INDEX}">
  <algolia-chat app-id="${APP_ID}" search-api-key="${API_KEY}" index-name="${INDEX}" auto-engage-toggle>
    <algolia-agent role="primary" agent-id="${PRIMARY_AGENT}"></algolia-agent>
    <img slot="launcher-icon" src="/brand/from-slot.svg" alt="">
    <script type="application/json" slot="strings">{"widget":{"autoEngageOn":"From slot"}}</script>
  </algolia-chat>
</algolia-instant-search>
</body></html>`,
      }),
    );
    await page.goto(url);

    const fab = page.locator('algolia-chat').getByRole('button').first();
    await fab.waitFor({ timeout: 10_000 });
    await expect(fab.locator('img')).toHaveAttribute('src', '/brand/from-slot.svg');

    await fab.click();
    await expect(
      page.locator('algolia-chat').locator('button[aria-label="From slot"]'),
    ).toHaveCount(1);
  });
});

test.describe('Auto-engage configuration', () => {
  test('toggle control is hidden unless the host opts in', async ({ page }) => {
    await serveFixture(page, {});
    const chat = page.locator('algolia-chat');
    await chat.getByRole('button').first().click();
    await expect(chat.locator(CLOSE_BUTTON)).toBeVisible({ timeout: 5000 });

    await expect(chat.locator(TOGGLE_ON)).toHaveCount(0);
    await expect(chat.locator(TOGGLE_OFF)).toHaveCount(0);
  });

  test('auto-engage="false" ships proactive engagement off by default', async ({ page }) => {
    await serveFixture(page, { attrs: 'auto-engage="false" auto-engage-toggle' });
    await clearPref(page);
    await serveFixture(page, { attrs: 'auto-engage="false" auto-engage-toggle' });

    // engage() is refused while the default is off
    const accepted = await page.evaluate(() =>
      document.querySelector('algolia-chat')?.engage({ greeting: 'Blocked by default' }),
    );
    expect(accepted).toBe(false);

    const chat = page.locator('algolia-chat');
    await chat.getByRole('button').first().click();
    await expect(chat.locator(TOGGLE_OFF)).toBeVisible({ timeout: 5000 });
  });

  test('a stored visitor choice wins over the host default', async ({ page }) => {
    await serveFixture(page, { attrs: 'auto-engage="false" auto-engage-toggle' });
    // Visitor explicitly turned it ON, despite the host defaulting to off
    await page.evaluate(() => localStorage.setItem('algolia-chat:auto-engage', 'on'));
    await serveFixture(page, { attrs: 'auto-engage="false" auto-engage-toggle' });

    const accepted = await page.evaluate(() =>
      document.querySelector('algolia-chat')?.engage({ greeting: 'Visitor opted in' }),
    );
    expect(accepted).toBe(true);
    await expect(page.locator('algolia-chat').getByText('Visitor opted in')).toBeVisible();
  });
});

test.describe('Strings override', () => {
  test('proactive + toggle strings are overridable via the strings attribute', async ({ page }) => {
    const strings = JSON.stringify({
      widget: {
        autoEngageOn: 'Suggestions aan',
        proactivePersonaLabel: '{persona} helper',
        proactiveGreetingLabel: 'Voorstel',
      },
    }).replace(/"/g, '&quot;');

    await serveFixture(page, { attrs: `auto-engage-toggle strings="${strings}"` });
    await clearPref(page);
    await serveFixture(page, { attrs: `auto-engage-toggle strings="${strings}"` });

    await page.evaluate(() => {
      const el = document.querySelector('algolia-chat');
      el?.setPersona('agent-x', 'Designer');
      el?.engage({ greeting: 'Hallo daar' });
    });

    const chat = page.locator('algolia-chat');
    // Persona eyebrow uses the overridden template + {persona} interpolation
    await expect(chat.getByText('Designer helper')).toBeVisible({ timeout: 5000 });
    // Greeting region label and toggle tooltip come from the override too
    await expect(chat.locator('[aria-label="Voorstel"]')).toHaveCount(1);
    await expect(chat.locator('button[aria-label="Suggestions aan"]')).toHaveCount(1);
  });

  test('strings are overridable via a <script slot="strings"> child', async ({ page }) => {
    await serveFixture(page, {
      attrs: 'auto-engage-toggle',
      children: `<script type="application/json" slot="strings">
        {"widget":{"autoEngageOn":"Slot-configured label"}}
      </script>`,
    });

    const chat = page.locator('algolia-chat');
    await chat.getByRole('button').first().click();
    await expect(chat.locator('button[aria-label="Slot-configured label"]')).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe('Visitor context', () => {
  const PRIMARY_URL = `**/agents/${PRIMARY_AGENT}/completions**`;
  const COMPOSER = 'textarea#acs-composer-input';

  /**
   * Record every request body the widget sends to the answering agent, answering
   * each with an instant one-frame stream so no real completion is needed.
   */
  async function captureAgentCalls(page: Page): Promise<string[]> {
    const bodies: string[] = [];
    await page.route(PRIMARY_URL, async (route) => {
      bodies.push(route.request().postData() ?? '');
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: '0:"Sourced answer."\n',
      });
    });
    return bodies;
  }

  /** The `content` of the last user message in a captured request body. */
  function lastUserMessage(bodies: string[]): string {
    const { messages } = JSON.parse(bodies[bodies.length - 1]);
    return messages[messages.length - 1].content;
  }

  async function sendViaComposer(page: Page, text: string) {
    const composer = page.locator('algolia-chat').locator(COMPOSER);
    await composer.fill(text);
    await composer.press('Enter');
  }

  test('a registered provider sends the visitor profile with the question', async ({ page }) => {
    await serveFixture(page, {});
    const bodies = await captureAgentCalls(page);

    await page.evaluate(() => {
      const el = document.querySelector('algolia-chat');
      el?.setContextProvider(() => ({
        persona: 'designer',
        visits: 4,
        pagesViewed: [{ path: '/demo/button.html', title: 'Button', dwellMs: 42_000 }],
        events: [{ type: 'cta_click', page: '/demo/button.html' }],
      }));
      el?.ask('what do you know about me');
    });

    await expect.poll(() => bodies.length).toBe(1);
    const sent = lastUserMessage(bodies);
    expect(sent).toContain('VISITOR CONTEXT');
    expect(sent).toContain('/demo/button.html');
    expect(sent).toContain('"visits": 4');
    // The question is the last thing the agent reads, so it can't be mistaken
    // for part of the context block.
    expect(sent).toContain("VISITOR'S MESSAGE");
    expect(sent.trimEnd().endsWith('what do you know about me')).toBe(true);

    // The visitor sees only their own words — the preamble never reaches the UI.
    const chat = page.locator('algolia-chat');
    await expect(chat.getByText('what do you know about me')).toBeVisible();
    await expect(chat.getByText('VISITOR CONTEXT')).toHaveCount(0);
  });

  test('nothing is added when the host registers no provider', async ({ page }) => {
    await serveFixture(page, {});
    const bodies = await captureAgentCalls(page);

    await page.evaluate(() => document.querySelector('algolia-chat')?.ask('how do I use Button?'));

    await expect.poll(() => bodies.length).toBe(1);
    expect(lastUserMessage(bodies)).toBe('how do I use Button?');
  });

  test('each turn carries a fresh snapshot, and history stays clean', async ({ page }) => {
    await serveFixture(page, {});
    const bodies = await captureAgentCalls(page);

    await page.evaluate(() => {
      const store = window as unknown as { __path: string };
      store.__path = '/demo/button.html';
      document
        .querySelector('algolia-chat')
        ?.setContextProvider(() => ({ currentPage: { path: store.__path } }));
    });

    const chat = page.locator('algolia-chat');
    await chat.getByRole('button').first().click();
    await sendViaComposer(page, 'first question');
    await expect.poll(() => bodies.length).toBe(1);
    expect(lastUserMessage(bodies)).toContain('/demo/button.html');

    // Visitor moves on: the next turn must reflect where they are now.
    await page.evaluate(() => {
      (window as unknown as { __path: string }).__path = '/demo/combobox.html';
    });
    await sendViaComposer(page, 'second question');
    await expect.poll(() => bodies.length).toBe(2);
    expect(lastUserMessage(bodies)).toContain('/demo/combobox.html');

    // Replayed history keeps the visitor's own words, so context blocks never
    // pile up turn after turn.
    const replayed = JSON.parse(bodies[1]).messages[0];
    expect(replayed.content).toBe('first question');
  });

  test('a provider that throws is ignored instead of breaking the turn', async ({ page }) => {
    await serveFixture(page, {});
    const bodies = await captureAgentCalls(page);

    await page.evaluate(() => {
      const el = document.querySelector('algolia-chat');
      el?.setContextProvider(() => {
        throw new Error('visitor store unavailable');
      });
      el?.ask('does Button support isPending?');
    });

    await expect.poll(() => bodies.length).toBe(1);
    expect(lastUserMessage(bodies)).toBe('does Button support isPending?');
    await expect(page.locator('algolia-chat').getByText('Sourced answer.')).toBeVisible();
  });
});

test.describe('Live reconfiguration', () => {
  /**
   * Every display attribute is observed, so changing one reconfigures the mounted
   * widget. Before, `<algolia-chat>` declared no observed attributes at all and a
   * post-mount change did nothing.
   */
  test('display attributes are applied to a mounted widget', async ({ page }) => {
    await serveFixture(page, { attrs: 'product-title="Before"' });
    const chat = page.locator('algolia-chat');
    await chat.getByRole('button').first().click();
    await expect(chat.getByText('Before')).toBeVisible({ timeout: 5000 });

    await page.evaluate(() =>
      document.querySelector('algolia-chat')?.setAttribute('product-title', 'After'),
    );

    await expect(chat.getByText('After')).toBeVisible();
    await expect(chat.getByText('Before')).toHaveCount(0);
  });

  test('launcher-icon and strings can be swapped after mount', async ({ page }) => {
    await serveFixture(page, { attrs: 'auto-engage-toggle' });
    const chat = page.locator('algolia-chat');

    await page.evaluate(() => {
      const el = document.querySelector('algolia-chat');
      el?.setAttribute('launcher-icon', '/brand/live.svg');
      el?.setAttribute('strings', JSON.stringify({ widget: { autoEngageOn: 'Live label' } }));
    });

    await expect(chat.getByRole('button').first().locator('img')).toHaveAttribute(
      'src',
      '/brand/live.svg',
    );
    await chat.getByRole('button').first().click();
    await expect(chat.locator('button[aria-label="Live label"]')).toHaveCount(1);
  });

  test('accent-color rebuilds the injected stylesheet', async ({ page }) => {
    await serveFixture(page, { attrs: 'accent-color="#003DFF"' });

    const readAccent = () =>
      page.evaluate(() => {
        const style = document.querySelector('algolia-chat')?.shadowRoot?.querySelector('style');
        return style?.textContent?.includes('#e2361b') ?? false;
      });

    expect(await readAccent()).toBe(false);
    await page.evaluate(() =>
      document.querySelector('algolia-chat')?.setAttribute('accent-color', '#e2361b'),
    );
    expect(await readAccent()).toBe(true);
  });

  test('changing an agent-id retargets the next question', async ({ page }) => {
    await serveFixture(page, {});

    const RETARGETED = '11111111-2222-3333-4444-555555555555';
    const calledAgents: string[] = [];
    await page.route('**/agents/*/completions**', async (route) => {
      calledAgents.push(new URL(route.request().url()).pathname.split('/agents/')[1].split('/')[0]);
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: '0:"Answer."\n',
      });
    });

    await page.evaluate(
      (id) => document.querySelector('algolia-agent')?.setAttribute('agent-id', id),
      RETARGETED,
    );

    // Re-registration goes through InstantSearch: the old widget is detached and
    // the new one added, and the agent map the chat reads is rebuilt on the next
    // (deferred) render pass rather than synchronously.
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('algolia-chat')?.ask('who answers this?'));

    await expect.poll(() => calledAgents).toContain(RETARGETED);
    expect(calledAgents).not.toContain(PRIMARY_AGENT);
  });

  test('credential changes are reported rather than silently ignored', async ({ page }) => {
    await serveFixture(page, {});
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });

    await page.evaluate(() => {
      document.querySelector('algolia-chat')?.setAttribute('app-id', 'SOME_OTHER_APP');
      document.querySelector('algolia-instant-search')?.setAttribute('index-name', 'other_index');
    });

    await expect.poll(() => warnings.join('\n')).toMatch(/credentials are read once/);
    expect(warnings.join('\n')).toMatch(/re-insert <algolia-instant-search>/);
  });
});

test.describe('Agents configuration', () => {
  const INLINE_PRIMARY = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  /**
   * `RuntimeConfig.agents` existed but no attribute populated it, leaving the
   * `activeInstance.agents` fallback unreachable from HTML.
   */
  test('the agents attribute declares the primary agent without child elements', async ({
    page,
  }) => {
    const agents = JSON.stringify({
      primary: { id: INLINE_PRIMARY, label: 'Inline Assistant' },
    }).replace(/"/g, '&quot;');

    // No <algolia-agent> children — the attribute is the only agent config.
    await page.route('http://localhost:5174/__agents-attr.html', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script src="/widget-bundles/algolia-confidence-badge.js"></script>
<script src="/widget-bundles/algolia-chat.js"></script>
<algolia-instant-search app-id="${APP_ID}" search-api-key="${API_KEY}" index-name="${INDEX}">
  <algolia-chat app-id="${APP_ID}" api-key="${API_KEY}" index-name="${INDEX}" agents="${agents}">
  </algolia-chat>
</algolia-instant-search>
</body></html>`,
      }),
    );

    const called: string[] = [];
    await page.route('**/agents/*/completions**', async (route) => {
      called.push(new URL(route.request().url()).pathname.split('/agents/')[1].split('/')[0]);
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: '0:"Answer from the inline agent."\n',
      });
    });

    await page.goto('http://localhost:5174/__agents-attr.html');
    const chat = page.locator('algolia-chat');
    await chat.getByRole('button').first().waitFor({ timeout: 10_000 });

    await page.evaluate(() => document.querySelector('algolia-chat')?.ask('does this route?'));

    await expect.poll(() => called).toContain(INLINE_PRIMARY);
    await expect(chat.getByText('Answer from the inline agent.')).toBeVisible();
  });
});

test.describe('Attribute validation', () => {
  test('an unknown theme is reported instead of silently falling back', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });

    await serveFixture(page, { attrs: 'theme="not-a-theme"' });

    expect(warnings.join('\n')).toMatch(/Ignoring theme="not-a-theme"/);
    // The widget still renders, on the default skin.
    await expect(page.locator('algolia-chat').getByRole('button').first()).toBeVisible();
  });

  /**
   * `logo` used to be copied into both the header logo and the brand mark, so a
   * host could not set them apart. `logo-mark` now owns the mark; the header must
   * keep using `logo`.
   */
  test('logo-mark does not override the header logo', async ({ page }) => {
    await serveFixture(page, { attrs: 'logo="/brand/header.svg" logo-mark="/brand/mark.svg"' });

    const chat = page.locator('algolia-chat');
    await chat.getByRole('button').first().click();
    await expect(chat.locator(CLOSE_BUTTON)).toBeVisible({ timeout: 5000 });

    await expect(chat.locator('img[src="/brand/header.svg"]')).toHaveCount(1);
    await expect(chat.locator('img[src="/brand/mark.svg"]')).toHaveCount(0);
  });
});

test.describe('Analyzing timeout', () => {
  test('analyzing-timeout shortens the indicator safety net', async ({ page }) => {
    await serveFixture(page, { attrs: 'analyzing-timeout="1200"' });

    await page.evaluate(() => document.querySelector('algolia-chat')?.setAnalyzing(true));
    const fab = page.locator('algolia-chat').locator('button[aria-busy="true"]');
    await expect(fab).toHaveCount(1);

    // Never cleared by the caller — the configured timeout must clear it
    await expect(fab).toHaveCount(0, { timeout: 5000 });
  });
});
