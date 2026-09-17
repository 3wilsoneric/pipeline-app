import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { validateClientMutationId } from "@/lib/pipeline/client-mutation-id";
import { ContactImportError, contactImportTemplate, parseContactImportCsv, readContactImportCsv, type ContactImportResult } from "@/lib/pipeline/contact-import";
import { importContactDirectory, previewContactDirectoryImport, requireContactStore } from "@/lib/pipeline/contact-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/contacts/import", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    return new Response(contactImportTemplate, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="contact-directory-template.csv"' },
    });
  });
}

export async function POST(request: Request) {
  return withApiLogging(request, "/api/contacts/import", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireContactStore();
    if (!store.ok) return store.response;
    const options = parseImportOptions(request);
    if (!options.ok) return options.response;
    try {
      const rows = parseContactImportCsv(await readContactImportCsv(request));
      if (options.value.mode === "preview") return Response.json({ ok: true, preview: await previewContactDirectoryImport(rows) });
      const result = await importContactDirectory(rows, pipelineAuditActor(auth.user), options.value.mutationId);
      return importResponse(result);
    } catch (error) {
      if (error instanceof ContactImportError) return jsonError(error.message, error.status);
      throw error;
    }
  });
}

type ImportOptions = { mode: "preview" } | { mode: "commit"; mutationId: string };

function parseImportOptions(request: Request): { ok: true; value: ImportOptions } | { ok: false; response: Response } {
  const mode = new URL(request.url).searchParams.get("mode");
  if (mode !== "preview" && mode !== "commit") return { ok: false, response: jsonError("mode must be preview or commit.") };
  const mutation = validateClientMutationId(request.headers.get("x-client-mutation-id") ?? undefined);
  if (!mutation.ok) return { ok: false, response: jsonError(mutation.message) };
  if (mode === "commit") {
    if (!mutation.value) return { ok: false, response: jsonError("x-client-mutation-id is required for import.") };
    return { ok: true, value: { mode, mutationId: mutation.value } };
  }
  return { ok: true, value: { mode } };
}

function importResponse(result: ContactImportResult) {
  if (!result.ok) return Response.json(result, { status: result.status });
  return Response.json(result, { status: result.idempotentReplay ? 200 : 201 });
}
