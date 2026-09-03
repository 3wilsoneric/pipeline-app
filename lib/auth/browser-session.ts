"use client";

import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type AuthenticationResult,
} from "@azure/msal-browser";

import {
  getActiveAccount,
  initializeMsal,
  msalInstance,
  pipelineApiScope,
  selectActiveAccount,
} from "@/lib/auth/entra-client";
import { toPipelinePath } from "@/lib/pipeline/base-path";

export type PipelineSessionUser = {
  id?: string;
  email: string;
  name: string;
  roles: string[];
};

export type PipelineSessionProbe = {
  response: Response;
  user: PipelineSessionUser | null;
};

type EstablishedSession = {
  accessToken: string;
  response: Response;
};

let tokenRequest: Promise<AuthenticationResult | null> | null = null;
let sessionRequest: Promise<EstablishedSession | null> | null = null;
let sessionProbeRequest: Promise<PipelineSessionProbe> | null = null;
let sessionProbeCache: { probe: PipelineSessionProbe; expiresAt: number } | null = null;
let sessionProbeGeneration = 0;

const sessionProbeCacheMs = 60_000;

export async function establishPipelineServerSession(
  account: AccountInfo,
  forceRefresh = false,
): Promise<EstablishedSession | null> {
  selectActiveAccount(account);
  if (!sessionRequest) {
    sessionRequest = acquireActiveAccountToken(forceRefresh)
      .then(async (result) => {
        if (!result) return null;
        const response = await fetch(toPipelinePath("/api/auth/session"), {
          method: "POST",
          headers: { Authorization: `Bearer ${result.accessToken}` },
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.ok) clearPipelineBrowserSessionCache();
        return { accessToken: result.accessToken, response };
      })
      .finally(() => {
        sessionRequest = null;
      });
  }
  return sessionRequest;
}

export async function renewActivePipelineSession(forceRefresh = false) {
  await initializeMsal();
  const account = getActiveAccount();
  if (!account) return null;
  const result = await establishPipelineServerSession(account, forceRefresh);
  return result?.response.ok ? result.accessToken : null;
}

export async function probePipelineServerSession(forceRefresh = false): Promise<PipelineSessionProbe> {
  if (!forceRefresh && sessionProbeCache?.expiresAt && sessionProbeCache.expiresAt > Date.now()) {
    return sessionProbeCache.probe;
  }
  if (!sessionProbeRequest) {
    const generation = sessionProbeGeneration;
    const request = fetch(toPipelinePath("/api/auth/me"), {
      credentials: "same-origin",
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) return { response, user: null };
      const payload = await response.json().catch(() => null) as { user?: PipelineSessionUser } | null;
      const probe = { response, user: payload?.user ?? null };
      if (probe.user && generation === sessionProbeGeneration) {
        sessionProbeCache = { probe, expiresAt: Date.now() + sessionProbeCacheMs };
      }
      return probe;
    }).finally(() => {
      if (sessionProbeRequest === request) sessionProbeRequest = null;
    });
    sessionProbeRequest = request;
  }
  return sessionProbeRequest;
}

export function clearPipelineBrowserSessionCache() {
  sessionProbeGeneration += 1;
  sessionProbeCache = null;
  sessionProbeRequest = null;
}

export async function restorePipelineAccountSilently(user: PipelineSessionUser) {
  await initializeMsal();
  const existing = getActiveAccount();
  if (existing) return existing;
  if (!pipelineApiScope || !user.email.trim()) return null;

  try {
    const result = await msalInstance.ssoSilent({
      scopes: [pipelineApiScope],
      loginHint: user.email,
    });
    const account = selectActiveAccount(result.account);
    return account ?? null;
  } catch {
    // The existing HttpOnly Pipeline session remains usable. Silent SSO can be
    // blocked by browser privacy settings and should never sign the user out.
    return null;
  }
}

async function acquireActiveAccountToken(forceRefresh: boolean) {
  await initializeMsal();
  const account = getActiveAccount();
  if (!account || !pipelineApiScope) return null;

  if (!tokenRequest) {
    tokenRequest = msalInstance.acquireTokenSilent({
      account,
      scopes: [pipelineApiScope],
      forceRefresh,
    }).catch((error) => {
      if (error instanceof InteractionRequiredAuthError) return null;
      return null;
    }).finally(() => {
      tokenRequest = null;
    });
  }
  return tokenRequest;
}
