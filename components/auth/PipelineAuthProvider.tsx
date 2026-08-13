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
  pipelineApiScope,
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
  const { instance } = useMsal();
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
        if (!activeAccount) {
          if (!cancelled) setStatus("signed_out");
          return;
        }

        const tokenResult = await instance.acquireTokenSilent({ account: activeAccount, scopes: [pipelineApiScope] });
        const sessionResponse = await fetch("/api/auth/session", {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenResult.accessToken}` },
          credentials: "same-origin",
        });
        if (!sessionResponse.ok) {
          if (!cancelled) {
            setStatus("error");
            setError(await readSessionFailure(sessionResponse));
          }
          return;
        }

        if (!cancelled) {
          window.sessionStorage.removeItem(REAUTHENTICATION_KEY);
          setAccount(activeAccount);
          setStatus("signed_in");
          setError(null);
        }
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

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [instance]);

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
      await fetch("/api/auth/session", { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
      await instance.logoutRedirect({ postLogoutRedirectUri: `${window.location.origin}/sign-in` });
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

  if (reason === "Forbidden") return "This Microsoft identity is not assigned to Pipeline.";
  if (reason === "Insufficient role") return "This Microsoft identity is missing a Pipeline role.";
  if (reason.includes("permission to use Pipeline")) return "Microsoft sign-in did not grant Pipeline access. Try signing in again.";
  if (reason.includes("usable Pipeline identity")) return "Microsoft did not return a usable Pipeline identity.";
  if (response.status === 401) return "Your Microsoft session expired. Sign in again.";
  return "Pipeline could not establish your sign-in session.";
}

export function usePipelineAuth() {
  return useContext(PipelineAuthContext);
}
