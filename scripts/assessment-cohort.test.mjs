import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import net from 'node:net';
import postgres from 'postgres';
import {loadEntry,root} from './contact-import-fixtures.mjs';

// A disposable loopback database; never uses a configured application URL.
test('assessment date cohorts filter before pagination with local/PostgreSQL parity',async()=>{
  const dir=mkdtempSync('/tmp/pipeline-cohort-'),data=join(dir,'data'),socket=join(dir,'socket');
  const binary=name=>process.env.PIPELINE_HANDOFF_PG_BIN?join(process.env.PIPELINE_HANDOFF_PG_BIN,name):name;
  let sql,started=false;
  try {
    mkdirSync(socket);
    execFileSync(binary('initdb'),['-D',data,'-A','trust','--no-locale','-E','UTF8'],{stdio:'pipe'});
    const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
    const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
    execFileSync(binary('pg_ctl'),['-D',data,'-l',join(dir,'postgres.log'),'-w','start','-o',`-p ${port} -h 127.0.0.1 -k ${socket} -F`],{stdio:'pipe'});started=true;
    const url=`postgres://${encodeURIComponent(process.env.USER)}@127.0.0.1:${port}/postgres`;
    for(const file of readdirSync(join(root,'database/migrations')).filter(x=>/^\d+.*\.sql$/.test(x)).sort())
      execFileSync(binary('psql'),[url,'-v','ON_ERROR_STOP=1','-f',join(root,'database/migrations',file)],{stdio:'pipe'});
    sql=postgres(url,{ssl:false,max:4,prepare:false,onnotice:()=>{}});
    const [person]=await sql`insert into pipeline.people (display_name) values ('Synthetic cohort') returning person_id`;
    const [referral]=await sql`insert into pipeline.referrals (person_id,stage,community,created_by,created_by_name,updated_by,updated_by_name)
      values (${person.person_id},'Assessment','San Pablo','fixture','Fixture','fixture','Fixture') returning referral_id`;
    const rows=Array.from({length:35},(_,i)=>({assessment_id:`cohort-${String(i).padStart(2,'0')}`,referral_id:Number(referral.referral_id),
      created_at:'2026-09-01T00:00:00.000Z',updated_at:new Date(Date.UTC(2026,10,24,0,i)).toISOString(),
      completed_at:i<23?'2026-11-20T12:00:00.000Z':i<32?new Date(Date.UTC(2026,9,i-22)).toISOString():i===32?'2026-10-31T23:59:59.999Z':i===33?null:'2026-09-30T23:59:59.999Z',
      scheduled_start_at:i===34?'2026-10-01T00:00:00.000Z':null}));
    for(const row of rows) await sql`insert into pipeline.assessments (assessment_id,revision_root_id,referral_id,status,version,created_by,created_by_name,updated_by,updated_by_name,created_at,updated_at,completed_at,scheduled_start_at)
      values (${row.assessment_id},${row.assessment_id},${row.referral_id},'draft',1,'fixture','Fixture','fixture','Fixture',${row.created_at},${row.updated_at},${row.completed_at},${row.scheduled_start_at})`;
    const owner=mode=>loadEntry('lib/assessment/assessment-store.ts',{
      '@/lib/database/pipeline-database':{getPipelineDatabaseReadiness:()=>({mode:'postgres',ready:true}),getPipelineSql:()=>sql},
      '@/lib/persistence/local-mutation':{withLocalMutation:fn=>fn(),localStoreGeneration:()=>0},
    },{process:{...process,env:{PIPELINE_ASSESSMENT_STORE_MODE:mode}},
      __pipelineAssessmentStore:{initialized:true,loadedGeneration:0,revision:1,assessments:rows}});
    const local=owner('local_file'),pg=owner('postgres');
    const query={dateField:'completed_at',from:'2026-10-01T00:00:00.000Z',through:'2026-10-31T23:59:59.999Z',limit:3};
    const scan=async(store,options)=>{let cursor,ids=[],totals=[];do{const page=await store.listAssessments({...options,cursor});ids.push(...page.assessments.map(a=>a.assessment_id));totals.push(page.total);cursor=page.next_cursor;}while(cursor);return {ids,totals};};
    const expected=rows.filter(r=>Number(r.assessment_id.slice(-2))>=23&&Number(r.assessment_id.slice(-2))<=32).reverse().map(r=>r.assessment_id);
    assert.deepEqual((await scan(local,query)).ids,expected);
    assert.deepEqual(await scan(pg,query),await scan(local,query));
    assert((await scan(pg,query)).totals.every(n=>n===10));
    for(const patch of [{dateField:'created_at'},{dateField:'scheduled_start_at'},{from:'2026-09-30T17:00:00-07:00'},{}])
      assert.deepEqual(await scan(pg,{...query,...patch}),await scan(local,{...query,...patch}));
    assert.equal((await pg.listAssessments({limit:100})).total,35);
    assert.equal((await local.listAssessments({limit:100})).total,35);
    for(const store of [local,pg])for(const patch of [{dateField:'private_column'},{dateField:undefined},{from:'invalid'},{from:'2026-12-01T00:00:00Z'}])
      await assert.rejects(()=>store.listAssessments({...query,...patch}),/ordered ISO/);
    assert.equal(Number((await sql`select count(*) n from pipeline.assessments`)[0].n),35,'Reads preserve all records');
  } finally {
    if(sql)await sql.end({timeout:5});
    if(started)execFileSync(binary('pg_ctl'),['-D',data,'-w','stop','-m','fast'],{stdio:'pipe'});
    rmSync(dir,{recursive:true,force:true});
  }
});
