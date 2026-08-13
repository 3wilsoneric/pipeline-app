insert into pipeline.people (external_client_id, display_name)
values ('pipeline-integration-fixture', 'Synthetic integration fixture')
on conflict (external_client_id) do update set display_name = excluded.display_name
returning person_id;

insert into pipeline.referrals (
  person_id, stage, community, priority, source, tags, search_text, data,
  created_by, created_by_name, updated_by, updated_by_name
)
select person_id, 'New', 'San Pablo', 'standard', 'Integration fixture',
  array['integration-fixture'], 'synthetic integration fixture',
  '{"name":"Synthetic integration fixture","date":"2026-08-09","stage":"New","community":"San Pablo","source":"Integration fixture","priority":"standard","documentName":"","documentStatus":"Missing","owner":"Fixture","note":"","createdAt":"2026-08-09T00:00:00.000Z","dob":"","phone":"","email":"","payer":""}'::jsonb,
  'fixture', 'Integration fixture', 'fixture', 'Integration fixture'
from pipeline.people where external_client_id = 'pipeline-integration-fixture'
returning referral_id;

insert into pipeline.documents (
  referral_id, person_id, category, file_name, content_type, byte_size, sha256,
  blob_container, blob_key, processing_status, uploaded_by,
  preview_status, malware_scan_status, page_count
)
select r.referral_id, r.person_id, 'referral_packet', 'synthetic-fixture.pdf',
  'application/pdf', 2048, repeat('c', 64), 'fixture',
  'fixture/integration/synthetic-fixture.pdf', 'ready_for_review', 'fixture',
  'ready', 'clean', 2
from pipeline.referrals r
join pipeline.people p on p.person_id = r.person_id
where p.external_client_id = 'pipeline-integration-fixture'
returning document_id;

insert into pipeline.document_preview_pages (
  document_id, page_number, blob_container, blob_key, content_type, byte_size, width, height
)
select document_id, page_number, 'fixture', 'fixture/integration/page-' || page_number || '.png',
  'image/png', 1024, 612, 792
from pipeline.documents
cross join generate_series(1, 2) page_number
where blob_key = 'fixture/integration/synthetic-fixture.pdf';

insert into pipeline.editing_presence (
  lease_id, referral_id, actor_id, actor_name, section, expires_at
)
select gen_random_uuid(), r.referral_id, 'fixture-user', 'Integration fixture', 'intake', now() + interval '45 seconds'
from pipeline.referrals r
join pipeline.people p on p.person_id = r.person_id
where p.external_client_id = 'pipeline-integration-fixture';
