"use client";

import { useEffect, useState } from "react";

import { toPipelinePath } from "@/lib/pipeline/base-path";

export const PIPELINE_NAVIGATION_EVENT = "pipeline:navigation";

export function pushPipelineHistory(path: string) {
  window.history.pushState(null, "", toPipelinePath(path));
  notifyPipelineNavigation();
}

export function replacePipelineHistory(path: string) {
  window.history.replaceState(null, "", toPipelinePath(path));
  notifyPipelineNavigation();
}

export function usePipelineLocationSearch(nextSearch: string) {
  const [locationSearch, setLocationSearch] = useState(nextSearch);

  useEffect(() => {
    const syncLocation = () => setLocationSearch(window.location.search.slice(1));
    window.addEventListener(PIPELINE_NAVIGATION_EVENT, syncLocation);
    window.addEventListener("popstate", syncLocation);
    return () => {
      window.removeEventListener(PIPELINE_NAVIGATION_EVENT, syncLocation);
      window.removeEventListener("popstate", syncLocation);
    };
  }, []);

  useEffect(() => {
    setLocationSearch(nextSearch);
  }, [nextSearch]);

  return locationSearch;
}

function notifyPipelineNavigation() {
  window.dispatchEvent(new Event(PIPELINE_NAVIGATION_EVENT));
}
