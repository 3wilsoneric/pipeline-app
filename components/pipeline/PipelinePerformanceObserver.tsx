"use client";
import { useEffect } from "react";
import { observePipelineBrowserPerformance } from "@/lib/observability/browser-performance";

export default function PipelinePerformanceObserver() {
  useEffect(observePipelineBrowserPerformance, []);
  return null;
}
