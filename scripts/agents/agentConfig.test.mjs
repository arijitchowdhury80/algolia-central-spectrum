import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAgentName,
  buildSuggestionsConfig,
  buildAgentBody,
  assertSuggestionsEnabled,
  scopeTools,
  INDEX,
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

// --- A1: noSearchTool escape hatch + suggestions-off support ---

test('scopeTools with noSearchTool:true returns an empty array regardless of input tools', () => {
  const tools = [{ type: 'algolia_search_index', indices: [{ index: 'x' }] }];
  assert.deepEqual(scopeTools(tools, null, 'd', { noSearchTool: true }), []);
});

test('scopeTools with no options arg (default noSearchTool:false) is unchanged existing behavior', () => {
  const tools = [{ type: 'algolia_search_index', indices: [{ index: 'x' }] }];
  const result = scopeTools(tools, null, 'd');
  assert.equal(result.length, 1);
  assert.equal(result[0].indices[0].index, INDEX);
});

test('buildSuggestionsConfig 1-arg call still defaults enabled:true (backward-compat regression guard)', () => {
  const c = buildSuggestionsConfig('p');
  assert.equal(c.enabled, true);
});

test('buildSuggestionsConfig("p", false) sets enabled:false, other fields unchanged', () => {
  const c = buildSuggestionsConfig('p', false);
  assert.equal(c.enabled, false);
  assert.equal(c.model, 'gemini-2.5-flash');
  assert.equal(c.system_prompt, 'p');
  assert.deepEqual(c.generation, { max_count: 1 });
  assert.deepEqual(c.context, { include_tool_outputs: true });
});

// --- A4: classifier persona wiring ---

test('PERSONAS gains the ACS-classifier-neural entry with the pinned fields', () => {
  const classifier = PERSONAS.find((p) => p.name === 'ACS-classifier-neural');
  assert.ok(classifier, 'expected a PERSONAS entry named ACS-classifier-neural');
  assert.equal(classifier.noSearchTool, true);
  assert.equal(classifier.expectSuggestions, false);
  assert.equal(classifier.prompt, 'instructions_classifier.md');
});

test('PERSONAS.length === 3 (regression guard against a lost or duplicated entry)', () => {
  assert.equal(PERSONAS.length, 3);
});
