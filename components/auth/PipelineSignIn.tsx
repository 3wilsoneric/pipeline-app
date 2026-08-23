"use client";

import { useEffect } from "react";

import AuthenticationBrand, { MicrosoftMark } from "@/components/auth/AuthenticationBrand";
import AuthenticationProgress from "@/components/auth/AuthenticationProgress";
import { usePipelineAuth } from "@/components/auth/PipelineAuthProvider";
import { clearPostLoginPath, normalizePostLoginPath, readPostLoginPath } from "@/lib/auth/post-login-path";
import { toPipelinePath } from "@/lib/pipeline/base-path";

export default function PipelineSignIn({ nextPath }: { nextPath: string }) {
  const auth = usePipelineAuth();
  const safeNextPath = toPipelinePath(
    normalizePostLoginPath(nextPath !== "/" ? nextPath : readPostLoginPath()),
  );

  useEffect(() => {
    if (auth.status !== "signed_in") return;
    clearPostLoginPath();
    window.location.replace(safeNextPath);
  }, [auth.status, safeNextPath]);

  if (auth.status === "initializing" || auth.status === "redirecting" || auth.status === "signed_in") {
    return <AuthenticationProgress label={auth.status === "signed_in" ? "Opening Pipeline" : "Signing you in"} />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f8f7] px-5 py-10 text-[#111111] sm:px-8">
      <section
        aria-labelledby="sign-in-heading"
        className="w-full max-w-[480px] overflow-hidden rounded-md border border-[#ced8d4] border-t-4 border-t-[#0f8b73] bg-white shadow-[0_18px_45px_rgba(29,56,48,0.11)]"
      >
        <div className="border-b border-[#e1e7e4] px-6 py-5 sm:px-8">
          <AuthenticationBrand />
        </div>

        <div className="px-7 py-8 sm:px-9 sm:py-9">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#0f8b73]">Secure workspace</p>
          <h1 id="sign-in-heading" className="mt-2 text-[30px] font-black leading-tight sm:text-[34px]">Sign in to Pipeline</h1>
          <p className="mt-3 text-[15px] leading-6 text-[#595959]">Use your Microsoft account to continue to Pipeline.</p>

          {auth.configured ? (
            <button
              type="button"
              onClick={() => void auth.signIn(safeNextPath)}
              className="mt-7 inline-flex h-12 w-full items-center justify-center gap-3 rounded-sm border border-[#8a8886] bg-white px-5 text-[14px] font-semibold text-[#242424] outline-none transition-colors hover:border-[#0f8b73] hover:bg-[#f6faf8] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2"
            >
              <MicrosoftMark size={18} />
              Continue with Microsoft
            </button>
          ) : null}

          {auth.error || !auth.configured ? (
            <div role="alert" className="mt-6 border-l-2 border-[#a04436] bg-[#fff7f5] px-4 py-3 text-[13px] leading-6 text-[#5e2c24]">
              {auth.error ?? "Microsoft sign-in is not configured for this deployment. An administrator needs to add the Entra application settings."}
            </div>
          ) : null}

          <p className="mt-7 border-t border-[#e1e7e4] pt-5 text-[12px] leading-5 text-[#737373]">Access is limited to authorized Alamo Health accounts.</p>
        </div>
      </section>
    </main>
  );
}
