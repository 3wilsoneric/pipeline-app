import assert from 'node:assert/strict';
import test from 'node:test';
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
  let revision=8, deleted=false, crossCase=false, changeDuringRead=false;
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
      listAssessments:async options=>{calls.push(['listAssessments',options]);return {assessments:[assessment],total:21,revision:4,next_cursor:'assessment-next'};},
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
  return {source,calls,workflow,assessment,setRevision:value=>{revision=value;},remove:()=>{deleted=true;},cross:()=>{crossCase=true;},race:()=>{changeDuringRead=true;}};
}

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
  assert.deepEqual(clean((await read('workspace')).data),f.workflow);
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
