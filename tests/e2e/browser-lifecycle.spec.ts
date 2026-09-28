import { expect, test } from "@playwright/test";
import { closeTestBrowser } from "./support/browser-lifecycle";

test("manual browser cleanup finishes every context before the browser", async () => {
  const events: string[] = [];
  await closeTestBrowser({
    contexts: () => [1, 2].map((id) => ({
      close: async () => { await Promise.resolve(); events.push(`context ${id}`); },
    })),
    close: async () => { events.push("browser"); },
  });
  expect(events).toEqual(["context 1", "context 2", "browser"]);
});

test("manual browser cleanup preserves context failures and still closes the browser", async () => {
  const failure = new Error("context cleanup failed");
  let closed = false;
  await expect(closeTestBrowser({
    contexts: () => [{ close: async () => { throw failure; } }],
    close: async () => { closed = true; },
  })).rejects.toBe(failure);
  expect(closed).toBe(true);
});

test("manual browser cleanup preserves browser failures and accepts absent optional browsers", async () => {
  const failure = new Error("browser cleanup failed");
  await expect(closeTestBrowser({
    contexts: () => [],
    close: async () => { throw failure; },
  })).rejects.toBe(failure);
  await closeTestBrowser(null);
  await closeTestBrowser(undefined);
});
