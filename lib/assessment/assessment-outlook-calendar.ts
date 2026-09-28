import "server-only";

import { randomUUID } from "node:crypto";
import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import { graphAccessToken } from "@/lib/notifications/microsoft-graph-mail";

type Claim = {
  assessment_id: string;
  desired_version: number | string;
  transaction_id: string;
  event_id: string | null;
  last_error_code: string | null;
};
type Appointment = {
  referral_id: number | string;
  scheduled_start_at: Date | string | null;
  scheduled_duration_minutes: number | string | null;
  scheduled_location: string | null;
  schedule_status: string;
  assessor_id: string | null;
  assessor_email: string | null;
  workspace_status: string | null;
  deleted_at: Date | string | null;
};
type GraphEvent = {
  id?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  location?: { displayName?: string };
  attendees?: { emailAddress?: { address?: string } }[];
};
type SyncOutcome = { eventId: string | null; retryCode?: string };

const graph = "https://graph.microsoft.com/v1.0";

export function assessmentOutlookEnabled() {
  return process.env.PIPELINE_ASSESSMENT_OUTLOOK_ENABLED === "true"
    && process.env.PIPELINE_DEMO_MODE !== "true"
    && process.env.PIPELINE_PERSONA_DEMO !== "true"
    && Boolean(process.env.PIPELINE_GRAPH_TENANT_ID?.trim()
      && process.env.PIPELINE_GRAPH_CLIENT_ID?.trim()
      && process.env.PIPELINE_GRAPH_CLIENT_SECRET?.trim()
      && process.env.PIPELINE_MEET_CLIENT_SENDER?.trim());
}

/** A bounded worker: scheduling is saved first and never waits on Outlook. */
export async function reconcileAssessmentOutlookCalendar(limit = 3) {
  if (!assessmentOutlookEnabled() || !getPipelineDatabaseReadiness().ready) return { enabled: false, processed: 0, pending: 0, errors: 0 };
  const sql = getPipelineSql();
  const leaseId = randomUUID();
  const rows = await sql<Claim[]>`
    with due as (
      select assessment_id from pipeline.assessment_outlook_calendar
      where (status = 'pending' and next_attempt_at <= now())
        or (status = 'processing' and lease_until < now())
      order by next_attempt_at, assessment_id
      for update skip locked
      limit ${Math.max(1, Math.min(limit, 10))}
    )
    update pipeline.assessment_outlook_calendar item
    set status = 'processing', lease_id = ${leaseId}::uuid,
      lease_until = now() + interval '2 minutes', updated_at = now()
    from due where item.assessment_id = due.assessment_id
    returning item.assessment_id, item.desired_version, item.transaction_id, item.event_id, item.last_error_code
  `;
  // Each Graph operation is bounded, but processing three rows serially could
  // outlast the 55-second Azure job request. Claims are independent.
  await Promise.all(rows.map(async row => {
    try {
      const appointment = await loadAppointment(row.assessment_id);
      const outcome = await synchronizeEvent(row, appointment);
      await sql`
        update pipeline.assessment_outlook_calendar
        set event_id = ${outcome.eventId}, recipient_email = ${validAssessorEmail(appointment?.assessor_email)},
          transaction_id = case when ${row.event_id}::text is not null and ${outcome.eventId}::text is null
            then gen_random_uuid() else transaction_id end,
          processed_version = ${row.desired_version},
          status = case when desired_version = ${row.desired_version} and ${outcome.retryCode ?? null}::text is null then 'synced' else 'pending' end,
          next_attempt_at = case when ${outcome.retryCode ?? null}::text is null then now() else now() + interval '5 minutes' end,
          lease_id = null, lease_until = null,
          last_error_code = ${outcome.retryCode ?? null}, synced_at = now(), updated_at = now()
        where assessment_id = ${row.assessment_id} and lease_id = ${leaseId}::uuid
      `;
    } catch (error) {
      const code = error instanceof GraphCalendarError ? error.code : "provider_unconfirmed";
      // Graph's transactionId makes a lost create response safe to retry.
      await sql`
        update pipeline.assessment_outlook_calendar
        set status = 'pending', lease_id = null, lease_until = null,
          next_attempt_at = now() + interval '5 minutes', last_error_code = ${code}, updated_at = now()
        where assessment_id = ${row.assessment_id} and lease_id = ${leaseId}::uuid
      `;
    }
  }));
  const count = await sql<{ pending: number | string; errors: number | string }[]>`
    select count(*) filter (where status <> 'synced')::integer as pending,
      count(*) filter (where last_error_code is not null)::integer as errors
    from pipeline.assessment_outlook_calendar
  `;
  return { enabled: true, processed: rows.length, pending: Number(count[0]?.pending ?? 0), errors: Number(count[0]?.errors ?? 0) };
}

