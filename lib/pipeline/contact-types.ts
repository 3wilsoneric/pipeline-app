export const referralContactRoles = [
  "scheduling_contact",
  "responsible_person",
  "legal_guardian",
  "referral_source",
  "family",
  "case_manager",
  "other",
] as const;

export const contactMethods = ["phone", "email", "text", "in_person", "not_recorded"] as const;

export type ReferralContactRole = (typeof referralContactRoles)[number];
export type ContactMethod = (typeof contactMethods)[number];
export type ContactActor = { id: string; name: string };

export type ContactRecord = {
  id: string;
  version: number;
  firstName: string;
  lastName: string;
  organization: string;
  jobTitle: string;
  phone: string;
  email: string;
  preferredContactMethod: ContactMethod;
  bestContactTime: string;
  notes: string;
  active: boolean;
  createdBy: ContactActor;
  updatedBy: ContactActor;
  createdAt: string;
  updatedAt: string;
};

export type ContactInput = Pick<ContactRecord,
  "firstName" | "lastName" | "organization" | "jobTitle" | "phone" | "email" |
  "preferredContactMethod" | "bestContactTime" | "notes"
>;

export type ContactPatch = Partial<ContactInput & Pick<ContactRecord, "active">>;

export type ReferralContactRecord = {
  id: string;
  referralId: number;
  contactId: string;
  version: number;
  role: ReferralContactRole;
  relationship: string;
  notes: string;
  primaryForScheduling: boolean;
  createdBy: ContactActor;
  updatedBy: ContactActor;
  createdAt: string;
  updatedAt: string;
  contact: ContactRecord;
};

export type ReferralContactInput = Pick<ReferralContactRecord,
  "contactId" | "role" | "relationship" | "notes" | "primaryForScheduling"
>;

export type ReferralContactPatch = Partial<Pick<ReferralContactRecord,
  "role" | "relationship" | "notes" | "primaryForScheduling"
>>;

export type ContactSchedulingReadiness = {
  ready: boolean;
  hasReachableClient: boolean;
  hasPrimarySchedulingContact: boolean;
  blockers: string[];
};

export function contactDisplayName(contact: Pick<ContactRecord, "firstName" | "lastName" | "organization">) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.organization;
}

export function referralContactRoleLabel(role: ReferralContactRole) {
  return ({
    scheduling_contact: "Scheduling contact",
    responsible_person: "Responsible person",
    legal_guardian: "Legal guardian",
    referral_source: "Referral source",
    family: "Family",
    case_manager: "Case manager",
    other: "Other",
  } satisfies Record<ReferralContactRole, string>)[role];
}
