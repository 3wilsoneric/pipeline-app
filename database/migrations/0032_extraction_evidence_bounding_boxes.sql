begin;

alter table pipeline.referral_fields
  add column if not exists evidence_bbox jsonb;

alter table pipeline.referral_fields
  drop constraint if exists referral_fields_evidence_bbox_check;
alter table pipeline.referral_fields
  add constraint referral_fields_evidence_bbox_check
  check (evidence_bbox is null or case
    when jsonb_typeof(evidence_bbox) = 'array' and jsonb_array_length(evidence_bbox) = 4
      and jsonb_typeof(evidence_bbox->0) = 'number' and jsonb_typeof(evidence_bbox->1) = 'number'
      and jsonb_typeof(evidence_bbox->2) = 'number' and jsonb_typeof(evidence_bbox->3) = 'number'
    then (evidence_bbox->>0)::numeric between 0 and 1
      and (evidence_bbox->>1)::numeric between 0 and 1
      and (evidence_bbox->>2)::numeric between 0 and 1
      and (evidence_bbox->>3)::numeric between 0 and 1
      and (evidence_bbox->>0)::numeric < (evidence_bbox->>2)::numeric
      and (evidence_bbox->>1)::numeric < (evidence_bbox->>3)::numeric
    else false
  end);

alter table pipeline.extraction_candidates
  add column if not exists evidence_bbox jsonb;

alter table pipeline.extraction_candidates
  drop constraint if exists extraction_candidates_evidence_bbox_check;
alter table pipeline.extraction_candidates
  add constraint extraction_candidates_evidence_bbox_check
  check (evidence_bbox is null or case
    when jsonb_typeof(evidence_bbox) = 'array' and jsonb_array_length(evidence_bbox) = 4
      and jsonb_typeof(evidence_bbox->0) = 'number' and jsonb_typeof(evidence_bbox->1) = 'number'
      and jsonb_typeof(evidence_bbox->2) = 'number' and jsonb_typeof(evidence_bbox->3) = 'number'
    then (evidence_bbox->>0)::numeric between 0 and 1
      and (evidence_bbox->>1)::numeric between 0 and 1
      and (evidence_bbox->>2)::numeric between 0 and 1
      and (evidence_bbox->>3)::numeric between 0 and 1
      and (evidence_bbox->>0)::numeric < (evidence_bbox->>2)::numeric
      and (evidence_bbox->>1)::numeric < (evidence_bbox->>3)::numeric
    else false
  end);

insert into pipeline.schema_migrations (migration_id)
values ('0032_extraction_evidence_bounding_boxes')
on conflict (migration_id) do nothing;

commit;
