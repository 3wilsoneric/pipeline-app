// Synthetic-only bounded replica target. Never points at production data.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { resolve } from 'node:path';

const database = new URL(process.env.PIPELINE_TEST_DATABASE_URL ?? '');
if (database.hostname !== '127.0.0.1' || !/^\/pipeline_capacity_[a-z0-9_]+$/.test(database.pathname)) throw Error('Dedicated loopback capacity database required');
const durableUpload = process.env.PIPELINE_CAPACITY_DURABLE_UPLOAD === 'true';
if (durableUpload && process.env.AZURE_STORAGE_ACCOUNT !== 'pipelinerehearsal0919') throw Error('Only the disposable rehearsal Blob account is allowed');
const replicas = Number(process.env.PIPELINE_CAPACITY_REPLICAS ?? 2);
if (![2, 3].includes(replicas)) throw Error('Only the two- or three-replica rehearsal is supported');
const ports = Array.from({ length: replicas }, (_, index) => 4178 + index);
const root = resolve('.data/capacity-20260919');
mkdirSync(root, { recursive: true });
const env = {
  ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED: 'false',
  NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED: 'true',
  PIPELINE_AUTH_MODE: 'headers', PIPELINE_TRUSTED_GATEWAY: 'true',
  PIPELINE_OPERATIONAL_E2E: 'true', PIPELINE_DATABASE_MODE: 'postgres',
  PIPELINE_DATABASE_URL: database.href, PIPELINE_DATABASE_SSL_MODE: 'disable',
  PIPELINE_DATABASE_POOL_MAX: '10', PIPELINE_REFERRAL_STORE_MODE: 'postgres',
  PIPELINE_ASSESSMENT_STORE_MODE: 'postgres', PIPELINE_RESIDENT_LINK_STORE_MODE: 'postgres',
  PIPELINE_ALLOWED_EMAILS: Array.from({ length: 100 }, (_, i) => `capacity-${i}@pipeline.local`).join(','),
  PIPELINE_ALLOWED_MUTATION_ORIGINS: [4177, ...ports].map(port => `http://127.0.0.1:${port}`).join(','),
  PIPELINE_CANONICAL_ORIGIN: 'http://127.0.0.1:4177',
  PIPELINE_ENTRA_SESSION_SECRET: 'synthetic-capacity-only-never-deploy-20260919',
  PIPELINE_EXTRACTION_BACKEND: durableUpload ? 'manual' : 'mock', PIPELINE_ALLOW_PRODUCTION_MOCK_EXTRACTION: durableUpload ? 'false' : 'true',
  PIPELINE_CLINICAL_DATA_MODE: 'disconnected', PIPELINE_CLINICAL_DATA_REQUIRED: 'false',
  PIPELINE_CLIENT_HISTORY_MODE: 'disconnected',
  PIPELINE_GRAPH_TENANT_ID: '', PIPELINE_GRAPH_CLIENT_ID: '', PIPELINE_GRAPH_CLIENT_SECRET: '',
  PIPELINE_MEET_CLIENT_SENDER: '', PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS: '',
  AZURE_STORAGE_ACCOUNT: durableUpload ? 'pipelinerehearsal0919' : 'pipelinesynthetic',
  AZURE_STORAGE_CONTAINER_RAW: 'raw',
  PIPELINE_LOCAL_DOCUMENT_ROOT: `${root}/documents`,
  PIPELINE_DESKTOP_STATE_ENABLED: 'true', PIPELINE_ENABLE_SYNTHETIC_PROFILES: 'true',
  PIPELINE_WORKER_SHARED_SECRET: 'synthetic-capacity-worker',
};
const children = ports.map(port => spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  env: { ...env, PORT: String(port) }, stdio: ['ignore', openSync(`${root}/app-${port}.log`, 'a', 0o600), openSync(`${root}/app-${port}.error.log`, 'a', 0o600)],
}));
let requestCount = 0;
let stopping = false;
const server = http.createServer((request, response) => {
  const port = ports[requestCount++ % ports.length];
  const upstream = http.request({ hostname: '127.0.0.1', port, path: request.url, method: request.method, headers: { ...request.headers, host: '127.0.0.1:4177' } }, result => {
    response.writeHead(result.statusCode ?? 502, { ...result.headers, 'x-capacity-backend': String(port) });
    result.pipe(response);
  });
  upstream.setTimeout(30_000, () => upstream.destroy());
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
  request.on('aborted', () => upstream.destroy());
  request.pipe(upstream);
});
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  server.close();
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 3000).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
for (const child of children) child.once('exit', () => { if (!stopping) stop(1); });
for (const port of ports) {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/api/health/live`)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) { stop(1); throw Error('Capacity instance did not start'); }
}
server.listen(4177, '127.0.0.1', () => console.log(JSON.stringify({ ready: true, synthetic_only: true, app_processes: ports.length, port: 4177 })));
