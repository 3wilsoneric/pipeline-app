import Link from "next/link";

// Remove this temporary route pause when the improved Learning Center is approved for release.
export default function TrainingLayout() {
  return (
    <section aria-label="Learning Center unavailable" className="flex h-full items-center justify-center overflow-y-auto px-6 py-12">
      <div className="w-full max-w-md rounded-lg border border-[#dce1dd] bg-white p-8 text-center">
        <h1 className="text-2xl font-semibold text-[#252c28]">Learning Center</h1>
        <p className="mt-3 text-base leading-6 text-[#626b65]">Temporarily unavailable while we make improvements.</p>
        <Link href="/?view=referrals" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-[#087d66] px-5 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087d66]">Back to Workspaces</Link>
      </div>
    </section>
  );
}
