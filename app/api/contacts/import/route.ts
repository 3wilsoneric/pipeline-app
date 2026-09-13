import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { validateClientMutationId } from "@/lib/pipeline/client-mutation-id";
import { ContactImportError, contactImportTemplate, parseContactImportCsv, readContactImportCsv } from "@/lib/pipeline/contact-import";
import { importContactDirectory, previewContactDirectoryImport, requireContactStore } from "@/lib/pipeline/contact-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/contacts/import", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator"]);
    if (!auth.ok) return auth.response;
    return new Response(contactImportTemplate, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="contact-directory-template.csv"' },
    });
  });
}

export async function POST(request: Request) {
  return withApiLogging(request, "/api/contacts/import", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireContactStore();
    if (!store.ok) return store.response;
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode !== "preview" && mode !== "commit") return jsonError("mode must be preview or commit.");
    const mutation = validateClientMutationId(request.headers.get("x-client-mutation-id") ?? undefined);
    if (!mutation.ok) return jsonError(mutation.message);
    if (mode === "commit" && !mutation.value) return jsonError("x-client-mutation-id is required for import.");
    try {
      const rows = parseContactImportCsv(await readContactImportCsv(request));
      if (mode === "preview") return Response.json({ ok: true, preview: await previewContactDirectoryImport(rows) });
      const result = await importContactDirectory(rows, pipelineAuditActor(auth.user), mutation.value!);
      return Response.json(result, { status: result.ok ? (result.idempotentReplay ? 200 : 201) : result.status });
    } catch (error) {
      if (error instanceof ContactImportError) return jsonError(error.message, error.status);
      throw error;
    }
  });
}
