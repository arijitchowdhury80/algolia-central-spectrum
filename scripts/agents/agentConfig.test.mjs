import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAgentName,
  buildSuggestionsConfig,
  buildAgentBody,
  assertSuggestionsEnabled,
  PERSONAS,
} from './agentConfig.mjs';

test('buildAgentName applies a suffix', () => {
  assert.equal(buildAgentName('ACS-generic-neural', '-dev'), 'ACS-generic-neural-dev');
});

test('buildAgentName with empty suffix is unchanged (backward-compatible default)', () => {
  assert.equal(buildAgentName('ACS-generic-neural', ''), 'ACS-generic-neural');
});

test('buildSuggestionsConfig returns the locked spec shape', () => {
  const c = buildSuggestionsConfig('test prompt');
  assert.equal(c.enabled, true);
  assert.equal(c.model, 'gemini-2.5-flash');
  assert.equal(c.system_prompt, 'test prompt');
  assert.deepEqual(c.generation, { max_count: 1 });
  assert.deepEqual(c.context, { include_tool_outputs: true });
});

test('buildAgentBody PATCH path carries config.suggestions and omits name/status', () => {
  const body = buildAgentBody({
    instructions: 'i',
    model: 'm',
    providerId: 'p',
    tools: [],
    suggestionsConfig: buildSuggestionsConfig('x'),
  });
  assert.equal(body.config.suggestions.enabled, true);
  assert.equal('name' in body, false);
  assert.equal('status' in body, false);
});

test('buildAgentBody POST path includes name/status', () => {
  const body = buildAgentBody({
    name: 'x',
    status: 'published',
    instructions: 'i',
    model: 'm',
    providerId: 'p',
    tools: [],
    suggestionsConfig: buildSuggestionsConfig('x'),
  });
  assert.equal(body.name, 'x');
  assert.equal(body.status, 'published');
  assert.equal(body.config.suggestions.enabled, true);
});

test('R12 regression: Generic persona has no consult_technical_specialist tool', () => {
  const generic = PERSONAS.find((p) => p.name === 'ACS-generic-neural');
  assert.deepEqual(generic.extraTools, []);
  assert.equal(JSON.stringify(PERSONAS).includes('consult_technical_specialist'), false);
});
