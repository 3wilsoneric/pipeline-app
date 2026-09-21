"use client";
import { getActiveAccount, initializeMsal, isEntraClientConfigured, msalInstance } from "./entra-client";

const scopes = ["https://graph.microsoft.com/Mail.ReadWrite", "https://graph.microsoft.com/User.Read"];
export async function acquireOutlookToken(interactive = false): Promise<string | null> {
  if (!isEntraClientConfigured) {
    if (interactive) throw new Error("Microsoft work-account sign-in must be configured for Pipeline before connecting Outlook.");
    return null;
  }
  await initializeMsal();
  const account = getActiveAccount();
  try {
    if (interactive) {
      const result = await msalInstance.acquireTokenPopup({ scopes, ...(account ? { account, loginHint: account.username } : {}), prompt: "select_account" });
      return result.accessToken;
    }
    if (!account) return null;
    return (await msalInstance.acquireTokenSilent({ scopes, account })).accessToken;
  } catch (error) {
    if (!interactive) return null;
    throw outlookConnectionError(error);
  }
}

function outlookConnectionError(error: unknown) {
    const code = typeof error === "object" && error && "errorCode" in error ? String(error.errorCode) : "";
    if (code === "user_cancelled") return new Error("Connection cancelled. Your email and files are still saved in Pipeline.");
    if (code === "popup_window_error" || code === "empty_window_error") return new Error("Allow pop-ups for Pipeline, then choose Connect Outlook again.");
    return new Error("Outlook could not connect. Use your Pipeline work account and check the connection setup below.");
}
