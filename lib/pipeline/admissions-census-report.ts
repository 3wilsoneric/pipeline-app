import type { PlatformAdmissionsSummary } from "./platform-admissions-summary";

// Keep the browser report smaller than the Platform integration payload. In
// particular, board management profiles and assessment details stay server-side.
export function buildAdmissionsCensusReport(summary: PlatformAdmissionsSummary) {
  return {
    generated_at: summary.generated_at,
    board_columns: summary.board.columns.map(({ key, label, count }) => ({ key, label, count })),
    briefing: {
      week_start: summary.briefing.week_start,
      week_end: summary.briefing.week_end,
      last_week_start: summary.briefing.last_week_start,
      last_week_end: summary.briefing.last_week_end,
      coverage: {
        move_ins_complete: summary.briefing.coverage.move_ins_complete,
        admitted_last_week_complete: summary.briefing.coverage.admitted_last_week_complete,
        moving_through_complete: summary.briefing.coverage.moving_through_complete,
      },
      admitted_last_week: summary.briefing.admitted_last_week.map(({ client_name, admitted_at, community, source_name, referring_county, pipeline_path }) =>
        ({ client_name, admitted_at, community, source_name, referring_county, pipeline_path })),
      planned_move_ins: summary.briefing.planned_move_ins.map(({ client_name, planned_at, community, readiness, source_name, referring_county, pipeline_path }) =>
        ({ client_name, planned_at, community, readiness, source_name, referring_county, pipeline_path })),
      moving_through: summary.briefing.moving_through.map(({ client_name, stage, status, community, owner, source_name, referring_county, pipeline_path }) =>
        ({ client_name, stage, status, community, owner, source_name, referring_county, pipeline_path })),
    },
  };
}

export type AdmissionsCensusReport = ReturnType<typeof buildAdmissionsCensusReport>;
