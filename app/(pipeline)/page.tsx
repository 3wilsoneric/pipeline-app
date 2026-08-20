import { Suspense } from "react";

import PipelineOverviewRoute from "@/components/pipeline/PipelineOverviewRoute";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Reading the request-time query lets useSearchParams participate in the
  // initial server render. No application data is fetched at this boundary.
  await searchParams;
  return (
    <Suspense fallback={null}>
      <PipelineOverviewRoute />
    </Suspense>
  );
}
