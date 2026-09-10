alter table pipeline.extraction_candidates
  drop constraint if exists extraction_candidates_evidence_bbox_check,
  drop column if exists evidence_bbox;

alter table pipeline.referral_fields
  drop constraint if exists referral_fields_evidence_bbox_check,
  drop column if exists evidence_bbox;

delete from pipeline.schema_migrations
where migration_id = '0032_extraction_evidence_bounding_boxes';
