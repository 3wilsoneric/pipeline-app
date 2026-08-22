import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { scopeReferralListOptions } from "@/lib/pipeline/referral-access";
import { referralCalendarEvents } from "@/lib/pipeline/referral-calendar";
import { listReferrals, requireReferralStore } from "@/lib/pipeline/referral-store";
import type { Referral } from "@/lib/pipeline/referral-types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/calendar/events", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;
    const params = new URL(request.url).searchParams;
    const range = resolveRange(params.get("month"), params.get("from"), params.get("to"));
    if (!range.ok) return Response.json({ error: range.error }, { status: 400 });

    const referrals: Referral[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 500; page += 1) {
      const result = await listReferrals(scopeReferralListOptions(auth.user, {
        limit: 200,
        cursor,
        workspaceStatus: "all",
      }));
      referrals.push(...result.referrals);
      cursor = result.next_cursor;
      if (!cursor) break;
    }
    const events = referrals
      .flatMap(referralCalendarEvents)
      .filter((event) => event.date >= range.from && event.date <= range.to)
      .sort((left, right) => left.date.localeCompare(right.date) || left.clientName.localeCompare(right.clientName));
    return Response.json({ month: range.month, from: range.from, to: range.to, events, generated_at: new Date().toISOString() }, {
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
