"use client";

import { pipelineAuthRequired } from "@/lib/auth/entra-client";
import { isPipelineDesktopEnabled } from "@/lib/desktop/desktop-config";

export function usesServerUserWorkspaceState() {
  return pipelineAuthRequired || isPipelineDesktopEnabled();
}
