import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { access } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Exercise the real production Proxy and route, not just route-module fixtures.
// This local check reads catalog metadata only and cannot reach a live store.
await access('.next/standalone/server.js');
const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const tenant='11111111-1111-1111-1111-111111111111',subject='22222222-2222-2222-2222-222222222222';
const child=spawn(process.execPath,['.next/standalone/server.js'],{
  env:{...process.env,PORT:String(port),HOSTNAME:'127.0.0.1',PIPELINE_REFERRAL_STORE_MODE:'local_file',PIPELINE_DATABASE_MODE:'local_file',
    PIPELINE_ALLOW_LOCAL_REFERRAL_STORE:'true',PIPELINE_ALLY_SOURCE_SECRET:'packaged-source-fixture',
    PIPELINE_ALLY_SOURCE_TENANT_ID:tenant,PIPELINE_ALLY_SOURCE_SUBJECT_IDS:subject,
    PIPELINE_PLATFORM_SUMMARY_SECRET:'packaged-summary-fixture',PIPELINE_PLATFORM_CLIENT_BRIEFING_SECRET:'packaged-briefing-fixture',
    PIPELINE_WORKER_SHARED_SECRET:'packaged-worker-fixture'},
  stdio:'ignore',
});
const exited=once(child,'exit');
const base=`http://127.0.0.1:${port}`,route=base+'/api/integrations/platform/ally?input=%7B%22view%22%3A%22catalog%22%7D';
try {
  let ready=false;
  for(let attempt=0;attempt<100;attempt++) {
    if(child.exitCode!==null)throw Error('Packaged server exited before readiness.');
    try{if((await fetch(base+'/api/health/live',{signal:AbortSignal.timeout(500)})).ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(ready,'Packaged server did not start.');
  const headers={authorization:'Bearer packaged-source-fixture','x-ally-tenant':tenant,'x-ally-subject':subject};
  assert.equal((await fetch(route)).status,401);
  for(const credential of ['packaged-summary-fixture','packaged-briefing-fixture','packaged-worker-fixture'])
    assert.equal((await fetch(route,{headers:{...headers,authorization:`Bearer ${credential}`}})).status,401);
  assert.equal((await fetch(route,{headers:{...headers,'x-ally-subject':tenant}})).status,403);
  const response=await fetch(route,{headers});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  const record=await response.json();assert.equal(record.owner,'pipeline');assert(record.data.views.some(view=>view.view==='assessment'));
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await fetch(route,{method,headers})).status,405);
  assert.equal((await fetch(base+'/api/integrations/platform/ally?input=%7B',{headers})).status,400);
  console.log('Packaged source: Proxy, route, catalog, separate credentials, tenant/subject boundary, no-store and read-only methods passed.');
} finally {
  child.kill('SIGTERM');
  const force=setTimeout(()=>child.kill('SIGKILL'),5000);force.unref();
  await exited;clearTimeout(force);
}
