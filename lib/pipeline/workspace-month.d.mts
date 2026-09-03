export type WorkspaceMonthBasis =
  | "received_date"
  | "record_created_at"
  | "source_project_name"
  | "unknown";

export type WorkspaceMonthInput = {
  workspaceMonth?: string | null;
  workspaceMonthBasis?: WorkspaceMonthBasis | null;
  workspaceOrigin?: "pipeline" | "allo" | "import" | null;
  sourceProjectName?: string | null;
  date?: string | null;
  createdAt?: string | null;
};

export function normalizeWorkspaceMonth(value?: string | null): string | null;
export function workspaceMonthFromDate(value?: string | null): string | null;
export function workspaceMonthFromProjectName(value?: string | null): string | null;
export function resolveWorkspaceMonth(value?: WorkspaceMonthInput | null): {
  month: string | null;
  basis: WorkspaceMonthBasis;
};
export function workspaceMonthKey(value?: WorkspaceMonthInput | null): string;
