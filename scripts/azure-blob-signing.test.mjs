import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";

function fixture() {
  const requests = [];
  const env = { AZURE_STORAGE_ACCOUNT: "syntheticstorage" };
  const owner = loadEntry("lib/extraction/azure-blob.ts", {
    "@azure/identity": { DefaultAzureCredential: class {} },
    "@azure/storage-blob": {
      BlobServiceClient: class {
        constructor(url) { this.url = url; }
        getUserDelegationKey(start, end) {
          return new Promise((resolve, reject) => requests.push({ url: this.url, start, end, resolve, reject }));
        }
      },
      BlobSASPermissions: { parse: (value) => value },
      SASProtocol: { Https: "https" },
      generateBlobSASQueryParameters: (_values, key, account) => {
        assert.equal(key.account, account);
        return { toString: () => "synthetic-signed-query" };
      },
    },
    "@/lib/observability/pipeline-metrics": { recordPipelineMetric() {} },
  }, { process: { env } });
  return { owner, requests, env };
}

test("concurrent file reads share one credential request and reuse its result", async () => {
  const { owner, requests } = fixture();
  const reads = Array.from({ length: 25 }, (_, i) => owner.getAzureBlobUploadSigner().createReadUrl("raw", `synthetic/${i}`));
  assert.equal(requests.length, 1);
  requests[0].resolve({ account: "syntheticstorage" });
  assert.equal((await Promise.all(reads)).length, 25);
  await owner.getAzureBlobUploadSigner().createReadUrl("raw", "synthetic/again");
  assert.equal(requests.length, 1);
});

test("failed refresh is released for retry; account changes never reuse another account's key", async () => {
  const { owner, requests, env } = fixture();
  const failed = owner.getAzureBlobUploadSigner().createReadUrl("raw", "synthetic");
  const rejection = assert.rejects(failed, { code: "blob_delegation_key_failed" });
  requests[0].reject(new Error("synthetic failure"));
  await rejection;
  const first = owner.getAzureBlobUploadSigner().createReadUrl("raw", "synthetic");
  env.AZURE_STORAGE_ACCOUNT = "differentstorage";
  const second = owner.getAzureBlobUploadSigner().createReadUrl("raw", "synthetic");
  requests[1].resolve({ account: "syntheticstorage" });
  requests[2].resolve({ account: "differentstorage" });
  const urls = await Promise.all([first, second]);
  assert.match(urls[0], /syntheticstorage\.blob/);
  assert.match(urls[1], /differentstorage\.blob/);
});

test("scheduled warming prepares credentials without loading files; failure does not block queue work", async () => {
  const { owner, requests } = fixture();
  const warming = owner.warmDocumentReadSigner();
  requests[0].resolve({ account: "syntheticstorage" });
  await warming;
  await owner.getAzureBlobUploadSigner().createReadUrl("raw", "synthetic");
  assert.equal(requests.length, 1);
  const another = fixture();
  const unavailable = another.owner.warmDocumentReadSigner();
  another.requests[0].reject(new Error("synthetic outage"));
  await unavailable;
});
