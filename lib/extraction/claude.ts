import type { ExtractedField } from "./contracts";

export type ClaudeVisionFallbackInput = {
  packet_id: string;
  page_no: number;
  field_keys: string[];
  base64_png: string;
};

export type ClaudeVisionFallbackResult = {
  fields: ExtractedField[];
  raw_response_path: string;
};

export type ClaudeVisionAdapter = {
  extractFields(input: ClaudeVisionFallbackInput): Promise<ClaudeVisionFallbackResult>;
};

export function getClaudeVisionAdapter(): ClaudeVisionAdapter {
  return {
    async extractFields() {
      throw new Error(
        "Claude vision fallback is not configured yet. Call this from Databricks after PHI approval and schema validation are in place.",
      );
    },
  };
}
