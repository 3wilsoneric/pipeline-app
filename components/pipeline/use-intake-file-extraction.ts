"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { getPacketContentType } from "@/lib/pipeline/referral-packet-upload";
import type { IntakeFilePreview } from "@/lib/pipeline/referral-canvas-extraction";
import { referralDocumentAutofillEnabled } from "@/lib/extraction/contracts";

type FileJob = {
  key: string;
  file: File;
  controller: AbortController;
  status: "queued" | "reading" | "complete" | "failed";
  result?: IntakeFilePreview;
  error?: string;
};

type ExtractionHealth = { checks?: { extraction_backend?: { mode?: string; ready?: boolean } } };

export function useIntakeFileExtraction() {
  const jobsRef = useRef(new Map<string, FileJob>());
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const capabilityRef = useRef<Promise<boolean> | null>(null);
  const previewEnabledRef = useRef(false);
  const mountedRef = useRef(true);
  const [jobs, setJobs] = useState<FileJob[]>([]);

  useEffect(() => {
    mountedRef.current = true;
    const active = jobsRef.current;
    return () => {
      mountedRef.current = false;
      active.forEach((job) => job.controller.abort());
      active.clear();
    };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setJobs(previewEnabledRef.current ? [...jobsRef.current.values()].map((job) => ({ ...job })) : []);
  }, []);

  const remove = useCallback((key: string) => {
    jobsRef.current.get(key)?.controller.abort();
    jobsRef.current.delete(key);
    refresh();
  }, [refresh]);

  const reset = useCallback(() => {
    jobsRef.current.forEach((job) => job.controller.abort());
    jobsRef.current.clear();
    refresh();
  }, [refresh]);

  const removeFile = (file: File) => {
    for (const [key, job] of jobsRef.current) {
      if (job.file === file) remove(key);
    }
  };

  const start = useCallback((file: File, key: string, referralId?: number) => {
    if (!referralDocumentAutofillEnabled) return;
    const previous = jobsRef.current.get(key);
    if (previous?.file === file && previous.status !== "failed") return;
    previous?.controller.abort();
    const job: FileJob = { key, file, controller: new AbortController(), status: "queued" };
    jobsRef.current.set(key, job);
    refresh();
    queueRef.current = queueRef.current.catch(() => undefined).then(async () => {
      if (job.controller.signal.aborted || !mountedRef.current) return;
      // Never send file bytes or surface preview failures on unsupported servers.
      // Production needs draft-owned worker jobs before this local path can expand.
      capabilityRef.current ??= fetchPipelineJson<ExtractionHealth>(
        "/api/health", { cache: "no-store" }, { timeoutMs: 10_000 },
      // Overall health can be 503 for another store; require extraction's own readiness.
      ).catch((error) => error instanceof PipelineApiError && error.status === 503 ? error.payload as ExtractionHealth | undefined : undefined).then((health) => {
        const backend = health?.checks?.extraction_backend;
        previewEnabledRef.current = backend?.mode === "mock" && backend.ready === true;
        return previewEnabledRef.current;
      });
      const enabled = await capabilityRef.current;
      if (jobsRef.current.get(key) !== job || job.controller.signal.aborted || !mountedRef.current) return;
      if (!enabled) {
        jobsRef.current.delete(key);
        refresh();
        return;
      }
      job.status = "reading";
      refresh();
      try {
        const result = await fetchPipelineJson<Omit<IntakeFilePreview, "fileName">>(
          `/api/uploads/preview${referralId ? `?referralId=${referralId}` : ""}`,
          { method: "POST", headers: { "Content-Type": getPacketContentType(file) }, body: file, signal: job.controller.signal },
          { timeoutMs: 120_000, maxResponseBytes: 256 * 1024 },
        );
        if (jobsRef.current.get(key) !== job || job.controller.signal.aborted) return;
        job.result = { ...result, fileName: file.name };
        job.status = "complete";
      } catch (error) {
        if (jobsRef.current.get(key) !== job || job.controller.signal.aborted) return;
        job.error = error instanceof Error ? error.message : "This file could not be read.";
        job.status = "failed";
      }
      refresh();
    });
  }, [refresh]);

  return {
    jobs,
    previews: jobs.flatMap((job) => job.result ? [job.result] : []),
    busy: jobs.some((job) => job.status === "queued" || job.status === "reading"),
    start,
    remove,
    removeFile,
    reset,
  };
}
