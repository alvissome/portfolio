import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prioritizeUniverse, createResearchState, acknowledgeResearchRequest,
  requestMatches, setProcessingState, setValidationState, normalizeSupports,
  normalizeResearchResult, applyResearchResult, ivPercentError, compareSupportLevels,
} from '../assets/research-core.js';

const request = {securityId: 'EXAMPLE@VENUE', requestId: 'request-one', modelVersion: 'model-one'};
const meta = {source: 'Example dated input', method: 'Example method', asOf: '2026-11-03'};
const acknowledged = () => acknowledgeResearchRequest(createResearchState(request),
  {...request, acknowledged: true}).state;

test('priorities deduplicate held listings across accounts and append watchlist-only entries', () => {
  const result = prioritizeUniverse([
    {ticker: 'EXAMPLE', accountType: 'Cash'},
    {ticker: 'EXAMPLE', accountType: 'Retirement - SRS'},
    {ticker: 'SECOND'}, {ticker: 'EXITED', exited: true},
  ], [{symbol: 'THIRD'}, {symbol: 'EXAMPLE'}, {symbol: 'THIRD'}, {symbol: 'EXITED'}]);
  assert.deepEqual(result.map(row => row.securityId), ['EXAMPLE', 'SECOND', 'THIRD', 'EXITED']);
  assert.deepEqual(result[0], {securityId: 'EXAMPLE', symbol: 'EXAMPLE', held: true,
    watchlisted: true, priority: 'holding'});
  assert.equal(result[3].held, false);
});

test('caller instrument identities remain exact and do not merge different listings', () => {
  const result = prioritizeUniverse([
    {securityId: 'ONE@VENUE-A', ticker: 'ONE'},
    {securityId: 'ONE@VENUE-B', ticker: 'ONE'},
    {securityId: 'one@venue-a', ticker: 'one'},
  ], []);
  assert.equal(result.length, 3);
  assert.equal(requestMatches(request, {...request, securityId: 'example@venue'}), false);
});

test('unacknowledged jobs never appear pending or completed', () => {
  const state = createResearchState(request);
  assert.equal(state.iv.processing, 'not_started');
  assert.throws(() => setProcessingState(state, 'iv', 'processing'), /acknowledgement/);
  assert.equal(acknowledgeResearchRequest(state, request).accepted, false);
  const response = applyResearchResult(state,
    {...request, part: 'iv', result: {...meta, value: 12}});
  assert.equal(response.accepted, false);
  assert.equal(response.state, state);
  const blocked = setProcessingState(state, 'supports', 'blocked', 'Data source unavailable');
  assert.equal(blocked.supports.processing, 'blocked');
  assert.equal(blocked.iv.processing, 'not_started');
});

test('stale security, request or model completions leave research unchanged', () => {
  const state = acknowledged();
  for (const change of [{securityId: 'OTHER@VENUE'}, {requestId: 'old-request'}, {modelVersion: 'old-model'}]) {
    const result = applyResearchResult(state,
      {...request, ...change, part: 'iv', result: {...meta, value: 12}});
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'stale_request');
    assert.equal(result.state, state);
  }
});

test('IV and supports processing/validation remain independent', () => {
  const initial = acknowledged();
  const complete = applyResearchResult(initial,
    {...request, part: 'iv', result: {...meta, value: '12.50'}}).state;
  assert.equal(complete.iv.processing, 'completed');
  assert.equal(complete.iv.result.value, 12.5);
  assert.equal(complete.supports.processing, 'queued');
  assert.equal(initial.iv.processing, 'queued');
  const reviewed = setValidationState(complete, 'iv', 'validated');
  assert.equal(reviewed.iv.validation, 'validated');
  assert.equal(reviewed.supports.validation, 'not_validated');
  assert.throws(() => setValidationState(reviewed, 'supports', 'validated'), /completed result/);
  assert.equal(Object.hasOwn(reviewed, 's1'), false);
  assert.equal(Object.hasOwn(reviewed, 'watchlist'), false);
});

test('missing IV remains unavailable; blank is distinct from a numeric zero', () => {
  assert.equal(normalizeResearchResult('iv', {value: ' '}).value, null);
  assert.equal(normalizeResearchResult('iv', {value: null}).available, false);
  assert.equal(normalizeResearchResult('iv', {...meta, value: 0}).value, 0);
  assert.equal(normalizeResearchResult('iv', {...meta, value: -5}).value, -5);
  assert.throws(() => normalizeResearchResult('iv', {value: 0}), /needs source/);
  const state = applyResearchResult(acknowledged(),
    {...request, part: 'iv', result: {value: null}}).state;
  assert.equal(state.iv.processing, 'unavailable');
  assert.equal(state.supports.processing, 'queued');
  assert.equal(ivPercentError('', 12), null);
  assert.equal(ivPercentError(0, 12), null);
  assert.equal(ivPercentError(10, 0), 100);
});

test('completed numeric results require valid source, method and as-of metadata', () => {
  for (const missing of ['source', 'method', 'asOf']) {
    assert.throws(() => normalizeResearchResult('iv', {...meta, [missing]: null, value: 10}), /needs/);
  }
  assert.throws(() => normalizeResearchResult('supports', {...meta, asOf: '2026-02-30', value: [10]}), /valid ISO/);
  assert.throws(() => normalizeResearchResult('iv', {...meta, value: Infinity}), /Invalid IV/);
  assert.throws(() => normalizeResearchResult('iv', {...meta, value: true}), /Invalid IV/);
});

test('support levels allow zero to five actual levels without placeholder zeroes', () => {
  assert.deepEqual(normalizeSupports([null, '', '10', undefined, '8']), [10, 8]);
  assert.deepEqual(normalizeSupports([]), []);
  for (const bad of [[0], [-2], [10, 10], [8, 10], [6, 5, 4, 3, 2, 1]]) {
    assert.throws(() => normalizeSupports(bad));
  }
  assert.throws(() => normalizeResearchResult('supports', {value: [10]}), /needs source/);
});

test('ordered support matching prevents many-to-one matches and counts omissions/extras', () => {
  const result = compareSupportLevels([100, 99, 80], [99.5, 79, 60]);
  assert.equal(result.matchedCount, 2);
  assert.equal(result.missingCount, 1);
  assert.equal(result.extraCount, 1);
  assert.equal(new Set(result.matches.map(row => row.calculatedIndex)).size, 2);
  assert.equal(new Set(result.matches.map(row => row.referenceIndex)).size, 2);
  assert.ok(result.matches[0].referenceIndex < result.matches[1].referenceIndex);
  assert.ok(result.matches[0].calculatedIndex < result.matches[1].calculatedIndex);
  assert.equal(compareSupportLevels([100, 90], [102, 88.2]).matchedCount, 2);
});

test('support comparisons expose no benchmark and prefer lower-error one-to-one matches', () => {
  const empty = compareSupportLevels([], [10]);
  assert.equal(empty.referenceCoverage, null);
  assert.equal(empty.extraCount, 1);
  assert.equal(empty.meanErrorPct, null);
  const result = compareSupportLevels([100, 99], [99.2]);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.matches[0].reference, 99);
  assert.equal(result.missingCount, 1);
  assert.equal(ivPercentError(100, 95), 5);
});
