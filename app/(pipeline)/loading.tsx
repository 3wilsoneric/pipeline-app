import PipelineArcadeLoader from "@/components/pipeline/PipelineArcadeLoader";

export default function PipelineLoading() {
  return (
    <main className="flex h-full min-h-[360px] items-center justify-center bg-white px-6 py-10" aria-label="Loading Pipeline">
      <PipelineArcadeLoader label="Loading Pipeline" />
    </main>
  );
}
