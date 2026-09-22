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
  try {
    if (interactive) {
      const result = await client.acquireTokenPopup({ scopes, prompt: "select_account", loginHint: accountEmail });
      client.setActiveAccount(result.account);
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

function outlookConnectionError(error: unknown) {
    const code = typeof error === "object" && error && "errorCode" in error ? String(error.errorCode) : "";
    if (code === "user_cancelled") return new Error("Connection cancelled. Your email and files are still saved in Pipeline.");
    if (code === "popup_window_error" || code === "empty_window_error") return new Error("Allow pop-ups for Pipeline, then choose Connect Outlook again.");
    return new Error("Outlook could not connect. Choose the mailbox matching your Pipeline email. Your organization may require approval for the connection.");
}
