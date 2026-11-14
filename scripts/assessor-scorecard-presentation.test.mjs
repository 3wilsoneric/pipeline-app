import assert from 'node:assert/strict';
import test from 'node:test';
import { clean, loadEntry } from './contact-import-fixtures.mjs';
const { scorecardTrend, scorecardBucketEvidence, scorecardAxisMaximum, scorecardValue } = loadEntry('lib/pipeline/assessor-scorecard-presentation.ts');
const event = (at, key = at) => ({ at, key });
const person = { id: 'a', evidence: { confirmed: [] }, usage: null };
const snapshot = { since: '2026-10-30T07:00:00Z', through: '2026-11-10T20:00:00Z', people: [person] };

test('Pacific weekly bins and drilldowns agree across DST and partial boundaries', () => {
  const events = [event('2026-11-02T07:59:59Z'), event('2026-11-02T08:00:00Z'), event('2026-11-09T07:59:59Z'), event('2026-11-09T08:00:00Z'), event(null), event('bad')];
  const result = scorecardTrend({ ...snapshot, people: [{ ...person, evidence: { confirmed: events } }] });
  assert.equal(result.unit, 'Week');
  assert.deepEqual(clean(result.buckets.map(b => [b.start, b.counts.a, b.partial])), [['2026-10-26',1,true],['2026-11-02',2,false],['2026-11-09',1,true]]);
  assert.equal(result.undated, 2);
  for (const bucket of result.buckets) assert.equal(scorecardBucketEvidence(events, bucket).length, bucket.counts.a);
  assert.equal(result.buckets.reduce((n,b) => n+b.counts.a,0) + result.undated, events.length);
});

test('zero weeks remain visible, longer ranges aggregate without dropping confirmations', () => {
  for (const [through,unit] of [['2027-02-01T20:00:00Z','Month'],['2028-02-01T20:00:00Z','Quarter'],['2031-02-01T20:00:00Z','Year']]) {
    const data = { ...snapshot, through, people: [{ ...person, evidence: { confirmed: [event('2026-10-31T20:00:00Z'),event(through)] } }] };
    const result = scorecardTrend(data);
    assert.equal(result.unit,unit);
    assert.ok(result.buckets.length <= 12);
    assert.equal(result.buckets.reduce((n,b) => n+b.counts.a,0),2);
    assert.ok(result.buckets.some(b => b.counts.a===0));
  }
});

test('scales include all observations and preserve unknown usage versus a measured zero', () => {
  assert.equal(scorecardValue(person,'interactions'),null);
  assert.equal(scorecardValue({ ...person, usage: { interactions: 0, activeMinutes: 0 } },'interactions'),0);
  for (const values of [[],[0],[1],[7,16],[0,119],[1646]]) {
    const axis = scorecardAxisMaximum(values);
    assert.ok(axis >= Math.max(0,...values));
    assert.ok(Number.isInteger(axis / 2));
  }
});
