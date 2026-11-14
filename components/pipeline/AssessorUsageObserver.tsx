"use client";
import { useEffect } from "react";
import { observeAssessorUsage } from "@/lib/observability/assessor-usage-browser";

export default function AssessorUsageObserver() {
  useEffect(observeAssessorUsage, []);
  return null;
}
