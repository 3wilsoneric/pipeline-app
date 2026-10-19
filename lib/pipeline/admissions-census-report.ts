import type { PlatformAdmissionsSummary } from "./platform-admissions-summary";

// Keep the browser report smaller than the Platform integration payload. In
// particular, board management profiles and assessment details stay server-side.
export function buildAdmissionsCensusReport(summary: PlatformAdmissionsSummary) {
  return {
    generated_at: summary.generated_at,
    metrics: summary.metrics,
    upcoming_admissions: summary.upcoming_admissions,
    board_columns: summary.board.columns.map(({ key, label, count }) => ({ key, label, count })),
    history: summary.history,
    briefing: {
      window_end: summary.briefing.window_end,
      coverage: {
        assessments_complete: summary.briefing.coverage.assessments_complete,
        move_ins_complete: summary.briefing.coverage.move_ins_complete,
      },
      upcoming_assessments: summary.briefing.upcoming_assessments.map(({ client_name, scheduled_at, community, owner, pipeline_path }) =>
        ({ client_name, scheduled_at, community, owner, pipeline_path })),
      planned_move_ins: summary.briefing.planned_move_ins.map(({ client_name, planned_at, community, readiness, pipeline_path }) =>
        ({ client_name, planned_at, community, readiness, pipeline_path })),
    },
  };
}

export type AdmissionsCensusReport = ReturnType<typeof buildAdmissionsCensusReport>;
