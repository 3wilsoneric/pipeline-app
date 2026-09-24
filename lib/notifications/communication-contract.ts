export type CommunicationStatus = "preparing" | "ready" | "sending" | "submitted" | "not_sent" | "unconfirmed";

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
  submitted: "Submitted for delivery", not_sent: "Not sent", unconfirmed: "Confirmation pending",
};
