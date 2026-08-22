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
    const month = new URL(request.url).searchParams.get("month") ?? currentMonth();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return Response.json({ error: "month must use YYYY-MM." }, { status: 400 });
    }

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
      .filter((event) => event.date.startsWith(`${month}-`))
      .sort((left, right) => left.date.localeCompare(right.date) || left.clientName.localeCompare(right.clientName));
    return Response.json({ month, events, generated_at: new Date().toISOString() }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
