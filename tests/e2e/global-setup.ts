import { rm } from "node:fs/promises";

export default async function prepareIsolatedReferralStore() {
  const paths = [
    process.env.PIPELINE_E2E_REFERRAL_STORE_PATH,
    process.env.PIPELINE_E2E_ASSESSMENT_STORE_PATH,
    process.env.PIPELINE_E2E_RESIDENT_LINK_STORE_PATH,
    process.env.PIPELINE_E2E_DOCUMENT_STORE_PATH,
    process.env.PIPELINE_E2E_DESKTOP_STATE_STORE_PATH,
  ];
  if (paths.some((path) => !path)) throw new Error("Isolated end-to-end store paths are required.");

  await Promise.all(paths.map((path) => rm(path!, { force: true, recursive: true })));

  return async () => {
    await Promise.all(paths.map((path) => rm(path!, { force: true, recursive: true })));
  };
}
