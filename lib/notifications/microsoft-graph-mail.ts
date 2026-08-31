import "server-only";

import type { MeetClientSummary } from "@/lib/assessment/assessment-summary";
import { renderMeetClientEmail } from "@/lib/notifications/meet-client-email-template";

export { renderMeetClientEmail } from "@/lib/notifications/meet-client-email-template";

const graphBaseUrl = "https://graph.microsoft.com/v1.0";

export type GraphMailReadiness = {
  configured: boolean;
  missing: string[];
  sender: string;
  allowedRecipientDomains: string[];
};

export function getGraphMailReadiness(): GraphMailReadiness {
  const values = {
    PIPELINE_GRAPH_TENANT_ID: process.env.PIPELINE_GRAPH_TENANT_ID?.trim() ?? "",
    PIPELINE_GRAPH_CLIENT_ID: process.env.PIPELINE_GRAPH_CLIENT_ID?.trim() ?? "",
    PIPELINE_GRAPH_CLIENT_SECRET: process.env.PIPELINE_GRAPH_CLIENT_SECRET?.trim() ?? "",
    PIPELINE_MEET_CLIENT_SENDER: process.env.PIPELINE_MEET_CLIENT_SENDER?.trim() ?? "",
  };
  const allowedRecipientDomains = parseAllowedDomains(
    process.env.PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS,
  );
  const missing = Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
  if (allowedRecipientDomains.length === 0) missing.push("PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS");
  return {
    configured: missing.length === 0,
    missing,
    sender: values.PIPELINE_MEET_CLIENT_SENDER,
    allowedRecipientDomains,
  };
}

export function validateMeetClientRecipients(recipients: unknown, readiness = getGraphMailReadiness()) {
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 20) {
    return { ok: false as const, message: "Add between 1 and 20 authorized recipients." };
  }
  const normalized = [...new Set(recipients.map((value) => typeof value === "string" ? value.trim().toLowerCase() : ""))];
  if (normalized.some((value) => !isEmail(value))) {
    return { ok: false as const, message: "Every recipient must be a valid email address." };
  }
  const disallowed = normalized.find((value) => !readiness.allowedRecipientDomains.includes(emailDomain(value)));
  if (disallowed) {
    return { ok: false as const, message: `Recipients must use an approved organization domain. ${emailDomain(disallowed)} is not approved.` };
  }
  return { ok: true as const, recipients: normalized };
}

export async function sendMeetClientMail(input: {
  recipients: string[];
  summary: MeetClientSummary;
  preparedBy: string;
  deliveryId: string;
}) {
  const readiness = getGraphMailReadiness();
  if (!readiness.configured) throw new Error("Microsoft 365 email is not configured.");
  const accessToken = await graphAccessToken();
  const content = renderMeetClientEmail(input.summary, input.preparedBy, input.deliveryId);
  const response = await fetch(
    `${graphBaseUrl}/users/${encodeURIComponent(readiness.sender)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: content.subject,
          body: { contentType: "HTML", content: content.html },
          toRecipients: input.recipients.map((address) => ({ emailAddress: { address } })),
          internetMessageHeaders: [{ name: "x-pipeline-delivery-id", value: input.deliveryId }],
        },
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status !== 202) {
    throw new Error(`Microsoft Graph rejected the message with status ${response.status}.`);
  }
  return { provider: "microsoft_graph" as const, acceptedAt: new Date().toISOString() };
}

async function graphAccessToken() {
  const tenantId = process.env.PIPELINE_GRAPH_TENANT_ID!.trim();
  const body = new URLSearchParams({
    client_id: process.env.PIPELINE_GRAPH_CLIENT_ID!.trim(),
    client_secret: process.env.PIPELINE_GRAPH_CLIENT_SECRET!.trim(),
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error("Microsoft Graph authentication failed.");
  const payload = await response.json() as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Microsoft Graph did not return an access token.");
  }
  return payload.access_token;
}

function parseAllowedDomains(value: string | undefined) {
  return [...new Set((value ?? "").split(",").map((domain) => domain.trim().toLowerCase()).filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)))];
}

function isEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function emailDomain(value: string) {
  return value.slice(value.lastIndexOf("@") + 1).toLowerCase();
}
