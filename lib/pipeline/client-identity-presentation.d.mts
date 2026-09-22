export type ClientIdentityTitleInput = {
  name?: unknown;
  gender?: unknown;
  community?: unknown;
  /** Shown as "Unnamed referral · #<id>" when the name is absent or a system placeholder. */
  referralId?: number;
  /** A whole Referral may be passed; a numeric `id` is treated as its referral ID. */
  id?: unknown;
};

export type ClientNameNormalizationOptions = {
  firstName?: unknown;
  lastName?: unknown;
  gender?: unknown;
  community?: unknown;
};

export const missingClientIdentityLabels: Readonly<{
  name: "Name not recorded";
}>;

export function isSystemPlaceholderClientName(value: unknown): boolean;
export function formatUnnamedReferralTitle(referralId: number): string;
export function presentClientName(value: unknown, referralId?: number): string;
export function presentClientGender(value: unknown): string;
export function presentClientCommunity(value: unknown): string;
export function formatClientIdentityTitle(input: ClientIdentityTitleInput): string;
export function formatReferralIdentityContext(input: { name?: unknown; referralId?: number; received?: string | null; source?: unknown }): string;
export function normalizeClientName(value: unknown, options?: ClientNameNormalizationOptions): string;
export function isPersonOnlyClientName(value: unknown): boolean;
export function resolveClientGender(...sources: unknown[]): string | null;
export function resolveClientCommunity(...sources: unknown[]): string | null;
export function formatClientIdentityDetail(...values: unknown[]): string;
export function extractImportedClientMetadata(value: unknown): string | null;
