import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEntry, clean } from './contact-import-fixtures.mjs';

const tenant = '11111111-1111-1111-1111-111111111111', subject = '22222222-2222-2222-2222-222222222222';
const env = () => ({ PIPELINE_ALLY_SOURCE_SECRET:'source-only-fixture', PIPELINE_ALLY_SOURCE_TENANT_ID:tenant,
  PIPELINE_ALLY_SOURCE_SUBJECT_IDS:subject, PIPELINE_PLATFORM_SUMMARY_SECRET:'summary-only-fixture', PIPELINE_WORKER_SHARED_SECRET:'worker-only-fixture' });
const request = (input = {}, headers = {}) => new Request(`https://pipeline.example.test/api/integrations/platform/ally?${new URLSearchParams({input:JSON.stringify(input)})}`, {
  headers:{authorization:'Bearer source-only-fixture','x-ally-tenant':tenant,'x-ally-subject':subject,...headers},
});
const auth = values => loadEntry('lib/auth/internal-worker-auth.ts', {}, {process:{env:values}});

test('source reads require the separate credential, exact tenant and approved represented person', () => {
  const values=env(), {requireAllySource}=auth(values);
  assert.equal(requireAllySource(request()),null);
  for(const credential of ['','summary-only-fixture','worker-only-fixture']) assert.equal(requireAllySource(request({}, {authorization:`Bearer ${credential}`})).status,401);
  for(const headers of [{'x-ally-subject':''},{'x-ally-subject':tenant},{'x-ally-tenant':subject}]) assert.equal(requireAllySource(request({},headers)).status,403);
  values.PIPELINE_ALLY_SOURCE_SUBJECT_IDS='invalid'; assert.equal(requireAllySource(request()).status,503);
  delete values.PIPELINE_ALLY_SOURCE_SECRET; assert.equal(requireAllySource(request()).status,503);
});

function fixture() {
  let revision=8, assessmentRevision=4, deleted=false, crossCase=false, changeDuringRead=false, assessmentRace=false;
  const calls=[];
  const referral={id:42,version:5,name:'Fictional Client',workspaceOrigin:'allo',workspaceStatus:'historical',packetId:'packet-fixture',stage:'Declined',county:'Fictional county'};
  const {createEmptyAssessmentToolData}=loadEntry('lib/assessment/assessment-tool-schema.ts');
  const assessment={...createEmptyAssessmentToolData(),assessment_id:'assessment-fixture',referral_id:42,version:7,
    status:'draft',field_provenance:{},audit_events:[],assessment_notes:'Fictional retained answer',language_barrier:'unknown'};
  const workflow={referral,work_items:[{status:'requested'}],decision:{outcome:'declined'},reviews:[{status:'changes_requested'}],context:{assessmentId:assessment.assessment_id}};
  const owners={
    './referral-store':{
      getReferral:async id=>{calls.push(['getReferral',id]);return id===42&&!deleted?referral:null;},
      getReferralStoreRevision:async()=>revision,
      listReferrals:async options=>{calls.push(['listReferrals',options]);const current=revision;if(changeDuringRead)revision++;return {referrals:[referral],total:23,revision:current,next_cursor:options.cursor?null:'next-native-cursor'};},
      listReferralFiles:async options=>{calls.push(['listReferralFiles',options]);return {files:[{id:'file',name:'meds.pdf',category:'Medication list',previewUrl:'private-url',downloadUrl:'private-url',thumbnailUrl:'private-url'}],total:21,revision:8,next_cursor:'file-next'};},
    },
    '@/lib/assessment/assessment-store':{
      getAssessment:async()=>({...assessment,referral_id:crossCase?99:42}),
      getAssessmentStoreRevision:async()=>assessmentRevision,
      listAssessments:async options=>{calls.push(['listAssessments',options]);const current=assessmentRevision;if(assessmentRace)assessmentRevision++;return {assessments:[assessment],total:21,revision:current,next_cursor:options.cursor?null:'assessment-next'};},
    },
    '@/lib/extraction/document-text':{readReferralDocumentPage:async()=>({documentId:'file',pageNumber:1,pageCount:2,text:'Actual fictional page',nextPage:2})},
    '@/lib/notifications/admission-packet-store':{listCommunicationPackets:async()=>({items:[{id:'message',createdAt:'2026-11-24',message:{subject:'Meet the Client',body:'Fictional message'},communication:{status:'submitted',audit:{},to:[],cc:[]},files:[{id:'file',name:'meds.pdf',source:{key:'private-key'}}],recipients:[{sessions:[{hash:'private-session'}]}]}],nextCursor:'next'})},
    './workflow-store':{getReferralWorkflowSnapshot:async()=>workflow},
    './client-notes-store':{listClientNotes:async()=>[{block_key:'unified',body:'Full fictional note',version:3}]},
    './contact-store':{listReferralContacts:async()=>[{relationship:'referrer',name:'Fictional referrer'}]},
    './historical-profile-store':{getHistoricalProfile:async()=>({capturedSources:[{text:'Retained ALLO text'}]})},
    './referral-activity':{getReferralActivitySnapshot:async()=>({events:[{event_id:'event',undo:{deletion_id:'must-not-expose'}}]})},
    '@/lib/extraction/extraction-service':{readPacketFields:async()=>({fields:[{field_key:'dob',proposed_value:'1980-01-01',final_value:null,review_status:'pending'}]})},
  };
  const source=loadEntry('lib/pipeline/ally-source.ts',owners);
  return {source,calls,workflow,assessment,setRevision:value=>{revision=value;},setAssessmentRevision:value=>{assessmentRevision=value;},assessmentRace:()=>{assessmentRace=true;},remove:()=>{deleted=true;},cross:()=>{crossCase=true;},race:()=>{changeDuringRead=true;}};
}

