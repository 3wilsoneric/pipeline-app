"use client";

import {
  InteractionRequiredAuthError,
  type AccountInfo,
} from "@azure/msal-browser";
import { MsalProvider, useMsal } from "@azure/msal-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import AuthenticationProgress from "@/components/auth/AuthenticationProgress";
import {
  getActiveAccount,
  initializeMsal,
  isEntraClientConfigured,
  loginRequest,
  msalInstance,
  pipelineAuthRequired,
  sanitizeMicrosoftError,
  selectActiveAccount,
} from "@/lib/auth/entra-client";
import {
  clearPostLoginPath,
  normalizePostLoginPath,
  savePostLoginPath,
} from "@/lib/auth/post-login-path";
import {
  clearPipelineClientSessionCache,
  REAUTHENTICATION_KEY,
} from "@/lib/auth/authenticated-fetch";
import {
  establishPipelineServerSession,
  probePipelineServerSession,
  restorePipelineAccountSilently,
} from "@/lib/auth/browser-session";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import { isPipelineDesktopEnabled } from "@/lib/desktop/desktop-config";
import {
  clearPipelineOfflineData,
  initializeOfflineAssessmentStore,
} from "@/lib/offline/offline-assessment-store";

type AuthStatus = "disabled" | "initializing" | "signed_out" | "redirecting" | "signed_in" | "error";

