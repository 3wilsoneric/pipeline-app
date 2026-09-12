import { Suspense } from "react";

import PipelineOverviewRoute from "@/components/pipeline/PipelineOverviewRoute";
import { getPipelineServerEntryUser } from "@/lib/auth/server-entry";
import { getHomeBriefing } from "@/lib/pipeline/home-briefing";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = await getPipelineServerEntryUser();
  // Only Home needs its briefing. Use the exact API projection/effective user,
  // not a second query model or cached authorization decision. An outage keeps
  // the existing client retry/error path rather than failing the whole page.
  const initialBriefing = user && !params.screen && params.view !== "referrals"
    ? await getHomeBriefing(user).catch(() => null)
    : null;
  return (
    <Suspense fallback={null}>
      <PipelineOverviewRoute initialBriefing={initialBriefing} />
    </Suspense>
  );
}
