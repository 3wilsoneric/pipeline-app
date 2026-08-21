import "server-only";

import postgres, { type Sql } from "postgres";

export type PipelineDatabaseMode = "disconnected" | "postgres";

export type PipelineDatabaseReadiness = {
  mode: PipelineDatabaseMode;
  required: boolean;
  ready: boolean;
  multi_instance_safe: boolean;
  missing_env: string[];
  message: string | null;
};

const globalForPipelineDatabase = globalThis as typeof globalThis & {
  __pipelineSql?: Sql;
};

export function getPipelineDatabaseMode(): PipelineDatabaseMode {
  const configured = process.env.PIPELINE_DATABASE_MODE?.trim();
  if (configured === "postgres") return "postgres";
  return "disconnected";
}

export function getPipelineDatabaseReadiness(): PipelineDatabaseReadiness {
  const mode = getPipelineDatabaseMode();
  const required = process.env.NODE_ENV === "production" && process.env.PIPELINE_ALLOW_LOCAL_REFERRAL_STORE !== "true";
  const missingEnv = mode === "postgres" && !process.env.PIPELINE_DATABASE_URL?.trim()
    ? ["PIPELINE_DATABASE_URL"]
    : [];
  const ready = mode === "postgres" && missingEnv.length === 0;

  return {
    mode,
    required,
    ready,
    multi_instance_safe: ready,
    missing_env: missingEnv,
    message: ready
      ? null
      : mode === "postgres"
        ? "Configure the server-only Pipeline database connection."
        : "Pipeline PostgreSQL storage is not connected in this environment.",
  };
}

export function getPipelineSql(): Sql {
  const readiness = getPipelineDatabaseReadiness();
  if (!readiness.ready) throw new Error(readiness.message ?? "Pipeline database is unavailable.");

  if (!globalForPipelineDatabase.__pipelineSql) {
    globalForPipelineDatabase.__pipelineSql = postgres(process.env.PIPELINE_DATABASE_URL!.trim(), {
      connection: { application_name: "pipeline-app" },
      ssl: databaseSslMode(),
      max: boundedInteger("PIPELINE_DATABASE_POOL_MAX", 5, 1, 20),
      connect_timeout: boundedInteger("PIPELINE_DATABASE_CONNECT_TIMEOUT_SECONDS", 10, 2, 30),
      idle_timeout: boundedInteger("PIPELINE_DATABASE_IDLE_TIMEOUT_SECONDS", 20, 5, 120),
      max_lifetime: boundedInteger("PIPELINE_DATABASE_MAX_LIFETIME_SECONDS", 60 * 30, 60, 60 * 60),
      prepare: false,
      onnotice: () => undefined,
    });
  }

  return globalForPipelineDatabase.__pipelineSql;
}

export async function checkPipelineDatabaseConnection() {
  const sql = getPipelineSql();
  const rows = await sql<{ migration_id: string }[]>`
    select migration_id
    from pipeline.schema_migrations
    where migration_id in (
      '0001_pipeline_core', '0002_workflow_engine', '0003_operational_hardening',
      '0004_document_processing', '0005_collaboration', '0006_user_workspace_state',
      '0007_canonical_client_assessments', '0008_client_workspaces',
      '0009_assessment_collaboration'
    )
  `;
  return new Set(rows.map((row) => row.migration_id)).size === 9;
}

function databaseSslMode(): "require" | "verify-full" | false {
  const configured = process.env.PIPELINE_DATABASE_SSL_MODE?.trim();
  if (configured === "disable") return false;
  if (configured === "verify-full") return "verify-full";
  return "require";
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}
