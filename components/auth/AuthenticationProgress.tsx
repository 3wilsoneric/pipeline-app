export default function AuthenticationProgress({
  label = "Signing you in",
  detail = "Connecting to Microsoft...",
}: {
  label?: string;
  detail?: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5 py-10 text-[#111111] sm:px-8">
      <section role="status" aria-live="polite" className="w-full max-w-[460px] border border-[#d9d9d9] bg-white px-7 py-8 sm:px-9 sm:py-9">
        <div className="border-b border-[#d9d9d9] pb-5 text-[12px] font-black uppercase tracking-[0.2em] text-[#0f8b73]">
          Pipeline
        </div>
        <div className="pt-7">
          <h1 className="text-[28px] font-black leading-tight">{label}</h1>
          <div className="mt-5 flex items-center gap-3 text-[14px] text-[#595959]">
            <span className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-[#d9d9d9] border-t-[#0f8b73]" aria-hidden="true" />
            {detail}
          </div>
        </div>
      </section>
    </main>
  );
}
