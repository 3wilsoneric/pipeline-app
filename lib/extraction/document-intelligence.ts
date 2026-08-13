export type DocumentIntelligencePageResult = {
  packet_id: string;
  page_no: number;
  model: "prebuilt-layout" | "prebuilt-document";
  raw_json_path: string;
  page_avg_confidence: number;
};

export type DocumentIntelligenceAdapter = {
  analyzePage(input: {
    packet_id: string;
    page_no: number;
    image_blob_url: string;
  }): Promise<DocumentIntelligencePageResult>;
};

export function getDocumentIntelligenceAdapter(): DocumentIntelligenceAdapter {
  return {
    async analyzePage() {
      throw new Error(
        "Azure Document Intelligence is not configured yet. This adapter is the seam for the Databricks task.",
      );
    },
  };
}
