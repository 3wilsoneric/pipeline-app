#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_TEST_DATABASE_URL?.trim();
if (!databaseUrl) fail("Configure PIPELINE_TEST_DATABASE_URL before running a rollback drill.");
if (process.env.PIPELINE_ALLOW_MIGRATION_ROLLBACK_DRILL !== "true") {
  fail("Set PIPELINE_ALLOW_MIGRATION_ROLLBACK_DRILL=true to acknowledge transactional DDL testing.");
}
if (databaseUrl === process.env.PIPELINE_DATABASE_URL?.trim() && process.env.PIPELINE_ALLOW_TEST_DATABASE_REUSE !== "true") {
  fail("The rollback drill cannot target PIPELINE_DATABASE_URL without explicit test database reuse approval.");
}
const collaborationRollback = await readFile("database/rollbacks/0005_collaboration.sql", "utf8");
const workspaceStateRollback = await readFile("database/rollbacks/0006_user_workspace_state.sql", "utf8");
const canonicalClientRollback = await readFile("database/rollbacks/0007_canonical_client_assessments.sql", "utf8");
const clientWorkspaceRollback = await readFile("database/rollbacks/0008_client_workspaces.sql", "utf8");
const assessmentCollaborationRollback = await readFile("database/rollbacks/0009_assessment_collaboration.sql", "utf8");
const provisionalMembersRollback = await readFile("database/rollbacks/0010_provisional_workspace_members.sql", "utf8");
const historicalWorkspacesRollback = await readFile("database/rollbacks/0011_historical_material_workspaces.sql", "utf8");
const referralTrashRollback = await readFile("database/rollbacks/0012_referral_trash.sql", "utf8");
const searchPerformanceRollback = await readFile("database/rollbacks/0013_search_performance.sql", "utf8");
const workspaceCountyRollback = await readFile("database/rollbacks/0014_workspace_county.sql", "utf8");
const assessorWorkflowRollback = await readFile("database/rollbacks/0015_assessor_workflow.sql", "utf8");
const zoomAssessmentMethodRollback = await readFile("database/rollbacks/0016_zoom_assessment_method.sql", "utf8");
const referralReceivedMonthRollback = await readFile("database/rollbacks/0017_referral_received_month.sql", "utf8");
const academyProgressRollback = await readFile("database/rollbacks/0018_academy_progress.sql", "utf8");
const operatorTrainingProgressRollback = await readFile("database/rollbacks/0019_operator_training_progress.sql", "utf8");
const alloCanvasContentRollback = await readFile("database/rollbacks/0020_allo_canvas_content.sql", "utf8");
const notePracticeLabRollback = await readFile("database/rollbacks/0021_note_practice_lab.sql", "utf8");
const noteLabPatternSelectionsRollback = await readFile("database/rollbacks/0022_note_lab_pattern_selections.sql", "utf8");
const noteLabFieldReviewsRollback = await readFile("database/rollbacks/0023_note_lab_field_reviews.sql", "utf8");
const workspaceMonthRollback = await readFile("database/rollbacks/0024_workspace_month_provenance.sql", "utf8");
const homeDashboardLayoutRollback = await readFile("database/rollbacks/0025_home_dashboard_layout.sql", "utf8");
const sql = postgres(databaseUrl, {
  ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full" ? "verify-full" : "require",
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  prepare: false,
  onnotice: () => undefined,
});
const connection = await sql.reserve();
const checks = [];

