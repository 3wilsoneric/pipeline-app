export type CommunicationStatus = "preparing" | "ready" | "sending" | "submitted" | "delivery_pending" | "delivered" | "delivery_failed" | "not_sent" | "unconfirmed";

export type CommunicationView = {
  id: string; referralId: number; clientName: string; community: string; admissionDate: string;
  createdAt: string; submittedAt?: string; status: CommunicationStatus;
  from: string; to: string[]; cc: string[]; replyTo: string;
  assessorName: string; preparedBy: string; assessmentVersion: number;
  subject: string; html?: string;
  files: Array<{ id: string; name: string; contentType: string; byteSize: number }>;
  note?: string;
};

export const communicationStatusLabels: Record<CommunicationStatus, string> = {
  preparing: "Preparing preview", ready: "Preview saved", sending: "Sending",
  submitted: "Submitted to Outlook", delivery_pending: "Checking delivery", delivered: "Sent", delivery_failed: "Delivery failed",
  not_sent: "Not sent", unconfirmed: "Confirmation pending",
};
