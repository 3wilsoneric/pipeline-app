"use client";

import { useEffect } from "react";

import AuthenticationProgress from "@/components/auth/AuthenticationProgress";
import { usePipelineAuth } from "@/components/auth/PipelineAuthProvider";
import { clearPostLoginPath, normalizePostLoginPath, readPostLoginPath } from "@/lib/auth/post-login-path";

function MicrosoftMark() {
  return (
    <span className="grid h-[18px] w-[18px] grid-cols-2 gap-[2px]" aria-hidden="true">
      <span className="bg-[#f25022]" />
      <span className="bg-[#7fba00]" />
      <span className="bg-[#00a4ef]" />
      <span className="bg-[#ffb900]" />
    </span>
  );
}

export default function PipelineSignIn({ nextPath }: { nextPath: string }) {
  const auth = usePipelineAuth();
  const safeNextPath = normalizePostLoginPath(nextPath !== "/" ? nextPath : readPostLoginPath());

  useEffect(() => {
    if (auth.status !== "signed_in") return;
    clearPostLoginPath();
    window.location.replace(safeNextPath);
  }, [auth.status, safeNextPath]);

  if (auth.status === "initializing" || auth.status === "redirecting" || auth.status === "signed_in") {
    return <AuthenticationProgress label={auth.status === "signed_in" ? "Opening Pipeline" : "Signing you in"} />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5 py-10 text-[#111111] sm:px-8">
      <section aria-labelledby="sign-in-heading" className="w-full max-w-[460px] border border-[#d9d9d9] bg-white px-7 py-8 sm:px-9 sm:py-9">
        <div className="border-b border-[#d9d9d9] pb-6">
          <p className="text-[12px] font-black uppercase tracking-[0.24em] text-[#0f8b73]">Pipeline</p>
          <p className="mt-2 text-[13px] text-[#737373]">Alamo Health admissions</p>
        </div>

        <div className="pt-7">
          <h1 id="sign-in-heading" className="text-[30px] font-black leading-tight">Sign in</h1>
          <p className="mt-3 text-[15px] leading-6 text-[#595959]">Use your Microsoft account to continue to Pipeline.</p>

          {auth.configured ? (
            <button
              type="button"
              onClick={() => void auth.signIn(safeNextPath)}
              className="mt-7 inline-flex h-12 w-full items-center justify-center gap-3 border border-[#8a8886] bg-white px-5 text-[14px] font-semibold text-[#242424] transition-colors hover:border-[#605e5c] hover:bg-[#f5f5f5]"
            >
              <MicrosoftMark />
              Continue with Microsoft
            </button>
          ) : null}
        </div>

        {auth.error || !auth.configured ? (
          <div role="alert" className="mt-6 border-l-2 border-[#a04436] bg-[#fff7f5] px-4 py-3 text-[13px] leading-6 text-[#5e2c24]">
            {auth.error ?? "Microsoft sign-in is not configured for this deployment. An administrator needs to add the Entra application settings."}
          </div>
        ) : null}

        <p className="mt-7 border-t border-[#d9d9d9] pt-5 text-[12px] leading-5 text-[#737373]">Access is limited to authorized Alamo Health accounts.</p>
      </section>
    </main>
  );
}
