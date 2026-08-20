"use client";

import {
  BrowserCacheLocation,
  LogLevel,
  PublicClientApplication,
  type AccountInfo,
  type Configuration,
  type RedirectRequest,
} from "@azure/msal-browser";
import { toPipelinePath } from "@/lib/pipeline/base-path";

const tenantId = process.env.NEXT_PUBLIC_ENTRA_TENANT_ID?.trim() ?? "";
const clientId = process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID?.trim() ?? "";
const configuredScope = process.env.NEXT_PUBLIC_PIPELINE_API_SCOPE?.trim() ?? "";

export const pipelineAuthRequired = process.env.NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED === "true";
export const pipelineApiScope = configuredScope || (clientId ? `api://${clientId}/access_as_user` : "");
export const isEntraClientConfigured = Boolean(tenantId && clientId && pipelineApiScope);

function getOrigin() {
  return typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;
}

const msalConfig: Configuration = {
  auth: {
    clientId: clientId || "00000000-0000-0000-0000-000000000000",
    authority: `https://login.microsoftonline.com/${tenantId || "common"}`,
    redirectUri: `${getOrigin()}${toPipelinePath("/sign-in")}`,
    postLogoutRedirectUri: `${getOrigin()}${toPipelinePath("/sign-in")}`,
    navigateToLoginRequestUrl: false,
  },
  cache: {
    // MSAL v4 encrypts localStorage auth artifacts and shares them across tabs.
    // Temporary redirect state remains in its safer default storage.
    cacheLocation: BrowserCacheLocation.LocalStorage,
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (_level, message, containsPii) => {
        if (!containsPii && process.env.NODE_ENV === "development") {
          console.debug(`[msal] ${message}`);
        }
      },
      piiLoggingEnabled: false,
      logLevel: LogLevel.Warning,
    },
  },
};

// This module is imported once by the root provider. Keeping the instance at
// module scope prevents duplicate redirect handlers and cache partitions.
export const msalInstance = new PublicClientApplication(msalConfig);

export const loginRequest: RedirectRequest = {
  scopes: ["openid", "profile", "email", ...(pipelineApiScope ? [pipelineApiScope] : [])],
  // Pipeline users can have multiple Microsoft sessions and external aliases.
  // Always make the chosen identity explicit instead of silently reusing one.
  prompt: "select_account",
};

let initializePromise: Promise<void> | null = null;

export function initializeMsal() {
  initializePromise ??= msalInstance.initialize().then(() => {
    msalInstance.enableAccountStorageEvents();
  });
  return initializePromise;
}

export function getActiveAccount() {
  return msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0] ?? null;
}

export function selectActiveAccount(account?: AccountInfo | null) {
  if (account) {
    msalInstance.setActiveAccount(account);
    return account;
  }

  const active = getActiveAccount();
  if (active) msalInstance.setActiveAccount(active);
  return active;
}

export function getAccountDisplayName(account?: AccountInfo | null) {
  const directName = account?.name?.trim();
  if (directName) return directName;

  const givenName = String(account?.idTokenClaims?.given_name ?? "").trim();
  const familyName = String(account?.idTokenClaims?.family_name ?? "").trim();
  const combined = [givenName, familyName].filter(Boolean).join(" ");
  if (combined) return combined;

  return account?.username?.trim() || "User";
}

export function getAccountInitials(account?: AccountInfo | null) {
  const parts = getAccountDisplayName(account).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function sanitizeMicrosoftError(error: unknown) {
  const code = error && typeof error === "object" && "errorCode" in error
    ? String(error.errorCode ?? "").trim()
    : "";

  if (code === "user_cancelled" || code === "access_denied") {
    return "Microsoft sign-in was canceled.";
  }
  if (code === "interaction_in_progress") {
    return "Microsoft sign-in is already in progress.";
  }
  if (code === "login_required" || code === "consent_required") {
    return "Microsoft sign-in needs to be completed again.";
  }

  return "Microsoft sign-in could not be completed. Check your account access and try again.";
}
