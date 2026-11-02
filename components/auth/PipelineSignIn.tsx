"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole } from "lucide-react";

import { MicrosoftMark } from "@/components/auth/AuthenticationBrand";
import AuthenticationProgress from "@/components/auth/AuthenticationProgress";
import AuthenticationShell from "@/components/auth/AuthenticationShell";
import { usePipelineAuth } from "@/components/auth/PipelineAuthProvider";
import { clearPostLoginPath, normalizePostLoginPath, readPostLoginPath } from "@/lib/auth/post-login-path";
import { toPipelinePath } from "@/lib/pipeline/base-path";

export default function PipelineSignIn({ nextPath }: { nextPath: string }) {
  const auth = usePipelineAuth();
  const router = useRouter();
  const safeNextPath = toPipelinePath(
    normalizePostLoginPath(nextPath !== "/" ? nextPath : readPostLoginPath()),
  );

  useEffect(() => {
    if (auth.status !== "signed_in") return;
    clearPostLoginPath();
    router.replace(safeNextPath, { scroll: false });
  }, [auth.status, router, safeNextPath]);

  if (auth.status === "initializing" || auth.status === "redirecting" || auth.status === "signed_in") {
    return <AuthenticationProgress label={auth.status === "signed_in" ? "Opening Pipeline" : "Signing you in"} />;
  }

  return (
    <AuthenticationShell>
      <section aria-labelledby="sign-in-heading" className="pipeline-auth-form">
        <p className="pipeline-auth-eyebrow"><LockKeyhole size={16} aria-hidden="true" />Secure workspace</p>
        <h1 id="sign-in-heading" className="pipeline-auth-heading">Sign in to Pipeline</h1>
        <p className="pipeline-auth-description">Use your Microsoft account to continue to Pipeline.</p>

        {auth.configured ? (
          <button
            type="button"
            onClick={() => void auth.signIn(safeNextPath)}
            className="pipeline-auth-signIn"
          >
            <span className="pipeline-auth-microsoftBadge"><MicrosoftMark size={18} /></span>
            <span>Continue with Microsoft</span>
            <ArrowRight className="pipeline-auth-arrow" size={20} aria-hidden="true" />
          </button>
        ) : null}

        {auth.error || !auth.configured ? (
          <div role="alert" className="pipeline-auth-error">
            {auth.error ?? "Microsoft sign-in is not configured for this deployment. An administrator needs to add the Entra application settings."}
          </div>
        ) : null}

        <p className="pipeline-auth-access">Access is limited to authorized Alamo Health accounts.</p>
      </section>
    </AuthenticationShell>
  );
}