async function loadAppointment(assessmentId: string): Promise<Appointment | null> {
  const sql = getPipelineSql();
  const rows = await sql<Appointment[]>`
    select a.referral_id, a.scheduled_start_at, a.scheduled_duration_minutes,
      a.scheduled_location, a.schedule_status, a.assessor_id,
      m.email as assessor_email, r.workspace_status, r.deleted_at
    from pipeline.assessments a
    join pipeline.referrals r on r.referral_id = a.referral_id
    left join pipeline.workspace_members m on m.principal_id = a.assessor_id and m.active
    where a.assessment_id = ${assessmentId}
    limit 1
  `;
  return rows[0] ?? null;
}

async function synchronizeEvent(row: Claim, appointment: Appointment | null): Promise<SyncOutcome> {
  const email = validAssessorEmail(appointment?.assessor_email);
  const active = appointment && !appointment.deleted_at && appointment.workspace_status === "active"
    && ["scheduled", "rescheduled"].includes(appointment.schedule_status)
    && appointment.scheduled_start_at && appointment.scheduled_duration_minutes;
  if (!active || !email || !appointment?.scheduled_start_at || appointment.scheduled_duration_minutes === null) {
    if (row.event_id) {
      await graphRequest(await graphAccessToken(), `/users/${sender()}/events/${encodeURIComponent(row.event_id)}`, { method: "DELETE" }, [204, 404]);
    }
    // A create request may have reached Graph even if its response was lost.
    // Keep that cancellation visible for reconciliation instead of claiming
    // success while an organizer meeting may still exist.
    const uncertainCreate = !row.event_id && ["provider_unconfirmed", "event_id_missing", "uncertain_create_requires_reconciliation"].includes(row.last_error_code ?? "");
    return { eventId: null, ...(uncertainCreate ? { retryCode: "uncertain_create_requires_reconciliation" }
      : active && !email ? { retryCode: "assessor_email_missing" } : {}) };
  }
  const start = new Date(appointment.scheduled_start_at).getTime();
  const duration = Number(appointment.scheduled_duration_minutes);
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) throw new GraphCalendarError("invalid_schedule");
  const end = start + duration * 60_000;
  const location = appointment.scheduled_location?.trim().slice(0, 255) ?? "";
  const desired = {
    subject: "Pipeline assessment",
    body: { contentType: "HTML", content: `<p>Open this assessment in <a href="${workspaceUrl(appointment.referral_id)}">Pipeline</a>. Sign in to view client details.</p>` },
    start: graphTime(start), end: graphTime(end),
    location: { displayName: location },
    attendees: [{ emailAddress: { address: email }, type: "required" }],
    sensitivity: "private", showAs: "busy", responseRequested: false,
  };
  const path = `/users/${sender()}/events`;
  const token = await graphAccessToken();
  if (!row.event_id) {
    const event = await graphRequest<GraphEvent>(token, path, {
      method: "POST", body: JSON.stringify({ ...desired, transactionId: row.transaction_id }),
    }, [201]);
    if (!event?.id) throw new GraphCalendarError("event_id_missing");
    return { eventId: event.id };
  }
  const eventPath = `${path}/${encodeURIComponent(row.event_id)}`;
  const existing = await graphRequest<GraphEvent>(token, `${eventPath}?$select=id,start,end,location,attendees`, {}, [200]);
  if (!existing) throw new GraphCalendarError("event_missing");
  if (!eventMatches(existing, start, end, email, location)) {
    await graphRequest(token, eventPath, { method: "PATCH", body: JSON.stringify(desired) }, [200, 204]);
  }
  return { eventId: row.event_id };
}

function eventMatches(event: GraphEvent, start: number, end: number, email: string, location: string) {
  return graphDate(event.start?.dateTime) === start
    && graphDate(event.end?.dateTime) === end
    && (event.location?.displayName ?? "") === location
    && event.attendees?.length === 1
    && event.attendees[0]?.emailAddress?.address?.trim().toLowerCase() === email;
}

function graphDate(value: string | undefined) {
  if (!value) return NaN;
  return Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
}

function graphTime(value: number) {
  return { dateTime: new Date(value).toISOString().replace(/Z$/, ""), timeZone: "UTC" };
}

function validAssessorEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase() ?? "";
  return email.length <= 254 && !email.includes("#ext#") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function sender() { return encodeURIComponent(process.env.PIPELINE_MEET_CLIENT_SENDER!.trim()); }

function workspaceUrl(referralId: number | string) {
  const origin = process.env.PIPELINE_CANONICAL_ORIGIN?.trim() ?? "";
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password) throw new GraphCalendarError("origin_invalid");
  url.search = new URLSearchParams({ view: "referrals", screen: "packet", referralId: String(referralId) }).toString();
  return url.toString().replace(/&/g, "&amp;");
}

class GraphCalendarError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function graphRequest<T>(token: string, path: string, init: RequestInit, allowed: number[]): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(`${graph}${path}`, {
      ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: 'IdType="ImmutableId"' },
    });
  } catch { throw new GraphCalendarError("provider_unconfirmed"); }
  if (!allowed.includes(response.status)) throw new GraphCalendarError(`graph_${response.status}`);
  if (response.status === 204 || response.status === 404) return null;
  try { return await response.json() as T; }
  catch { throw new GraphCalendarError("provider_response_invalid"); }
}
