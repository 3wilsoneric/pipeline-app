import type { Browser, BrowserContext } from "@playwright/test";

type TestBrowser = Pick<Browser, "close"> & {
  contexts(): Pick<BrowserContext, "close">[];
};

// Manually launched browsers must flush their contexts before shutdown. WebKit
// can otherwise hang in browser.close() after the test's assertions have passed.
export async function closeTestBrowser(browser: TestBrowser | null | undefined) {
  if (!browser) return;
  try {
    await Promise.all(browser.contexts().map((context) => context.close()));
  } finally {
    await browser.close();
  }
}