test('assessment continuation accepts the collector revision and rejects an unbound or changed page',async()=>{
  const f=fixture(),input={view:'assessments',referralId:42};
  const first=await f.source.readAllyPipelineSource(input);
  const continuation={...input,cursor:first.data.next_cursor,sourceRevision:first.data.sourceRevision};
  const last=await f.source.readAllyPipelineSource(continuation);
  assert.equal(last.complete,true);assert.equal(last.data.sourceRevision,4);
  await assert.rejects(()=>f.source.readAllyPipelineSource({...input,cursor:first.data.next_cursor}),/sourceRevision/);
  f.setAssessmentRevision(5);await assert.rejects(()=>f.source.readAllyPipelineSource(continuation),error=>error.status===409);
  for(const view of ['assessments','assessment-review']){
    const race=fixture();race.assessmentRace();
    await assert.rejects(()=>race.source.readAllyPipelineSource({view,...(view==='assessments'?{referralId:42}:{})}),error=>error.status===409);
  }
});

test('assessment revision reads the configured local or PostgreSQL owner without writing',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ally-assessment-revision-'));
  try{
    const file=join(directory,'assessments.json');
    await writeFile(file,JSON.stringify({version:1,revision:19,assessments:[]}));
    const environment=mode=>({process:{...process,env:{NODE_ENV:'test',PIPELINE_DATABASE_MODE:mode==='postgres'?mode:'disconnected',
      PIPELINE_DATABASE_URL:mode==='postgres'?'postgres://unused.invalid/fixture':'',PIPELINE_ASSESSMENT_STORE_MODE:mode,PIPELINE_ASSESSMENT_STORE_PATH:file}},globalThis:{}});
    const local=loadEntry('lib/assessment/assessment-store.ts',{},environment('local_file'));
    assert.equal(await local.getAssessmentStoreRevision(),19);
    let reads=0;
    const sql=async strings=>{reads++;assert.match(strings.join(''),/^\s*select revision from pipeline\.store_revisions/);return[{revision:'27'}];};
    const databaseOwner=loadEntry('lib/database/pipeline-database.ts',{},environment('postgres'));
    const database=loadEntry('lib/assessment/assessment-store.ts',{'@/lib/database/pipeline-database':{...databaseOwner,getPipelineSql:()=>sql}},environment('postgres'));
    assert.equal(await database.getAssessmentStoreRevision(),27);assert.equal(reads,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('directory preserves all workspace states, native filters, pagination and separate referral episodes',async()=>{
  const f=fixture();
  const page=await f.source.readAllyPipelineSource({view:'directory',query:'Fictional',community:'San Pablo'});
  assert.equal(page.data.total,23);assert.equal(page.complete,false);assert.equal(page.data.records[0].referralId,42);
  const options=f.calls.find(([name])=>name==='listReferrals')[1];
  assert.equal(options.scope,'team');assert.equal(options.workspaceStatus,'all');assert.equal(options.limit,20);
  assert.equal(options.query,'Fictional');assert.equal(options.community,'San Pablo');assert.equal(options.assignedOwnerId,undefined);
  await assert.rejects(()=>f.source.readAllyPipelineSource({view:'directory',cursor:'next-native-cursor'}),/sourceRevision/);
  await f.source.readAllyPipelineSource({view:'directory',cursor:'next-native-cursor',sourceRevision:8});
  f.setRevision(9);await assert.rejects(()=>f.source.readAllyPipelineSource({view:'directory',cursor:'next-native-cursor',sourceRevision:8}),error=>error.status===409);
  f.race();await assert.rejects(()=>f.source.readAllyPipelineSource({view:'directory'}),error=>error.status===409);
});

test('canonical assessments keep unanswered values and provenance; history and files never imply complete content',async()=>{
  const f=fixture(), read=view=>f.source.readAllyPipelineSource({view,referralId:42});
  const workspace=clean((await read('workspace')).data),{admission,...original}=workspace;
  assert.deepEqual(original,f.workflow);assert.equal(admission.placementCancelled,false);
  const assessment=await f.source.readAllyPipelineSource({view:'assessment',referralId:42,assessmentId:'assessment-fixture'});
  assert.deepEqual(clean(assessment.data.record),clean(f.assessment));
  assert.equal(assessment.data.fields.find(field=>field.definition.key==='language_barrier').answer.value,'unknown');
  assert.equal((await read('notes')).data.blocks[0].body,'Full fictional note');
  assert.equal((await read('imported')).data.capturedSources[0].text,'Retained ALLO text');
  assert.equal((await read('contacts')).data.contacts[0].relationship,'referrer');
  const files=await read('files');assert.equal(files.complete,false);assert.equal(files.data.next_cursor,'file-next');assert(!JSON.stringify(files).includes('private-url'));
  const assessments=await read('assessments');assert.equal(assessments.complete,false);assert.equal(assessments.data.records[0].status,'draft');
  const page=await f.source.readAllyPipelineSource({view:'document',referralId:42,documentId:'file'});assert.equal(page.data.text,'Actual fictional page');assert.equal(page.complete,false);
  const comm=await read('communications');assert.equal(comm.data.records[0].status,'submitted');assert.equal(comm.complete,false);assert(!JSON.stringify(comm).includes('private-'));
  const activity=await read('activity');assert.equal(activity.complete,false);assert.equal(activity.data.events[0].undo,undefined);
  const extracted=await read('extraction');assert.equal(extracted.complete,false);assert.equal(extracted.data.fields.fields[0].review_status,'pending');
  f.cross();await assert.rejects(()=>f.source.readAllyPipelineSource({view:'assessment',referralId:42,assessmentId:'assessment-fixture'}),error=>error.status===404);
  f.remove();await assert.rejects(()=>read('notes'),error=>error.status===404);
});

test('unknown operations, native writes, malformed IDs and undeclared parameters fail before reading',async()=>{
  const f=fixture();
  for(const input of [null,[],{view:'delete'},{view:'document',referralId:42,documentId:'../secret'},{view:'document',referralId:42,documentId:'file',page:2},{view:'document',referralId:42,documentId:'file',page:0},{view:'notes',referralId:'42'},{view:'notes',referralId:0},{view:'directory',assignedOwnerId:subject},{view:'directory',scope:'mine'},{view:'directory',month:'2026-14'},{view:'directory',workspaceStatus:'trash'},{view:'notes',referralId:42,body:'write'},{view:'assessment',referralId:42,assessmentId:'../../private'}]) await assert.rejects(()=>f.source.readAllyPipelineSource(input));
  assert.equal(f.calls.length,0);
});

test('real route authenticates before data access, rechecks revocation, disables caching and rejects oversize output',async()=>{
  const values=env(), source=fixture().source;let reads=0, revoke=false,oversize=false;
  const route=loadEntry('app/api/integrations/platform/ally/route.ts',{
    '@/lib/auth/internal-worker-auth':auth(values),
    '@/lib/observability/api-logging':{withApiLogging:(_request,_path,run)=>run()},
    '@/lib/pipeline/referral-store':{requireReferralStore:()=>({ok:true})},
    '@/lib/pipeline/ally-source':{...source,readAllyPipelineSource:async input=>{reads++;if(revoke)values.PIPELINE_ALLY_SOURCE_SUBJECT_IDS=tenant;return oversize?{text:'x'.repeat(4*1024*1024)}:source.readAllyPipelineSource(input);}},
  });
  assert.equal(route.POST,undefined);assert.equal(route.PATCH,undefined);assert.equal(route.DELETE,undefined);
  assert.equal((await route.GET(request({}, {authorization:'Bearer summary-only-fixture'}))).status,401);assert.equal(reads,0);
  const result=await route.GET(request());assert.equal(result.status,200);assert.match(result.headers.get('cache-control'),/no-store/);
  const bad=new Request('https://pipeline.example.test/api/integrations/platform/ally?input=%7B',request());assert.equal((await route.GET(bad)).status,400);
  oversize=true;assert.equal((await route.GET(request())).status,413);oversize=false;
  revoke=true;assert.equal((await route.GET(request())).status,403);
});


test('cohort assessment reads preserve question values, provenance, filtering, trash exclusion and revision-bound continuation', async()=>{
  const f=fixture();f.assessment.created_at='2026-11-20T12:00:00Z';
  f.assessment.field_provenance.language_barrier=[{source:'interview',value:'unknown'}];
  const input={view:'assessment-review',fields:['language_barrier','assessment_notes'],dateField:'created_at',from:'2026-11-01T00:00:00Z',through:'2026-11-30T23:59:59Z'};
  const result=await f.source.readAllyPipelineSource(input);
  assert.deepEqual(clean(f.calls.find(([name])=>name==='listAssessments')[1]),{limit:20,dateField:input.dateField,from:input.from,through:input.through});
  assert.equal(result.data.records.length,1);assert.equal(result.complete,false);
  assert.equal(result.data.records[0].assessmentType,'Pipeline intake assessment');
  assert.equal(result.data.records[0].plannedInterviewMethod,null);
  assert.match(result.data.assessmentDefinition.scoring,/no standardized clinical total score/);
  const single=await f.source.readAllyPipelineSource({view:'assessment',referralId:42,assessmentId:f.assessment.assessment_id});
  assert.deepEqual(clean(single.data.assessmentDefinition),clean(result.data.assessmentDefinition));
  const answers=result.data.records[0].answers;
  assert.equal(answers.find(a=>a.key==='language_barrier').value,'unknown');
  assert.equal(answers.find(a=>a.key==='language_barrier').provenance.length,1);
  assert.equal(answers.find(a=>a.key==='assessment_notes').value,'Fictional retained answer');
  assert.equal(result.data.scanned,1);assert.equal(result.data.total,undefined,'Never call a page count a cohort total');
  assert.equal((await f.source.readAllyPipelineSource({...input,from:'2026-11-21T00:00:00Z'})).data.records.length,0);
  assert.equal((await f.source.readAllyPipelineSource({...input,community:'Other'})).data.records.length,0);
  await assert.rejects(()=>f.source.readAllyPipelineSource({...input,cursor:'assessment-next'}),/both sourceRevision/);
  await assert.rejects(()=>f.source.readAllyPipelineSource({...input,cursor:'assessment-next',sourceRevision:3,referralRevision:8}),error=>error.status===409);
  const next=await f.source.readAllyPipelineSource({...input,cursor:'assessment-next',sourceRevision:4,referralRevision:8});assert.equal(next.data.records.length,1);
  f.setRevision(9);await assert.rejects(()=>f.source.readAllyPipelineSource({...input,cursor:'assessment-next',sourceRevision:4,referralRevision:8}),error=>error.status===409);
  f.remove();assert.equal((await f.source.readAllyPipelineSource(input)).data.records.length,0);
  for(const patch of [{fields:['private_field']},{fields:[]},{dateField:'sent_at'},{from:'November'},{dateField:undefined},{fields:['language_barrier','language_barrier']}]) await assert.rejects(()=>f.source.readAllyPipelineSource({...input,...patch}));
});

test('workspace review returns the requested records with original notes and no duplicate checklist or clinical claims',async()=>{
  const f=fixture();
  f.workflow.context.assessmentData={assessment_notes:'Recorded explanation, unchanged',peer_interaction_notes:'A source observation',language_barrier:'unknown'};
  f.workflow.referral.note='Original referral message';
  const result=await f.source.readAllyPipelineSource({view:'workspace-review',referralIds:[42]});
  assert.equal(result.complete,true);assert.deepEqual(clean(result.data.requestedReferralIds),[42]);
  const record=result.data.records[0];assert.equal(record.referralId,42);assert.deepEqual(clean(record.requirements),f.workflow.work_items);
  assert.equal(record.referral.requirements,undefined);assert.equal(record.assessment.assessmentData,undefined);
  assert.equal(record.notes.referral,'Original referral message');assert.equal(record.notes.assessment.assessment_notes,'Recorded explanation, unchanged');
  assert.equal(record.notes.assessment.language_barrier,undefined);assert.equal(record.notes.blocks[0].version,3);assert.equal(record.notes.blocks[0].body,'Full fictional note');
  assert.match(result.data.coverage,/not documented causes/);assert.match(result.data.coverage,/not an atomic/);
  for(const referralIds of [[],[42,42],[0],['42'],[1,2,3,4,5,6,7]])await assert.rejects(()=>f.source.readAllyPipelineSource({view:'workspace-review',referralIds}),/distinct/);
  await assert.rejects(()=>f.source.readAllyPipelineSource({view:'workspace-review',referralIds:[42,999]}),error=>error.status===404);
  f.remove();await assert.rejects(()=>f.source.readAllyPipelineSource({view:'workspace-review',referralIds:[42]}),error=>error.status===404);
});

test('all record readers expose due-plan assumptions and cancellation without changing confirmed arrival or source records',async()=>{
  const f=fixture(),referral=f.workflow.referral;
  Object.assign(referral,{workspaceOrigin:'pipeline',workspaceStatus:'active',stage:'Community Review',
    admissionDecision:{outcome:'accepted'},plannedAdmissionDate:'2020-01-02'});
  for(const mode of ['due','future','cancelled','confirmed']){
    referral.plannedAdmissionDate=mode==='future'?'2099-01-02':'2020-01-02';
    referral.placementCancellation=mode==='cancelled'?{cancelledAt:'2020-01-03T12:00:00Z'}:undefined;
    referral.actualAdmissionDate=mode==='confirmed'?'2020-01-03':undefined;
    const before=clean(referral),directory=(await f.source.readAllyPipelineSource({view:'directory'})).data.records[0];
    const review=(await f.source.readAllyPipelineSource({view:'workspace-review',referralIds:[42]})).data.records[0].referral;
    const workspace=(await f.source.readAllyPipelineSource({view:'workspace',referralId:42})).data.admission;
    for(const value of [directory,review,workspace]){
      assert.equal(value.assumedAdmissionDate,mode==='due'?'2020-01-02':null);
      assert.equal(value.actualAdmissionDate,mode==='confirmed'?'2020-01-03':null);
      assert.equal(value.placementCancelled,mode==='cancelled');assert.equal(value.decisionOutcome,'accepted');
      assert.equal(value.placementCancelledAt,mode==='cancelled'?'2020-01-03T12:00:00Z':null);
    }
    assert.deepEqual(clean(referral),before,'Reading cannot confirm or alter an arrival');
  }
});