try {
  await connection`select pg_advisory_lock(hashtextextended('pipeline_schema_migrations', 0))`;
  await connection`begin`;
  const before = await connection`
    select to_regclass('pipeline.editing_presence') is not null as presence,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='section_versions') as sections,
      to_regclass('pipeline.user_workspace_state') is not null as workspace_state,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='canonical_client_id') as canonical_client,
      to_regclass('pipeline.client_update_outbox') is not null as client_update_outbox,
      exists(select 1 from pipeline.schema_migrations where migration_id='0007_canonical_client_assessments') as canonical_client_history,
      to_regclass('pipeline.client_file_import_items') is not null as client_file_import_items,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='documents' and column_name='canonical_client_id') as client_document_identity,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='documents' and column_name='client_community') as client_document_community,
      exists(select 1 from pipeline.schema_migrations where migration_id='0008_client_workspaces') as client_workspace_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='section_versions') as assessment_sections,
      to_regclass('pipeline.workspace_members') is not null as workspace_members,
      exists(select 1 from pipeline.schema_migrations where migration_id='0009_assessment_collaboration') as assessment_collaboration_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='workspace_members' and column_name='identity_status') as provisional_member_identity,
      exists(select 1 from pipeline.schema_migrations where migration_id='0010_provisional_workspace_members') as provisional_member_history,
      to_regclass('pipeline.workspace_import_batches') is not null as workspace_import_batches,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='workspace_status') as workspace_status,
      exists(select 1 from pipeline.schema_migrations where migration_id='0011_historical_material_workspaces') as historical_workspace_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='deleted_at') as referral_trash,
      exists(select 1 from pipeline.schema_migrations where migration_id='0012_referral_trash') as referral_trash_history,
      to_regclass('pipeline.people_display_name_search_trgm_idx') is not null as people_search_index,
      to_regclass('pipeline.documents_file_name_search_trgm_idx') is not null as document_search_index,
      exists(select 1 from pipeline.schema_migrations where migration_id='0013_search_performance') as search_performance_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='county') as workspace_county,
      to_regclass('pipeline.referrals_county_created_idx') is not null as workspace_county_index,
      exists(select 1 from pipeline.schema_migrations where migration_id='0014_workspace_county') as workspace_county_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='workflow_status') as assessor_workflow_status,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='signed_at') as assessment_signature,
      to_regclass('pipeline.assessment_addenda') is not null as assessment_addenda,
      to_regclass('pipeline.assessment_recommendations') is not null as assessment_recommendations,
      exists(select 1 from pipeline.schema_migrations where migration_id='0015_assessor_workflow') as assessor_workflow_history,
      exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'assessments_scheduled_method_check'
          and check_clause like '%zoom%'
      ) as zoom_method,
      exists(select 1 from pipeline.schema_migrations where migration_id='0016_zoom_assessment_method') as zoom_method_history,
      to_regclass('pipeline.referrals_workspace_received_idx') is null as legacy_received_month_index_removed,
      exists(select 1 from pipeline.schema_migrations where migration_id='0017_referral_received_month') as received_month_history,
      exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'user_workspace_state_state_kind_check'
          and check_clause like '%academy_progress%'
      ) as academy_progress_kind,
      exists(select 1 from pipeline.schema_migrations where migration_id='0018_academy_progress') as academy_progress_history,
      exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'user_workspace_state_state_kind_check'
          and check_clause like '%operator_training_progress%'
      ) as operator_training_progress_kind,
      exists(select 1 from pipeline.schema_migrations where migration_id='0019_operator_training_progress') as operator_training_progress_history,
      exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'user_workspace_state_state_kind_check'
          and check_clause like '%home_dashboard_layout%'
      ) as home_dashboard_layout_kind,
      exists(select 1 from pipeline.schema_migrations where migration_id='0025_home_dashboard_layout') as home_dashboard_layout_history,
      to_regclass('pipeline.canvas_content_snapshots') is not null as canvas_content_snapshots,
      to_regclass('pipeline.canvas_content_field_candidates') is not null as canvas_content_candidates,
      exists(select 1 from pipeline.schema_migrations where migration_id='0020_allo_canvas_content') as allo_canvas_content_history,
      to_regclass('pipeline.note_lab_votes') is not null as note_lab_votes,
      exists(select 1 from pipeline.schema_migrations where migration_id='0021_note_practice_lab') as note_practice_lab_history,
      to_regclass('pipeline.note_lab_pattern_selections') is not null as note_lab_pattern_selections,
      exists(select 1 from pipeline.schema_migrations where migration_id='0022_note_lab_pattern_selections') as note_lab_pattern_selections_history,
      to_regclass('pipeline.note_lab_field_reviews') is not null as note_lab_field_reviews,
      exists(select 1 from pipeline.schema_migrations where migration_id='0023_note_lab_field_reviews') as note_lab_field_reviews_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='workspace_month') as workspace_month,
      to_regclass('pipeline.referrals_workspace_month_idx') is not null as workspace_month_index,
      exists(select 1 from pipeline.schema_migrations where migration_id='0024_workspace_month_provenance') as workspace_month_history
  `;
  checks.push({
    name: "latest migrations exist before drill",
    ok: Boolean(
      before[0].presence
      && before[0].sections
      && before[0].workspace_state
      && before[0].canonical_client
      && before[0].client_update_outbox
      && before[0].canonical_client_history
      && before[0].client_file_import_items
      && before[0].client_document_identity
      && before[0].client_document_community
      && before[0].client_workspace_history
      && before[0].assessment_sections
      && before[0].workspace_members
      && before[0].assessment_collaboration_history
      && before[0].provisional_member_identity
      && before[0].provisional_member_history
      && before[0].workspace_import_batches
      && before[0].workspace_status
      && before[0].historical_workspace_history
      && before[0].referral_trash
      && before[0].referral_trash_history
      && before[0].people_search_index
      && before[0].document_search_index
      && before[0].search_performance_history
      && before[0].workspace_county
      && before[0].workspace_county_index
      && before[0].workspace_county_history
      && before[0].assessor_workflow_status
      && before[0].assessment_signature
      && before[0].assessment_addenda
      && before[0].assessment_recommendations
      && before[0].assessor_workflow_history
      && before[0].zoom_method
      && before[0].zoom_method_history
      && before[0].legacy_received_month_index_removed
      && before[0].received_month_history
      && before[0].academy_progress_kind
      && before[0].academy_progress_history
      && before[0].operator_training_progress_kind
      && before[0].operator_training_progress_history
      && before[0].home_dashboard_layout_kind
      && before[0].home_dashboard_layout_history
      && before[0].canvas_content_snapshots
      && before[0].canvas_content_candidates
      && before[0].allo_canvas_content_history
      && before[0].note_lab_votes
      && before[0].note_practice_lab_history
      && before[0].note_lab_pattern_selections
      && before[0].note_lab_pattern_selections_history
      && before[0].note_lab_field_reviews
      && before[0].note_lab_field_reviews_history
      && before[0].workspace_month
      && before[0].workspace_month_index
      && before[0].workspace_month_history
    ),
  });
  await connection.unsafe(homeDashboardLayoutRollback);
  const homeDashboardLayoutDuring = await connection`
    select not exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'user_workspace_state_state_kind_check'
          and check_clause like '%home_dashboard_layout%'
      ) as kind_removed,
      exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'user_workspace_state_state_kind_check'
          and check_clause like '%operator_training_progress%'
      ) as operator_training_kind_preserved,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0025_home_dashboard_layout') as history_removed,
      exists(select 1 from pipeline.schema_migrations where migration_id='0024_workspace_month_provenance') as prior_history_preserved
  `;
  checks.push({
    name: "rollback removes Home dashboard layout state support and preserves prior workspace state",
    ok: Boolean(
      homeDashboardLayoutDuring[0].kind_removed
      && homeDashboardLayoutDuring[0].operator_training_kind_preserved
      && homeDashboardLayoutDuring[0].history_removed
      && homeDashboardLayoutDuring[0].prior_history_preserved
    ),
  });
  await connection.unsafe(workspaceMonthRollback);
  const workspaceMonthDuring = await connection`
    select
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='workspace_month') as month_removed,
      to_regclass('pipeline.referrals_workspace_month_idx') is null as month_index_removed,
      to_regclass('pipeline.referrals_workspace_received_idx') is not null as prior_index_restored,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0024_workspace_month_provenance') as history_removed,
      exists(select 1 from pipeline.schema_migrations where migration_id='0023_note_lab_field_reviews') as prior_history_preserved
  `;
  checks.push({
    name: "rollback removes workspace-month fields and restores the prior month index",
    ok: Boolean(
      workspaceMonthDuring[0].month_removed
      && workspaceMonthDuring[0].month_index_removed
      && workspaceMonthDuring[0].prior_index_restored
      && workspaceMonthDuring[0].history_removed
      && workspaceMonthDuring[0].prior_history_preserved
    ),
  });
  await connection.unsafe(noteLabFieldReviewsRollback);
  const noteLabFieldReviewsDuring = await connection`
    select to_regclass('pipeline.note_lab_field_reviews') is null as reviews_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0023_note_lab_field_reviews') as history_removed,
      exists(select 1 from pipeline.schema_migrations where migration_id='0022_note_lab_pattern_selections') as prior_history_preserved
  `;
  checks.push({
    name: "rollback removes note lab field reviews and preserves prior migration history",
    ok: Boolean(
      noteLabFieldReviewsDuring[0].reviews_removed
      && noteLabFieldReviewsDuring[0].history_removed
      && noteLabFieldReviewsDuring[0].prior_history_preserved
    ),
  });
  await connection.unsafe(noteLabPatternSelectionsRollback);
  const noteLabPatternSelectionsDuring = await connection`
    select to_regclass('pipeline.note_lab_pattern_selections') is null as selections_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0022_note_lab_pattern_selections') as history_removed,
      exists(select 1 from pipeline.schema_migrations where migration_id='0021_note_practice_lab') as prior_history_preserved
  `;
  checks.push({
    name: "rollback removes note lab pattern selections and preserves prior migration history",
    ok: Boolean(
      noteLabPatternSelectionsDuring[0].selections_removed
      && noteLabPatternSelectionsDuring[0].history_removed
      && noteLabPatternSelectionsDuring[0].prior_history_preserved
    ),
  });
  await connection.unsafe(notePracticeLabRollback);
  const notePracticeLabDuring = await connection`
    select to_regclass('pipeline.note_lab_votes') is null as votes_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0021_note_practice_lab') as history_removed,
      exists(select 1 from pipeline.schema_migrations where migration_id='0020_allo_canvas_content') as prior_history_preserved
  `;
  checks.push({
    name: "rollback removes note practice votes and preserves prior migration history",
    ok: Boolean(
      notePracticeLabDuring[0].votes_removed
      && notePracticeLabDuring[0].history_removed
      && notePracticeLabDuring[0].prior_history_preserved
    ),
  });
  await connection.unsafe(alloCanvasContentRollback);
  const alloCanvasContentDuring = await connection`
    select to_regclass('pipeline.canvas_content_snapshots') is null as snapshots_removed,
      to_regclass('pipeline.canvas_content_field_candidates') is null as candidates_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0020_allo_canvas_content') as history_removed,
      exists(select 1 from pipeline.schema_migrations where migration_id='0019_operator_training_progress') as prior_history_preserved
  `;
  checks.push({
    name: "rollback removes ALLO canvas-content tables and preserves prior migration history",
    ok: Boolean(
      alloCanvasContentDuring[0].snapshots_removed
      && alloCanvasContentDuring[0].candidates_removed
      && alloCanvasContentDuring[0].history_removed
      && alloCanvasContentDuring[0].prior_history_preserved
    ),
  });
  await connection.unsafe(operatorTrainingProgressRollback);
  const operatorTrainingProgressDuring = await connection`
    select not exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'user_workspace_state_state_kind_check'
          and check_clause like '%operator_training_progress%'
      ) as kind_removed,
      exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'user_workspace_state_state_kind_check'
          and check_clause like '%academy_progress%'
      ) as academy_kind_preserved,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0019_operator_training_progress') as history_removed
  `;
  checks.push({
    name: "rollback removes operator training state support and preserves Developer Academy state",
    ok: Boolean(operatorTrainingProgressDuring[0].kind_removed && operatorTrainingProgressDuring[0].academy_kind_preserved && operatorTrainingProgressDuring[0].history_removed),
  });
  await connection.unsafe(academyProgressRollback);
  const academyProgressDuring = await connection`
    select not exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'user_workspace_state_state_kind_check'
          and check_clause like '%academy_progress%'
      ) as kind_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0018_academy_progress') as history_removed
  `;
  checks.push({
    name: "rollback removes Academy progress state support",
    ok: Boolean(academyProgressDuring[0].kind_removed && academyProgressDuring[0].history_removed),
  });
  await connection.unsafe(referralReceivedMonthRollback);
  const referralReceivedMonthDuring = await connection`
    select to_regclass('pipeline.referrals_workspace_received_idx') is null as index_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0017_referral_received_month') as history_removed
  `;
  checks.push({
    name: "rollback removes referral received-month index",
    ok: Boolean(referralReceivedMonthDuring[0].index_removed && referralReceivedMonthDuring[0].history_removed),
  });
  await connection.unsafe(zoomAssessmentMethodRollback);
  const zoomAssessmentMethodDuring = await connection`
    select exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'assessments_scheduled_method_check'
          and check_clause not like '%zoom%'
      ) as zoom_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0016_zoom_assessment_method') as history_removed
  `;
  checks.push({
    name: "rollback maps Zoom schedules to the legacy video method",
    ok: Boolean(zoomAssessmentMethodDuring[0].zoom_removed && zoomAssessmentMethodDuring[0].history_removed),
  });
  await connection.unsafe(assessorWorkflowRollback);
  const assessorWorkflowDuring = await connection`
    select not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='workflow_status') as workflow_status_removed,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='signed_at') as signature_removed,
      to_regclass('pipeline.assessment_addenda') is null as addenda_removed,
      to_regclass('pipeline.assessment_recommendations') is null as recommendations_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0015_assessor_workflow') as history_removed
  `;
  checks.push({
    name: "rollback removes assessor workflow extensions",
    ok: Boolean(
      assessorWorkflowDuring[0].workflow_status_removed
      && assessorWorkflowDuring[0].signature_removed
      && assessorWorkflowDuring[0].addenda_removed
      && assessorWorkflowDuring[0].recommendations_removed
      && assessorWorkflowDuring[0].history_removed
    ),
  });
  await connection.unsafe(workspaceCountyRollback);
  const workspaceCountyDuring = await connection`
    select not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='county') as county_removed,
      to_regclass('pipeline.referrals_county_created_idx') is null as county_index_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0014_workspace_county') as history_removed
  `;
  checks.push({
    name: "rollback removes workspace county facet",
    ok: Boolean(workspaceCountyDuring[0].county_removed && workspaceCountyDuring[0].county_index_removed && workspaceCountyDuring[0].history_removed),
  });
  await connection.unsafe(searchPerformanceRollback);
  const searchPerformanceDuring = await connection`
    select to_regclass('pipeline.people_display_name_search_trgm_idx') is null as people_search_index_removed,
      to_regclass('pipeline.documents_file_name_search_trgm_idx') is null as document_search_index_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0013_search_performance') as history_removed
  `;
  checks.push({
    name: "rollback removes search performance indexes",
    ok: Boolean(
      searchPerformanceDuring[0].people_search_index_removed
      && searchPerformanceDuring[0].document_search_index_removed
      && searchPerformanceDuring[0].history_removed
    ),
  });
  await connection.unsafe(referralTrashRollback);
  const referralTrashDuring = await connection`
    select not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='deleted_at') as trash_columns_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0012_referral_trash') as history_removed
  `;
  checks.push({ name: "rollback removes referral trash extensions", ok: Boolean(referralTrashDuring[0].trash_columns_removed && referralTrashDuring[0].history_removed) });
  await connection.unsafe(historicalWorkspacesRollback);
  const historicalWorkspacesDuring = await connection`
    select to_regclass('pipeline.workspace_import_batches') is null as import_batches_removed,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='workspace_status') as workspace_status_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0011_historical_material_workspaces') as history_removed
  `;
  checks.push({
    name: "rollback removes historical workspace extensions",
    ok: Boolean(
      historicalWorkspacesDuring[0].import_batches_removed
      && historicalWorkspacesDuring[0].workspace_status_removed
      && historicalWorkspacesDuring[0].history_removed
    ),
  });
  await connection.unsafe(provisionalMembersRollback);
  const provisionalMembersDuring = await connection`
    select to_regclass('pipeline.workspace_members') is not null as workspace_members_preserved,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='workspace_members' and column_name='identity_status') as identity_status_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0010_provisional_workspace_members') as history_removed
  `;
  checks.push({
    name: "rollback removes provisional-member identity extensions",
    ok: Boolean(
      provisionalMembersDuring[0].workspace_members_preserved
      && provisionalMembersDuring[0].identity_status_removed
      && provisionalMembersDuring[0].history_removed
    ),
  });
  await connection.unsafe(assessmentCollaborationRollback);
  const assessmentCollaborationDuring = await connection`
    select to_regclass('pipeline.workspace_members') is null as workspace_members_removed,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='section_versions') as assessment_sections_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0009_assessment_collaboration') as history_removed,
      exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'user_workspace_state_state_kind_check'
          and check_clause not like '%assessment_draft%'
      ) as assessment_drafts_removed
  `;
  checks.push({
    name: "rollback removes assessment-collaboration objects",
    ok: Boolean(
      assessmentCollaborationDuring[0].workspace_members_removed
      && assessmentCollaborationDuring[0].assessment_sections_removed
      && assessmentCollaborationDuring[0].history_removed
      && assessmentCollaborationDuring[0].assessment_drafts_removed
    ),
  });
  await connection.unsafe(clientWorkspaceRollback);
  const clientWorkspaceDuring = await connection`
    select to_regclass('pipeline.client_file_import_items') is null as import_items_removed,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='documents' and column_name='canonical_client_id') as client_document_identity_removed,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='documents' and column_name='client_community') as client_document_community_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0008_client_workspaces') as history_removed
  `;
  checks.push({
    name: "rollback removes client-workspace objects",
    ok: Boolean(clientWorkspaceDuring[0].import_items_removed && clientWorkspaceDuring[0].client_document_identity_removed && clientWorkspaceDuring[0].client_document_community_removed && clientWorkspaceDuring[0].history_removed),
  });
  await connection.unsafe(canonicalClientRollback);
  const canonicalClientDuring = await connection`
    select to_regclass('pipeline.client_update_outbox') is null as client_update_outbox_removed,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='canonical_client_id') as canonical_client_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0007_canonical_client_assessments') as history_removed
  `;
  checks.push({
    name: "rollback removes canonical-client objects",
    ok: Boolean(
      canonicalClientDuring[0].client_update_outbox_removed
      && canonicalClientDuring[0].canonical_client_removed
      && canonicalClientDuring[0].history_removed
    ),
  });
  await connection.unsafe(workspaceStateRollback);
  const workspaceDuring = await connection`
    select to_regclass('pipeline.user_workspace_state') is null as workspace_state_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0006_user_workspace_state') as history_removed
  `;
  checks.push({ name: "rollback removes workspace-state objects", ok: Boolean(workspaceDuring[0].workspace_state_removed && workspaceDuring[0].history_removed) });
  await connection.unsafe(collaborationRollback);
  const during = await connection`
    select to_regclass('pipeline.editing_presence') is null as presence_removed,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='section_versions') as sections_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0005_collaboration') as history_removed
  `;
  checks.push({ name: "rollback removes collaboration objects", ok: Boolean(during[0].presence_removed && during[0].sections_removed && during[0].history_removed) });
  await connection`rollback`;
  const after = await connection`
    select to_regclass('pipeline.editing_presence') is not null as presence,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='section_versions') as sections,
      exists(select 1 from pipeline.schema_migrations where migration_id='0005_collaboration') as collaboration_history,
      to_regclass('pipeline.user_workspace_state') is not null as workspace_state,
      exists(select 1 from pipeline.schema_migrations where migration_id='0006_user_workspace_state') as workspace_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='canonical_client_id') as canonical_client,
      to_regclass('pipeline.client_update_outbox') is not null as client_update_outbox,
      exists(select 1 from pipeline.schema_migrations where migration_id='0007_canonical_client_assessments') as canonical_client_history,
      to_regclass('pipeline.client_file_import_items') is not null as client_file_import_items,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='documents' and column_name='canonical_client_id') as client_document_identity,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='documents' and column_name='client_community') as client_document_community,
      exists(select 1 from pipeline.schema_migrations where migration_id='0008_client_workspaces') as client_workspace_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='section_versions') as assessment_sections,
      to_regclass('pipeline.workspace_members') is not null as workspace_members,
      exists(select 1 from pipeline.schema_migrations where migration_id='0009_assessment_collaboration') as assessment_collaboration_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='workspace_members' and column_name='identity_status') as provisional_member_identity,
      exists(select 1 from pipeline.schema_migrations where migration_id='0010_provisional_workspace_members') as provisional_member_history,
      to_regclass('pipeline.workspace_import_batches') is not null as workspace_import_batches,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='workspace_status') as workspace_status,
      exists(select 1 from pipeline.schema_migrations where migration_id='0011_historical_material_workspaces') as historical_workspace_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='deleted_at') as referral_trash,
      exists(select 1 from pipeline.schema_migrations where migration_id='0012_referral_trash') as referral_trash_history,
      to_regclass('pipeline.people_display_name_search_trgm_idx') is not null as people_search_index,
      to_regclass('pipeline.documents_file_name_search_trgm_idx') is not null as document_search_index,
      exists(select 1 from pipeline.schema_migrations where migration_id='0013_search_performance') as search_performance_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='county') as workspace_county,
      to_regclass('pipeline.referrals_county_created_idx') is not null as workspace_county_index,
      exists(select 1 from pipeline.schema_migrations where migration_id='0014_workspace_county') as workspace_county_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='workflow_status') as assessor_workflow_status,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='signed_at') as assessment_signature,
      to_regclass('pipeline.assessment_addenda') is not null as assessment_addenda,
      to_regclass('pipeline.assessment_recommendations') is not null as assessment_recommendations,
      exists(select 1 from pipeline.schema_migrations where migration_id='0015_assessor_workflow') as assessor_workflow_history,
      exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'assessments_scheduled_method_check'
          and check_clause like '%zoom%'
      ) as zoom_method,
      exists(select 1 from pipeline.schema_migrations where migration_id='0016_zoom_assessment_method') as zoom_method_history,
      to_regclass('pipeline.referrals_workspace_received_idx') is null as legacy_received_month_index_removed,
      exists(select 1 from pipeline.schema_migrations where migration_id='0017_referral_received_month') as received_month_history,
      exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'user_workspace_state_state_kind_check'
          and check_clause like '%academy_progress%'
      ) as academy_progress_kind,
      exists(select 1 from pipeline.schema_migrations where migration_id='0018_academy_progress') as academy_progress_history,
      exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'user_workspace_state_state_kind_check'
          and check_clause like '%operator_training_progress%'
      ) as operator_training_progress_kind,
      exists(select 1 from pipeline.schema_migrations where migration_id='0019_operator_training_progress') as operator_training_progress_history,
      exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'user_workspace_state_state_kind_check'
          and check_clause like '%home_dashboard_layout%'
      ) as home_dashboard_layout_kind,
      exists(select 1 from pipeline.schema_migrations where migration_id='0025_home_dashboard_layout') as home_dashboard_layout_history,
      to_regclass('pipeline.canvas_content_snapshots') is not null as canvas_content_snapshots,
      to_regclass('pipeline.canvas_content_field_candidates') is not null as canvas_content_candidates,
      exists(select 1 from pipeline.schema_migrations where migration_id='0020_allo_canvas_content') as allo_canvas_content_history,
      to_regclass('pipeline.note_lab_votes') is not null as note_lab_votes,
      exists(select 1 from pipeline.schema_migrations where migration_id='0021_note_practice_lab') as note_practice_lab_history,
      to_regclass('pipeline.note_lab_pattern_selections') is not null as note_lab_pattern_selections,
      exists(select 1 from pipeline.schema_migrations where migration_id='0022_note_lab_pattern_selections') as note_lab_pattern_selections_history,
      to_regclass('pipeline.note_lab_field_reviews') is not null as note_lab_field_reviews,
      exists(select 1 from pipeline.schema_migrations where migration_id='0023_note_lab_field_reviews') as note_lab_field_reviews_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='workspace_month') as workspace_month,
      to_regclass('pipeline.referrals_workspace_month_idx') is not null as workspace_month_index,
      exists(select 1 from pipeline.schema_migrations where migration_id='0024_workspace_month_provenance') as workspace_month_history
  `;
  checks.push({
    name: "drill transaction restores original schema",
    ok: Boolean(
      after[0].presence
      && after[0].sections
      && after[0].collaboration_history
      && after[0].workspace_state
      && after[0].workspace_history
      && after[0].canonical_client
      && after[0].client_update_outbox
      && after[0].canonical_client_history
      && after[0].client_file_import_items
      && after[0].client_document_identity
      && after[0].client_document_community
      && after[0].client_workspace_history
      && after[0].assessment_sections
      && after[0].workspace_members
      && after[0].assessment_collaboration_history
      && after[0].provisional_member_identity
      && after[0].provisional_member_history
      && after[0].workspace_import_batches
      && after[0].workspace_status
      && after[0].historical_workspace_history
      && after[0].referral_trash
      && after[0].referral_trash_history
      && after[0].people_search_index
      && after[0].document_search_index
      && after[0].search_performance_history
      && after[0].workspace_county
      && after[0].workspace_county_index
      && after[0].workspace_county_history
      && after[0].assessor_workflow_status
      && after[0].assessment_signature
      && after[0].assessment_addenda
      && after[0].assessment_recommendations
      && after[0].assessor_workflow_history
      && after[0].zoom_method
      && after[0].zoom_method_history
      && after[0].legacy_received_month_index_removed
      && after[0].received_month_history
      && after[0].academy_progress_kind
      && after[0].academy_progress_history
      && after[0].operator_training_progress_kind
      && after[0].operator_training_progress_history
      && after[0].home_dashboard_layout_kind
      && after[0].home_dashboard_layout_history
      && after[0].canvas_content_snapshots
      && after[0].canvas_content_candidates
      && after[0].allo_canvas_content_history
      && after[0].note_lab_votes
      && after[0].note_practice_lab_history
      && after[0].note_lab_pattern_selections
      && after[0].note_lab_pattern_selections_history
      && after[0].note_lab_field_reviews
      && after[0].note_lab_field_reviews_history
      && after[0].workspace_month
      && after[0].workspace_month_index
      && after[0].workspace_month_history
    ),
  });
  const failed = checks.filter((check) => !check.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, checks, transactional: true }, null, 2));
  if (failed.length) process.exitCode = 1;
} catch {
  await connection`rollback`.catch(() => undefined);
  fail("The migration rollback drill failed. The transaction was rolled back.");
} finally {
  await connection`select pg_advisory_unlock(hashtextextended('pipeline_schema_migrations', 0))`.catch(() => undefined);
  connection.release();
  await sql.end({ timeout: 5 });
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_TEST_DATABASE_URL: Boolean(databaseUrl) } }, null, 2));
  process.exit(1);
}
