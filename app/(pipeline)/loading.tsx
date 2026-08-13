export default function PipelineLoading() {
  return (
    <main className="h-full bg-white px-6 py-5" aria-label="Loading Pipeline">
      <div className="h-10 w-full max-w-[640px] animate-pulse bg-[#f0f2f1]" />
      <div className="mt-6 h-px w-full bg-[#e5e5e5]" />
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="h-24 animate-pulse bg-[#f7f8f7]" />
        <div className="h-24 animate-pulse bg-[#f7f8f7]" />
        <div className="h-24 animate-pulse bg-[#f7f8f7]" />
      </div>
    </main>
  );
}
