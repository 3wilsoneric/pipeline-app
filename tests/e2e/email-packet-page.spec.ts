import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createOperationalReferral } from "./support/operational-api";
import { renderMeetClientEmail } from "../../lib/notifications/meet-client-email-template";

async function referralWithAssessment(page: Page, signed = true) {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Packet ${randomUUID().replaceAll(/[^a-z]/g, "")}`, owner: "Annette Everhart", tags: [], documentName: "", documentStatus: "Missing",
  }, { assigneeId: "provisional:allo:annette" });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: {
    client_mutation_id: randomUUID(), data: { current_location: 'Synthetic facility <img src=x onerror="alert(1)">', family_involvement: "Sister helps with appointments." },
  } });
  expect(created.status()).toBe(201);
  const { assessment } = await created.json();
  if (signed) expect((await page.request.post(`/api/assessments/${assessment.assessment_id}/sign`, { data: { if_match: assessment.version, client_mutation_id: randomUUID() } })).status()).toBe(200);
  return { referral, assessment };
}

for (const width of [1440, 390]) test(`Chart pagination preserves the email URL and canonical Outlook-style preview at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  const { referral } = await referralWithAssessment(page);
  let sends = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/meet-client-email")) sends += 1; });
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`;
  await page.goto(url);
  const email = page.getByRole("region", { name: "Email and referral packet", exact: true });
  const stages = page.getByRole("navigation", { name: "Workspace stages" });
  const chartPages = page.getByRole("navigation", { name: "Chart pages" });
  await expect(email).toBeVisible();
  await expect(stages.getByRole("button", { name: /Email & packet/ })).toHaveCount(0);
  await expect(stages.getByRole("button", { name: /Chart/ })).toHaveAttribute("aria-current", "page");
  await expect(chartPages).toContainText("Page 2 of 2");
  const verification = email.getByRole("checkbox", { name: /I verified/ });
  await expect(verification).toBeInViewport();
  expect((await verification.boundingBox())!.y).toBeLessThan((await email.getByRole("textbox", { name: "Authorized recipients" }).boundingBox())!.y);
  await expect(page.getByRole("region", { name: "Client medical chart", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toHaveCount(0);
  await expect(email.getByRole("button", { name: "Send email & packet", exact: true })).toBeDisabled();
  await expect(email.locator("details")).not.toHaveAttribute("open");
  const preview = page.frameLocator('iframe[title="Meet the Client email preview"]');
  await expect(preview.getByRole("heading", { name: "Meet the Client", exact: true })).toBeVisible();
  await expect(preview.locator("body")).toContainText('Synthetic facility <img src=x onerror="alert(1)">');
  await expect(preview.locator("img, script")).toHaveCount(0);
  await expect(email.locator("iframe")).toHaveAttribute("sandbox", "");
  const response = await page.request.get(`/api/referrals/${referral.id}/admission-summary`);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const payload = await response.json();
  expect(payload.email.preview).toEqual(renderMeetClientEmail(payload.report.meetClient, "Playwright QA", "Preview — assigned when sent", []));
  await email.getByRole("textbox", { name: "Authorized recipients" }).fill("care@example.invalid");
  await email.getByRole("button", { name: "Manage files", exact: true }).click();
  await expect(page).toHaveURL(/workspaceView=files/);
  await stages.getByRole("button", { name: /Chart/ }).click();
  await expect(chartPages).toContainText("Page 1 of 2");
  await chartPages.getByRole("button", { name: "Email & packet", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(email.getByRole("textbox", { name: "Authorized recipients" })).toHaveValue("care@example.invalid");
  await chartPages.getByRole("button", { name: "Client chart", exact: true }).click();
  await expect(page).toHaveURL(/workspaceStage=chart/);
  await expect(stages.getByRole("button", { name: /Chart/ })).toHaveAttribute("aria-current", "page");
  await chartPages.getByRole("button", { name: "Email & packet", exact: true }).click();
  await expect(page).toHaveURL(/workspaceView=email/);
  await expect(email).toBeVisible();
  await page.reload();
  await expect(email).toBeVisible();
  await expect(preview.getByRole("heading", { name: "Meet the Client", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByTestId("packet-workspace").evaluate((element) => element.scrollTo({ top: 0 }));
  await page.screenshot({ path: info.outputPath(`email-packet-${width}.png`), fullPage: false, animations: "disabled" });
  expect(sends).toBe(0);
});

test("unsigned packet preview and acceptance stay accessible without signing or sending", async ({ page }) => {
  const { referral, assessment } = await referralWithAssessment(page, false);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
  await expect(page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Chart/ })).toHaveAttribute("aria-current", "page");
  await page.getByRole("navigation", { name: "Chart pages" }).getByRole("button", { name: "Email & packet", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your email preview will appear here" })).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Decision/ }).click();
  await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Decision", exact: true })).toBeVisible();
  const current = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(current.signed_at).toBeNull();
  expect(current.meet_client_sent_at).toBeFalsy();
});

test("packet controls show attachments and retain explicit send confirmation and failure recovery", async ({ page }, info) => {
  const { referral } = await referralWithAssessment(page);
  await page.route(`**/api/referrals/${referral.id}/admission-summary`, async (route) => {
    const response = await route.fetch(); const payload = await response.json();
    payload.email = { ...payload.email, configured: true, sender: "pipeline@example.invalid", eligible: true, ready: true, blockers: [], allowed_recipient_domains: ["example.invalid"],
      admission_packet: { files: [{ document_id: "synthetic-packet", name: "Synthetic referral packet.pdf", category: "admission", byte_size: 2048, ready: true }], total_bytes: 2048, ready: true, delivery_mode: "direct" } };
    await route.fulfill({ response, json: payload });
  });
  // Presentation/transport fixture only. No provider delivery occurs in this browser test.
  let sends = 0; let sentBody: Record<string, unknown> = {};
  await page.route(`**/api/referrals/${referral.id}/meet-client-email`, async (route) => {
    sends += 1; sentBody = route.request().postDataJSON();
    await route.fulfill({ status: 409, json: { error: "The assessment changed. Refresh the packet before sending." } });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  const send = page.getByRole("button", { name: "Send email & packet", exact: true });
  await expect(page.getByRole("link", { name: "Open Synthetic referral packet.pdf" })).toHaveAttribute("href", "/api/files/synthetic-packet/download");
  await page.getByRole("textbox", { name: "Authorized recipients" }).fill("care@example.invalid");
  await expect(send).toBeDisabled(); expect(sends).toBe(0);
  await page.getByRole("checkbox", { name: /I verified/ }).check();
  await expect(send).toBeEnabled();
  await expect(page.getByText("Recipients verified", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Authorized recipients" }).fill("other@example.invalid");
  await expect(page.getByRole("checkbox", { name: /I verified/ })).not.toBeChecked();
  await expect(send).toBeDisabled();
  await page.getByRole("textbox", { name: "Authorized recipients" }).fill("care@example.invalid");
  await page.getByRole("checkbox", { name: /I verified/ }).check();
  await page.getByTestId("packet-workspace").evaluate((element) => element.scrollTo({ top: 0 }));
  await page.screenshot({ path: info.outputPath("email-packet-with-attachments.png"), animations: "disabled" });
  await send.click();
  await expect(page.getByRole("region", { name: "Email and referral packet", exact: true }).getByRole("alert")).toContainText("Refresh the packet");
  expect(sends).toBe(1);
  expect(sentBody).toMatchObject({ confirmed: true, recipients: ["care@example.invalid"], if_match: expect.any(Number), client_mutation_id: expect.any(String) });
  await expect(page.getByRole("textbox", { name: "Authorized recipients" })).toHaveValue("care@example.invalid");
  const refreshed = page.waitForResponse((response) => response.url().endsWith(`/api/referrals/${referral.id}/admission-summary`));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await refreshed;
  await expect(page.getByRole("checkbox", { name: /I verified/ })).not.toBeChecked();
  await expect(send).toBeDisabled();
  await page.unrouteAll({ behavior: "wait" });
});
