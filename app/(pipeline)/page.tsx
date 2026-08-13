import { Suspense } from "react";

import PipelineOverviewRoute from "@/components/pipeline/PipelineOverviewRoute";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <PipelineOverviewRoute />
    </Suspense>
  );
}
