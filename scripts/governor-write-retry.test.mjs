import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEntry } from './contact-import-fixtures.mjs';

function fixture(replies) {
  const requests = [], delays = [];
  const client = loadEntry('lib/auth/authenticated-fetch.ts', {
    '@/lib/auth/entra-client': { pipelineAuthRequired: false },
    '@/lib/auth/browser-session': { pipelinePageHeaders: () => ({}), acceptWorkshopResetResponse() {} },
    '@/lib/auth/post-login-path': {}, '@/lib/pipeline/base-path': { toPipelinePath: x => x },
  }, {
    DOMException,
    window: { setTimeout: (callback, ms) => { if (ms < 5000) { delays.push(ms); queueMicrotask(callback); } return 1; }, clearTimeout() {} },
    fetch: async (_url, init) => { requests.push(init); const reply = replies[Math.min(requests.length - 1, replies.length - 1)]; if (reply instanceof Error) throw reply; return reply(); },
  });
  return { client, requests, delays };
}
const busy = () => Response.json({ error: 'busy' }, { status: 429, headers: { 'Retry-After': '1', 'X-Pipeline-Capacity-Class': 'mutation' } });
const body = JSON.stringify({ client_mutation_id: 'synthetic-stable-id', patch: { phone: '555-0000' } });

test('only a known pre-handler rejection gets a bounded identical write retry', async () => {
  const f = fixture([busy, () => Response.json({ saved: true })]);
  assert.equal((await f.client.fetchPipelineJson('/api/referrals/1', { method: 'PATCH', body })).saved, true);
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every(r => r.body === body));
  assert.ok(f.delays[0] >= 1000 && f.delays[0] < 1250);
  const exhausted = fixture([busy]);
  await assert.rejects(exhausted.client.fetchPipelineJson('/api/referrals/1', { method: 'PATCH', body }), e => e.status === 429);
  assert.equal(exhausted.requests.length, 3);
});

test('ambiguous writes, ordinary throttles, invalid bodies and conflicts never auto-replay', async () => {
  for (const reply of [() => Response.json({}, { status: 503 }), () => Response.json({}, { status: 409 }), () => Response.json({}, { status: 429 }), new Error('lost reply')]) {
    const f = fixture([reply]);
    await assert.rejects(f.client.fetchPipelineJson('/api/referrals/1', { method: 'PATCH', body }));
    assert.equal(f.requests.length, 1);
  }
  const form = fixture([busy]);
  await assert.rejects(form.client.fetchPipelineJson('/api/referrals/1', { method: 'POST', body: new FormData() }));
  assert.equal(form.requests.length, 1);
});

test('cancelled work is not retried and ordinary GET retry remains bounded', async () => {
  const f = fixture([busy]);
  await assert.rejects(f.client.fetchPipelineJson('/api/referrals/1', { method: 'PATCH', body, signal: AbortSignal.abort() }), e => e.status === 499);
  assert.equal(f.requests.length, 0);
  const read = fixture([() => Response.json({}, { status: 503 }), () => Response.json({ ok: true })]);
  assert.equal((await read.client.fetchPipelineJson('/api/referrals/1')).ok, true);
  assert.equal(read.requests.length, 2);
});
