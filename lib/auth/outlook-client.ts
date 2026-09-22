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
      cache: { cacheLocation: BrowserCacheLocation.SessionStorage },
    });
    outlookClient = { id: clientId, ready: client.initialize().then(() => client) };
  }
  return outlookClient.ready;
}

export async function acquireOutlookToken(clientId: string | undefined, interactive = false): Promise<string | null> {
  if (!clientId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    if (interactive) throw new Error("Outlook connection is not set up yet. Your handoff is saved in Pipeline.");
    return null;
  }
  const client = await clientFor(clientId);
  const account = client.getActiveAccount();
  try {
    if (interactive) {
      const result = await client.acquireTokenPopup({ scopes, prompt: "select_account" });
      client.setActiveAccount(result.account);
      return result.accessToken;
    }
    if (!account) return null;
    return (await client.acquireTokenSilent({ scopes, account })).accessToken;
  } catch (error) {
    if (!interactive) return null;
    throw outlookConnectionError(error);
  }
}

function outlookConnectionError(error: unknown) {
    const code = typeof error === "object" && error && "errorCode" in error ? String(error.errorCode) : "";
    if (code === "user_cancelled") return new Error("Connection cancelled. Your email and files are still saved in Pipeline.");
    if (code === "popup_window_error" || code === "empty_window_error") return new Error("Allow pop-ups for Pipeline, then choose Connect Outlook again.");
    return new Error("Outlook could not connect. Choose the mailbox matching your Pipeline email. Your organization may require approval for the connection.");
}
