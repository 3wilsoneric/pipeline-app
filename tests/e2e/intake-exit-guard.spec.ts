import { expect, test } from "@playwright/test";

for (const exit of ["Home", "browser Back"] as const) {
  test(`${exit} keeps an unfinished intake open when recovery cannot be saved`, async ({ page }) => {
    test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Desktop recovery requires the local encrypted copy.");
    await page.goto("/");
    await page.getByRole("button", { name: "Create new referral", exact: true }).click();
    await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");

    await page.evaluate(() => {
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
        const request = Reflect.apply(originalPut, this, args);
        if (this.name === "records") this.transaction.abort();
        return request;
      };
    });
    let fallbackWrites = 0;
    await page.route("**/api/me/referral-drafts/*", (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      fallbackWrites += 1;
      return route.fulfill({ status: 503, json: { error: "Synthetic draft save interruption" } });
    });

    const name = page.getByRole("textbox", { name: "NAME", exact: true });
    await name.fill("Synthetic unfinished intake");
    const draftUrl = page.url();
    const draftId = new URL(draftUrl).searchParams.get("draftId");
    if (exit === "Home") await page.getByRole("button", { name: "Pipeline home", exact: true }).click();
    else await page.goBack();

    await expect(page.getByTestId("workspace-save-status").getByRole("alert"))
      .toContainText("Synthetic draft save interruption");
    await expect.poll(() => new URL(page.url()).searchParams.get("draftId")).toBe(draftId);
    await expect(name).toHaveValue("Synthetic unfinished intake");
    expect(fallbackWrites).toBeGreaterThan(0);
  });
}

test("browser intake exit waits for its tab draft to be saved", async ({ page }) => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E === "true", "Browser tab storage is not the desktop recovery source.");
  await page.goto("/");
  await page.getByRole("button", { name: "Create new referral", exact: true }).click();
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  const draftUrl = page.url();
  const draftId = new URL(draftUrl).searchParams.get("draftId");

  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (key.startsWith("pipeline-referral-draft:")) throw new DOMException("Synthetic tab draft write failure", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill("Unsaved tab draft");
  await page.getByRole("button", { name: "Pipeline home", exact: true }).click();

  await expect.poll(() => new URL(page.url()).searchParams.get("draftId")).toBe(draftId);
  await expect(page.getByTestId("packet-workspace")).toBeVisible();
  await expect(page.getByTestId("workspace-save-status").getByRole("alert"))
    .toContainText("Synthetic tab draft write failure");
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Unsaved tab draft");
});

test("immediate browser Back preserves the latest tab draft before autosave", async ({ page }) => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E === "true", "Browser tab storage is not the desktop recovery source.");
  await page.goto("/");
  await page.getByRole("button", { name: "Create new referral", exact: true }).click();
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  const draftUrl = page.url();
  const draftId = new URL(draftUrl).searchParams.get("draftId");
  expect(draftId).toBeTruthy();
  await page.evaluate(() => {
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => schedule(handler, timeout === 350 ? 60_000 : timeout, ...args)) as typeof window.setTimeout;
  });

  await page.getByRole("textbox", { name: "NAME", exact: true }).fill("Immediate exit recovery");
  await expect.poll(() => page.evaluate((id) => window.sessionStorage.getItem(`pipeline-referral-draft:new-${id}`), draftId)).toBeNull();
  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect.poll(() => page.evaluate((id) => JSON.parse(window.sessionStorage.getItem(`pipeline-referral-draft:new-${id}`) ?? "null")?.fields?.name?.value, draftId)).toBe("Immediate exit recovery");

  await page.goForward();
  await expect.poll(() => new URL(page.url()).searchParams.get("draftId")).toBe(draftId);
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Immediate exit recovery");
});
