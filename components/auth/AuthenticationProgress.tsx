import AuthenticationBrand, { MicrosoftMark } from "@/components/auth/AuthenticationBrand";
import PipelineArcadeLoader from "@/components/pipeline/PipelineArcadeLoader";

export default function AuthenticationProgress({
  label = "Signing you in",
  detail = "Connecting securely to Microsoft Entra ID.",
}: {
  label?: string;
  detail?: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f8f7] px-5 py-10 text-[#111111] sm:px-8">
      <section
        role="status"
        aria-live="polite"
        className="w-full max-w-[480px] overflow-hidden rounded-md border border-[#ced8d4] border-t-4 border-t-[#0f8b73] bg-white shadow-[0_18px_45px_rgba(29,56,48,0.11)]"
      >
        <div className="border-b border-[#e1e7e4] px-6 py-5 sm:px-8">
          <AuthenticationBrand />
        </div>

        <div className="px-7 py-8 sm:px-9 sm:py-9">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#0f8b73]">Secure workspace</p>
          <h1 className="mt-2 text-[29px] font-black leading-tight sm:text-[32px]">{label}</h1>
          <p className="mt-3 text-[14px] leading-6 text-[#595959]">{detail}</p>

          <div className="mt-7 border border-[#dce4e1] bg-white px-4 py-5">
            <div className="flex justify-center">
              <PipelineArcadeLoader label="Verifying access" decorative />
            </div>
            <div className="mt-5 text-center">
              <div className="flex items-center gap-2 text-[12px] font-black text-[#242424]">
                <MicrosoftMark size={14} />
                Microsoft Entra ID
              </div>
              <p className="mt-1 text-[11px] leading-4 text-[#737373]">Verifying your Alamo Health access</p>
            </div>
          </div>

          <p className="mt-5 text-center text-[11px] leading-5 text-[#7a7a7a]">This window will continue automatically.</p>
        </div>
      </section>
    </main>
  );
}
