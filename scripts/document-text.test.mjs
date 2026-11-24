import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { loadEntry } from './contact-import-fixtures.mjs';

test('document reads bind the workspace, preserve malware refusal and verify every page against its bytes', async()=>{
  let owner=42, available=true, local=false, parsed=0, stored=0, converted=false;
  const bytes=new Uint8Array([1,2,3]), hash=createHash('sha256').update(bytes).digest('hex');
  const {DocumentProcessingError}=loadEntry('lib/extraction/document-processing-error.ts');
  const reader=loadEntry('lib/extraction/document-text.ts',{
    './document-processing':{DocumentProcessingError},
    './document-assets':{
      getDocumentReferralId:async()=>owner,
      getDocumentOriginalAsset:async()=>{if(!available)throw new DocumentProcessingError('malware_pending',409);return {contentType:converted?'application/msword':'application/pdf'};},
      getDocumentPreviewAsset:async()=>({contentType:'application/pdf'}),
      proxyDocumentAsset:async()=>new Response(bytes),
    },
    './local-packet-ingestion':{readDocumentPageText:async(_bytes,_type,page)=>{parsed++;return {text:'Fictional page evidence',pageNumber:page,pageCount:3,method:'embedded-text'};}},
    '@/lib/pipeline/referral-store':{
      getReferralStoreReadiness:()=>({mode:local?'local_file':'postgres'}),
      getLocalUploadedDocument:async()=>({hash,file:{referralId:owner}}),
      getReferral:async()=>({documentHash:hash}),
    },
    '@/lib/pipeline/local-document-store':{readLocalReferralPacket:async()=>({bytes,contentType:'application/pdf'}),writeLocalReferralPacket:()=>{stored++;}},
  });
  const read=(page=1,revision)=>reader.readReferralDocumentPage(42,'file',page,revision);
  assert.equal((await read()).documentHash,hash);
  assert.equal((await read(2,hash)).nextPage,3);
  assert.equal((await read(3,hash)).nextPage,null);
  await assert.rejects(()=>read(2,'0'.repeat(64)),error=>error.code==='document_changed');
  assert.equal(parsed,3);
  owner=99;await assert.rejects(()=>read(),error=>error.status===404);assert.equal(parsed,3);owner=42;
  available=false;await assert.rejects(()=>read(),error=>error.code==='malware_pending');assert.equal(parsed,3);available=true;
  converted=true;assert.equal((await read()).source,'converted-preview');
  local=true;assert.equal((await read()).text,'Fictional page evidence');
  owner=99;await assert.rejects(()=>read(),error=>error.status===404);
  assert.equal(stored,0);
});
