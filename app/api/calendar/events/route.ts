import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getAssessmentCalendar } from "@/lib/pipeline/calendar-store";
import { requireReferralStore } from "@/lib/pipeline/referral-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/calendar/events", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const referralStore = requireReferralStore();
    if (!referralStore.ok) return referralStore.response;
    const assessmentStore = requireAssessmentStore();
    if (!assessmentStore.ok) return assessmentStore.response;
    const params = new URL(request.url).searchParams;
    const range = resolveRange(params.get("month"), params.get("from"), params.get("to"));
    if (!range.ok) return Response.json({ error: range.error }, { status: 400 });

    const calendar = await getAssessmentCalendar(auth.user, range);
    return Response.json({ month: range.month, ...calendar }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function resolveRange(month: string | null, from: string | null, to: string | null) {
  if (from || to) {
    if (!from || !to) return { ok: false as const, error: "from and to must be provided together." };
    if (!isDateKey(from) || !isDateKey(to)) return { ok: false as const, error: "from and to must use YYYY-MM-DD." };
    if (from > to) return { ok: false as const, error: "from must be on or before to." };
    const span = Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000) + 1;
    if (span > 62) return { ok: false as const, error: "Calendar ranges cannot exceed 62 days." };
    return { ok: true as const, month: null, from, to };
  }

  const requestedMonth = month ?? currentMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)) {
    return { ok: false as const, error: "month must use YYYY-MM." };
  }
  const first = `${requestedMonth}-01`;
  const end = new Date(`${first}T00:00:00.000Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return { ok: true as const, month: requestedMonth, from: first, to: end.toISOString().slice(0, 10) };
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
