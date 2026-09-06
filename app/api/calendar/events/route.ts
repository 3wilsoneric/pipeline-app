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
    const queue = resolveQueueOptions(params);
    if (!queue.ok) return Response.json({ error: queue.error }, { status: 400 });

    const calendar = await getAssessmentCalendar(auth.user, range, queue.value);
    return Response.json({ month: range.month, ...calendar }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}

function resolveQueueOptions(params: URLSearchParams) {
  const rawLimit = params.get("queue_limit") ?? "24";
  if (!/^\d+$/.test(rawLimit)) return { ok: false as const, error: "queue_limit must be a whole number." };
  const queueLimit = Number(rawLimit);
  if (queueLimit < 1 || queueLimit > 200) return { ok: false as const, error: "queue_limit must be between 1 and 200." };
  const queueSearch = (params.get("queue_q") ?? "").trim();
  const queueCommunity = (params.get("queue_community") ?? "").trim();
  const queueOwner = (params.get("queue_owner") ?? "").trim();
  if (queueSearch.length > 100) return { ok: false as const, error: "queue_q cannot exceed 100 characters." };
  if (queueCommunity.length > 100) return { ok: false as const, error: "queue_community cannot exceed 100 characters." };
  if (queueOwner.length > 200) return { ok: false as const, error: "queue_owner cannot exceed 200 characters." };
  return {
    ok: true as const,
    value: {
      queueLimit,
      queueSearch,
      queueCommunity,
      queueOwner,
      queueMine: params.get("queue_mine") === "true",
      includeAssignments: params.get("include_assignments") !== "false",
    },
  };
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
