export type ClientIdentityTitleInput = {
  name?: unknown;
  gender?: unknown;
  community?: unknown;
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

export function presentClientName(value: unknown): string;
export function presentClientGender(value: unknown): string;
export function presentClientCommunity(value: unknown): string;
export function formatClientIdentityTitle(input: ClientIdentityTitleInput): string;
export function normalizeClientName(value: unknown, options?: ClientNameNormalizationOptions): string;
export function isPersonOnlyClientName(value: unknown): boolean;
export function resolveClientGender(...sources: unknown[]): string | null;
export function resolveClientCommunity(...sources: unknown[]): string | null;
export function formatClientIdentityDetail(...values: unknown[]): string;
export function extractImportedClientMetadata(value: unknown): string | null;
