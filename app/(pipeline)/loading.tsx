export default function PipelineLoading() {
  return (
    <main className="h-full bg-white px-6 py-5" aria-label="Loading Pipeline">
      <div role="status" aria-label="Loading Pipeline" aria-busy="true" className="flex h-10 w-full max-w-[640px] items-center gap-4 bg-[#f7f9f8] px-3">
        <div className="h-3 w-24 animate-pulse bg-[#dce4e0]" />
        <div className="h-3 flex-1 animate-pulse bg-[#e7ece9]" />
      </div>
      <div className="mt-6 h-px w-full bg-[#e5e5e5]" />
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="h-24 animate-pulse bg-[#f7f8f7]" />
        <div className="h-24 animate-pulse bg-[#f7f8f7]" />
        <div className="h-24 animate-pulse bg-[#f7f8f7]" />
      </div>
    </main>
  );
}
