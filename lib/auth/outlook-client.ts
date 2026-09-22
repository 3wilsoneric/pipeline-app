"use client";
import { BrowserCacheLocation, PublicClientApplication } from "@azure/msal-browser";
import { toPipelinePath } from "@/lib/pipeline/base-path";

const scopes = ["https://graph.microsoft.com/Mail.ReadWrite", "https://graph.microsoft.com/User.Read"];
let outlookClient: { id: string; ready: Promise<PublicClientApplication> } | undefined;

// A separate public client connects the user's home mailbox, including a
// personal Outlook account. Pipeline's own tenant and sign-in stay unchanged.
function clientFor(clientId: string) {
  if (outlookClient?.id !== clientId) {
    const client = new PublicClientApplication({
      auth: { clientId, authority: "https://login.microsoftonline.com/common",
        redirectUri: `${window.location.origin}${toPipelinePath("/outlook-auth.html")}` },
      cache: { cacheLocation: BrowserCacheLocation.LocalStorage },
    });
    outlookClient = { id: clientId, ready: client.initialize().then(() => client) };
  }
  return outlookClient.ready;
}

export async function acquireOutlookToken(clientId: string | undefined, interactive = false, accountEmail?: string): Promise<string | null> {
  if (!clientId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    if (interactive) throw new Error("Outlook connection is not set up yet. Your handoff is saved in Pipeline.");
    return null;
  }
  const client = await clientFor(clientId);
  if (!interactive && connectionDisconnected(clientId, accountEmail)) return null;
  try {
    if (interactive) {
      const result = await client.acquireTokenPopup({ scopes, prompt: "select_account", loginHint: accountEmail });
      client.setActiveAccount(result.account);
      setConnectionDisconnected(clientId, accountEmail, false);
      return result.accessToken;
    }
    return await restoreOutlookToken(client, accountEmail);
  } catch (error) {
    if (!interactive) return null;
    throw outlookConnectionError(error);
  }
}

async function restoreOutlookToken(client: PublicClientApplication, accountEmail?: string) {
  const account = accountEmail ? client.getAccountByUsername(accountEmail) : client.getActiveAccount();
  if (account) return (await client.acquireTokenSilent({ scopes, account })).accessToken;
  if (!accountEmail) return null;
  const result = await client.ssoSilent({ scopes, loginHint: accountEmail });
  client.setActiveAccount(result.account);
  return result.accessToken;
}

export async function clearOutlookConnection(clientId?: string, accountEmail?: string) {
  if (clientId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) await clientFor(clientId);
  if (!outlookClient) return;
  const client = await outlookClient.ready;
  setConnectionDisconnected(outlookClient.id, accountEmail, true);
  await client.clearCache();
  client.setActiveAccount(null);
}

function connectionDisconnected(clientId: string, email?: string) {
  try { return window.localStorage.getItem(`pipeline.outlook.disconnected:${clientId}:${email?.toLowerCase()}`) === "true"; }
  catch { return false; }
}

function setConnectionDisconnected(clientId: string, email: string | undefined, disconnected: boolean) {
  if (!email) return;
  const key = `pipeline.outlook.disconnected:${clientId}:${email.toLowerCase()}`;
  try { if (disconnected) window.localStorage.setItem(key, "true"); else window.localStorage.removeItem(key); }
  catch { /* Microsoft and server-side identity checks still govern access. */ }
}

function outlookConnectionError(error: unknown) {
    const code = typeof error === "object" && error && "errorCode" in error ? String(error.errorCode) : "";
    if (code === "user_cancelled") return new Error("Connection cancelled. Your email and files are still saved in Pipeline.");
    if (code === "popup_window_error" || code === "empty_window_error") return new Error("Allow pop-ups for Pipeline, then choose Connect Outlook again.");
    return new Error("Outlook could not connect. Choose the mailbox matching your Pipeline email. Your organization may require approval for the connection.");
}
