-- Read-only export for the prospective assessment research contract.
-- The output is PHI-sensitive even though direct identifiers are removed by
-- the profiling command. Run only from an approved internal environment.

select jsonb_build_object(
  'referral_id', a.referral_id,
  'assessment_id', a.assessment_id,
  'canonical_client_id', coalesce(
    nullif(a.canonical_client_id, ''),
    nullif(p.external_client_id, ''),
    'person:' || p.person_id::text
  ),
  'assessment_version', a.version,
  'assessment_schema_version', 'pipeline_assessment_tool_v1',
  'signed_at', a.signed_at,
  'assessment_data', a.data,
  'field_provenance', coalesce(provenance.fields, '{}'::jsonb),
  'audit', jsonb_build_object(
    'community', r.community,
    'assessor_id', a.assessor_id,
    'referral_source', r.source,
    'referring_facility', a.data->>'referring_facility',
    'scheduled_method', a.scheduled_method,
    'assessment_duration_minutes', case
      when a.started_at is not null and a.signed_at >= a.started_at
        then round(extract(epoch from (a.signed_at - a.started_at)) / 60.0, 3)
      else null
    end
  ),
  'recommendation', case
    when recommendation.recommendation_id is null then null
    else jsonb_build_object(
      'outcome', recommendation.outcome,
      'reason_code', recommendation.reason_code,
      'recommended_at', recommendation.recommended_at
    )
  end,
  'decision', case
    when decision.decision_id is null then null
    else jsonb_build_object(
      'outcome', decision.outcome,
      'reason_code', decision.reason_code,
      'decided_at', decision.decided_at
    )
  end,
  'follow_up', '[]'::jsonb
)::text as ndjson
from pipeline.assessments a
join pipeline.referrals r on r.referral_id = a.referral_id
join pipeline.people p on p.person_id = r.person_id
left join lateral (
  select jsonb_object_agg(grouped.field_key, grouped.evidence) as fields
  from (
    select
      afp.field_key,
      jsonb_agg(
        jsonb_build_object(
          'source_field_key', afp.source_field_key,
          'source_file', afp.source_file,
          'source_page', afp.source_page,
          'confidence', afp.confidence,
          'review_status', afp.review_status,
          'reviewed_at', afp.reviewed_at
        ) order by afp.created_at, afp.provenance_id
      ) as evidence
    from pipeline.assessment_field_provenance afp
    where afp.assessment_id = a.assessment_id
    group by afp.field_key
  ) grouped
) provenance on true
left join pipeline.assessment_recommendations recommendation
  on recommendation.assessment_id = a.assessment_id
left join pipeline.admission_decisions decision
  on decision.referral_id = a.referral_id
where a.signed_at is not null
order by a.signed_at, a.assessment_id;
