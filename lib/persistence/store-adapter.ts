export type DurableStoreMode = "local_file" | "postgres";

export type StoreAdapters<T> = Record<DurableStoreMode, T>;

export function resolveDurableStoreMode({
  configuredModes,
  databaseMode,
}: {
  configuredModes: Array<string | undefined>;
  databaseMode?: string;
}): DurableStoreMode {
  const configured = configuredModes
    .map((value) => value?.trim())
    .find((value) => Boolean(value));

  return configured === "postgres" || configured === "external" ||
    (!configured && databaseMode === "postgres")
    ? "postgres"
    : "local_file";
}

export function selectStoreAdapter<T>(
  mode: DurableStoreMode,
  adapters: StoreAdapters<T>,
): T {
  return adapters[mode];
}
