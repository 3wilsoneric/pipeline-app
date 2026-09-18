import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { loadTypeScriptModule } from './ts-module-loader.mjs';
const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

test('only reviewed suggestions populate intake; typed values remain protected', () => {
  const { populateFormFromExtraction } = loadTypeScriptModule(root, 'lib/pipeline/referral-canvas-extraction.ts');
  const form = { dob: { value: '', label: 'DOB' } };
  const field = { field_key: 'referral.date_of_birth', proposed_value: '1980-01-02', confidence: .99, review_status: 'pending' };
  assert.equal(populateFormFromExtraction(form, [field], 'fixture.pdf'), form);
  assert.equal(populateFormFromExtraction(form, [{ ...field, review_status: 'accepted' }], 'fixture.pdf').dob.value, '1980-01-02');
  const typed = { dob: { value: '1979-03-04', label: 'DOB' } };
  assert.equal(populateFormFromExtraction(typed, [{ ...field, review_status: 'accepted' }], 'fixture.pdf'), typed);
  assert.equal(populateFormFromExtraction(form, [{ ...field, review_status: 'accepted' }], 'fixture.pdf', new Set(['dob'])), form);
});

test('PostgreSQL callback preserves reviewed values and provenance; dispatch excludes legacy/attachment jobs', async () => {
  const dir = mkdtempSync('/tmp/pipeline-beta-pg-');
  const data = join(dir, 'data'); const socket = join(dir, 'socket'); mkdirSync(socket);
  const binary = name => join(process.env.PIPELINE_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@16/bin', name);
  let sql; let started = false;
  try {
    execFileSync(binary('initdb'), ['-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8'], { stdio: 'pipe' });
    const port = await new Promise(resolvePort => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolvePort(port)); }); });
    execFileSync(binary('pg_ctl'), ['-D', data, '-l', join(dir, 'pg.log'), '-w', 'start', '-o', `-p ${port} -h 127.0.0.1 -k ${socket} -F`], { stdio: 'pipe' }); started = true;
    sql = postgres({ host:'127.0.0.1', port, database:'postgres', username:process.env.USER, ssl:false, max:1, prepare:false, onnotice:()=>{} });
    for (const file of readdirSync(join(root, 'database/migrations')).filter(f => f.endsWith('.sql')).sort()) await sql.unsafe(readFileSync(join(root, 'database/migrations', file), 'utf8'));
    const [person] = await sql`insert into pipeline.people(display_name) values ('Synthetic Beta Test') returning person_id`;
    await sql`insert into pipeline.referrals(referral_id,person_id,stage,community,owner_id,owner_name,data,created_by,created_by_name,updated_by,updated_by_name) values (1,${person.person_id},'New','San Pablo','test','Test','{}','test','Test','test','Test')`;
    const [packet] = await sql`insert into pipeline.packet_uploads(referral_id,source_type,submitting_facility,status,uploaded_by,processing_intent) values (1,'manual','Synthetic','extracting','test','extract_referral') returning packet_id`;
    const [attachment] = await sql`insert into pipeline.packet_uploads(referral_id,source_type,submitting_facility,status,uploaded_by,processing_intent) values (1,'manual','Synthetic','received','test','preview_only') returning packet_id`;
    const docs = [];
    for (let i=0;i<3;i++) {
      const [doc] = await sql`insert into pipeline.documents(referral_id,category,file_name,content_type,byte_size,sha256,blob_container,blob_key,processing_status,uploaded_by) values (1,'referral_packet','synthetic.pdf','application/pdf',100,${String(i+1).repeat(64)},'raw',${`${packet.packet_id}/original/${i}.pdf`},'uploaded','test') returning document_id`;
      docs.push(doc.document_id);
    }
    await sql`insert into pipeline.packet_upload_files(packet_id,file_id,document_id,expected_byte_size,expected_sha256,blob_path,reservation_expires_at,uploaded_at) values (${packet.packet_id},'fixture',${docs[0]},100,${'1'.repeat(64)},'fixture',now()+interval '1 hour',now())`;
    const globals = {
      __pipelineSql:sql,
      process:{...process,env:{...process.env,PIPELINE_DATABASE_MODE:'postgres',PIPELINE_DATABASE_URL:'disposable-test-only',AZURE_STORAGE_ACCOUNT:'fixture',DATABRICKS_HOST:'https://fixture.azuredatabricks.net',DATABRICKS_JOB_ID:'1',DATABRICKS_AUTH_MODE:'oauth_m2m',DATABRICKS_CLIENT_ID:'test',DATABRICKS_CLIENT_SECRET:'test'}},
      require(spec) {
        if (spec==='@azure/identity') return { DefaultAzureCredential:class {} };
        if (spec==='@azure/storage-blob') return { BlobServiceClient:class { getContainerClient(){return {getBlobClient:()=>({getProperties:async()=>({contentLength:100,contentType:'application/pdf'})})};} } };
        return require(spec);
      },
      fetch:async url => new Response(JSON.stringify(String(url).includes('/oidc/') ? {access_token:'test',expires_in:3600} : {run_id:123}), {status:200}),
      setTimeout,clearTimeout,
    };
    const worker = loadTypeScriptModule(root, 'lib/extraction/processing-worker.ts', globals);
    for (const [i,status] of ['confirmed','edited','rejected','pending'].entries()) {
      const [field] = await sql`insert into pipeline.referral_fields(referral_id,field_key,proposed_value,final_value,confidence,review_status,source_document_id,source_page,reviewer_id) values (1,${`fixture.value${i}`},'"original"','"human"',.8,${status},${docs[0]},2,'reviewer') returning referral_field_id`;
      await sql`insert into pipeline.extraction_candidates(referral_field_id,source,candidate_value,confidence,source_page) values (${field.referral_field_id},'document_intelligence','"original"',.8,2)`;
    }
    const token=randomUUID();
    const [job] = await sql`insert into pipeline.extraction_jobs(document_id,packet_id,job_type,status,attempt_count,attempt_token) values (${docs[0]},${packet.packet_id},'referral_packet','running',1,${token}) returning extraction_job_id`;
    const fields=Array.from({length:5},(_,i)=>({field_key:`fixture.value${i}`,proposed_value:'new',confidence:.99,source_page:1,candidates:[{source:'document_intelligence',value:'new',confidence:.99,source_page:1}]}));
    await worker.reportExtractionJob({extraction_job_id:job.extraction_job_id,attempt_count:1,attempt_token:token,status:'succeeded',malware_scan_status:'clean',verified_sha256:'1'.repeat(64),fields});
    const rows=await sql`select field_key,proposed_value,final_value,review_status,source_page,version,reviewer_id from pipeline.referral_fields order by field_key`;
    for (const row of rows.slice(0,3)) { assert.equal(row.proposed_value,'original'); assert.equal(row.final_value,'human'); assert.equal(row.source_page,2); assert.equal(row.version,1); assert.equal(row.reviewer_id,'reviewer'); }
    for (const row of rows.slice(3)) { assert.equal(row.proposed_value,'new'); assert.equal(row.source_page,1); }
    const candidates=await sql`select f.field_key,c.candidate_value,c.source_page from pipeline.extraction_candidates c join pipeline.referral_fields f using(referral_field_id) order by f.field_key`;
    assert.deepEqual(candidates.map(c=>c.candidate_value),['original','original','original','new','new']);
    for (const [i,packetId] of [null,attachment.packet_id,packet.packet_id].entries()) await sql`insert into pipeline.extraction_jobs(document_id,packet_id,job_type,status) values (${docs[i]},${packetId},'document_preview','queued')`;
    const dispatched=await worker.dispatchExtractionJobs();
    assert.equal(dispatched.dispatched,1);
    const pending=await sql`select packet_id,status from pipeline.extraction_jobs where job_type='document_preview'`;
    assert.equal(pending.filter(j=>j.status==='queued').length,2);
    assert.equal(pending.find(j=>j.packet_id===packet.packet_id).status,'running');
  } finally {
    if(sql)await sql.end({timeout:5});
    if(started)execFileSync(binary('pg_ctl'),['-D',data,'-w','stop','-m','fast'],{stdio:'pipe'});
    rmSync(dir,{recursive:true,force:true});
  }
});