type PipelineAuthContextValue = {
  required: boolean;
  configured: boolean;
  status: AuthStatus;
  account: AccountInfo | null;
  error: string | null;
  signIn: (nextPath?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const disabledContext: PipelineAuthContextValue = {
  required: false,
  configured: false,
  status: "disabled",
  account: null,
  error: null,
  signIn: async () => undefined,
  signOut: async () => undefined,
};

const PipelineAuthContext = createContext<PipelineAuthContextValue>(disabledContext);

export default function PipelineAuthProvider({ children }: { children: React.ReactNode }) {
  if (!pipelineAuthRequired) {
    return <PipelineAuthContext.Provider value={disabledContext}>{children}</PipelineAuthContext.Provider>;
  }

  if (!isEntraClientConfigured) {
    const unavailableContext: PipelineAuthContextValue = {
      ...disabledContext,
      required: true,
      status: "error",
      error: "Microsoft sign-in is not configured for this deployment.",
    };
    return <PipelineAuthContext.Provider value={unavailableContext}>{children}</PipelineAuthContext.Provider>;
  }

  return (
    <MsalProvider instance={msalInstance}>
      <PipelineAuthBootstrap>{children}</PipelineAuthBootstrap>
    </MsalProvider>
  );
}

function PipelineAuthBootstrap({ children }: { children: React.ReactNode }) {
  const { accounts, instance } = useMsal();
  const [status, setStatus] = useState<AuthStatus>("initializing");
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setStatus("initializing");
      try {
        const msalReady = initializeMsal();
        const serverSessionRequest = probePipelineServerSession();

        if (!hasMicrosoftRedirectResponse()) {
          const serverSession = await serverSessionRequest;
          if (serverSession.user) {
            if (!cancelled) markSignedIn(null);
            void hydrateMicrosoftAccount(serverSession.user, msalReady);
            return;
          }
          if (!cancelled && serverSession.response.status === 403) {
            setStatus("error");
            setError(await readSessionFailure(serverSession.response));
            return;
          }
        }

        await msalReady;
        const redirectResult = await instance.handleRedirectPromise();
        const activeAccount = selectActiveAccount(redirectResult?.account ?? getActiveAccount());

        if (activeAccount) {
          const session = await establishPipelineServerSession(activeAccount);
          if (session?.response.ok) {
            if (!cancelled) markSignedIn(activeAccount);
            return;
          }
          if (session?.response.status === 403) {
            if (!cancelled) {
              setStatus("error");
              setError(await readSessionFailure(session.response));
            }
            return;
          }
          // An explicit redirect selected this identity. Never fall through to
          // a cookie that may belong to a previously selected account.
          if (redirectResult?.account && session?.response) {
            if (!cancelled) {
              setStatus("error");
              setError(await readSessionFailure(session.response));
            }
            return;
          }
        }

        const serverSession = await serverSessionRequest;
        if (serverSession.user) {
          if (!cancelled) markSignedIn(activeAccount);
          if (!activeAccount) {
            void restorePipelineAccountSilently(serverSession.user).then((restoredAccount) => {
              if (!cancelled && restoredAccount) setAccount(restoredAccount);
            });
          }
          return;
        }

        if (!cancelled && serverSession.response.status === 403) {
          setStatus("error");
          setError(await readSessionFailure(serverSession.response));
          return;
        }
        if (!cancelled) setStatus("signed_out");
      } catch (bootstrapError) {
        if (cancelled) return;
        if (bootstrapError instanceof InteractionRequiredAuthError) {
          setStatus("signed_out");
          setError(null);
        } else {
          setStatus("error");
          setError(sanitizeMicrosoftError(bootstrapError));
        }
      }
    }

    function markSignedIn(activeAccount: AccountInfo | null) {
      window.sessionStorage.removeItem(REAUTHENTICATION_KEY);
      setAccount(activeAccount);
      setStatus("signed_in");
      setError(null);
    }

    async function hydrateMicrosoftAccount(
      serverUser: Parameters<typeof restorePipelineAccountSilently>[0],
      msalReady: Promise<void>,
    ) {
      try {
        await msalReady;
        await instance.handleRedirectPromise();
        const activeAccount = selectActiveAccount(getActiveAccount())
          ?? await restorePipelineAccountSilently(serverUser);
        if (!cancelled && activeAccount) setAccount(activeAccount);
      } catch {
        // The valid HttpOnly Pipeline session remains authoritative. Browser
        // privacy settings may prevent MSAL account hydration in the background.
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [instance]);

  useEffect(() => {
    if (status !== "signed_out" || accounts.length === 0) return;
    let cancelled = false;
    const activeAccount = selectActiveAccount(accounts[0]);
    if (!activeAccount) return;

    void establishPipelineServerSession(activeAccount)
      .then(async (session) => {
        if (cancelled || !session) return;
        if (session.response.ok) {
          window.sessionStorage.removeItem(REAUTHENTICATION_KEY);
          setAccount(activeAccount);
          setStatus("signed_in");
          setError(null);
        } else if (session.response.status === 403) {
          setStatus("error");
          setError(await readSessionFailure(session.response));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accounts, status]);

  useEffect(() => {
    if (status !== "signed_in") return;
    let cancelled = false;

    const renew = async (forceProbe = false) => {
      if (document.visibilityState === "hidden") return;
      try {
        const serverSession = await probePipelineServerSession(forceProbe);
        if (serverSession.user) return;

        const activeAccount = selectActiveAccount(getActiveAccount());
        if (activeAccount) {
          const session = await establishPipelineServerSession(activeAccount);
          if (!cancelled && session?.response.ok) setAccount(activeAccount);
        }
      } catch {
        // A transient renewal failure must not discard a still-valid cookie.
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void renew();
    };
    const interval = window.setInterval(() => void renew(true), 10 * 60 * 1_000);
    const refreshOnFocus = () => void renew();
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [status]);

  useEffect(() => {
    if (status !== "signed_in" || !account || !isPipelineDesktopEnabled()) return;
    const principal = String(account.idTokenClaims?.oid ?? account.localAccountId ?? "").trim();
    if (!principal) return;
    void initializeOfflineAssessmentStore(principal).catch(() => undefined);
  }, [account, status]);

  const contextValue = useMemo<PipelineAuthContextValue>(() => ({
    required: true,
    configured: true,
    status,
    account,
    error,
    signIn: async (nextPath = "/") => {
      const safePath = normalizePostLoginPath(nextPath);
      clearPipelineClientSessionCache();
      savePostLoginPath(safePath);
      setError(null);
      setStatus("redirecting");
      try {
        await instance.loginRedirect({ ...loginRequest, redirectStartPage: `${window.location.origin}${safePath}` });
      } catch (loginError) {
        setStatus("signed_out");
        setError(sanitizeMicrosoftError(loginError));
      }
    },
    signOut: async () => {
      clearPostLoginPath();
      clearPipelineClientSessionCache();
      await clearPipelineOfflineData().catch(() => undefined);
      await fetch(toPipelinePath("/api/auth/session"), { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
      await instance.logoutRedirect({ postLogoutRedirectUri: `${window.location.origin}${toPipelinePath("/sign-in")}` });
    },
  }), [account, error, instance, status]);

  return (
    <PipelineAuthContext.Provider value={contextValue}>
      {status === "initializing" ? <AuthenticationProgress /> : children}
    </PipelineAuthContext.Provider>
  );
}

function hasMicrosoftRedirectResponse() {
  if (typeof window === "undefined") return false;
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return [query, hash].some((params) => (
    params.has("state")
    && (params.has("code") || params.has("error") || params.has("error_description"))
  ));
}

async function readSessionFailure(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  const reason = typeof payload?.error === "string" ? payload.error : "";

  if (reason === "Forbidden" || reason === "Identity not assigned") return "This Microsoft identity is not assigned to Pipeline.";
  if (reason === "Insufficient role") return "This Microsoft identity is missing a Pipeline role.";
  if (reason.includes("permission to use Pipeline")) return "Microsoft sign-in did not grant Pipeline access. Try signing in again.";
  if (reason.includes("usable Pipeline identity")) return "Microsoft did not return a usable Pipeline identity.";
  if (reason.includes("Pipeline application origin")) return "Pipeline could not validate this site address. Reload the page and try again.";
  if (response.status === 401) return "Your Microsoft session expired. Sign in again.";
  return "Pipeline could not establish your sign-in session.";
}

export function usePipelineAuth() {
  return useContext(PipelineAuthContext);
}
