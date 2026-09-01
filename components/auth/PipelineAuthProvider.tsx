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
import { REAUTHENTICATION_KEY } from "@/lib/auth/authenticated-fetch";
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
        await initializeMsal();
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

        const serverSession = await probePipelineServerSession();
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

    const renew = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const activeAccount = selectActiveAccount(getActiveAccount());
        if (activeAccount) {
          const session = await establishPipelineServerSession(activeAccount);
          if (!cancelled && session?.response.ok) setAccount(activeAccount);
          return;
        }

        const serverSession = await probePipelineServerSession();
        if (!cancelled && serverSession.user) {
          const restoredAccount = await restorePipelineAccountSilently(serverSession.user);
          if (!cancelled && restoredAccount) setAccount(restoredAccount);
        }
      } catch {
        // A transient renewal failure must not discard a still-valid cookie.
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void renew();
    };
    const interval = window.setInterval(() => void renew(), 10 * 60 * 1_000);
    window.addEventListener("focus", renew);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", renew);
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
