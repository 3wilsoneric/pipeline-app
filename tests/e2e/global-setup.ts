import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export default async function prepareIsolatedReferralStore() {
  const paths = [
    process.env.PIPELINE_E2E_REFERRAL_STORE_PATH,
    process.env.PIPELINE_E2E_ASSESSMENT_STORE_PATH,
    process.env.PIPELINE_E2E_RESIDENT_LINK_STORE_PATH,
    process.env.PIPELINE_E2E_DOCUMENT_STORE_PATH,
    process.env.PIPELINE_E2E_DESKTOP_STATE_STORE_PATH,
    process.env.PIPELINE_E2E_NOTE_LAB_STORE_PATH,
    process.env.PIPELINE_E2E_CONTACT_STORE_PATH,
    process.env.PIPELINE_E2E_COMMUNITY_RECIPIENT_LIST_PATH,
  ];
  if (paths.some((path) => !path)) throw new Error("Isolated end-to-end store paths are required.");

  await Promise.all(paths.map((path) => rm(path!, { force: true, recursive: true })));
  if (process.env.PIPELINE_PERSONA_DEMO !== "true") {
    const path = process.env.PIPELINE_E2E_COMMUNITY_RECIPIENT_LIST_PATH!;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ schema: 1, lists: [{
      community: "San Pablo", version: 1, sourceDates: [], updatedAt: null, to: [], cc: [],
    }] }), { mode: 0o600 });
  }

  return async () => {
    await Promise.all(paths.map((path) => rm(path!, { force: true, recursive: true })));
  };
}
