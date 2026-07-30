import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DEAD_MARKERS = ['consult_technical_specialist', '[[FOLLOWUP:'];

for (const file of ['instructions_generic.md', 'instructions_technical.md']) {
  test(`${file} has no dangling references to removed mechanisms`, () => {
    const content = readFileSync(join(here, file), 'utf8');
    for (const marker of DEAD_MARKERS) {
      assert.ok(
        !content.includes(marker),
        `${file} still contains removed-mechanism marker: ${marker}`,
      );
    }
  });
}
