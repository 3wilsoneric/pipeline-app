import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";

test("keeps Save and add disabled until the new contact is linked", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Contact save chain ${randomUUID().slice(0, 8)}`,
    owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const lastName = `Scheduler${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  let contactWrites = 0;
  let linkWrites = 0;
  let linkStarted!: () => void;
  let releaseLink!: () => void;
  const started = new Promise<void>((resolve) => { linkStarted = resolve; });
  const held = new Promise<void>((resolve) => { releaseLink = resolve; });

  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/contacts") contactWrites += 1;
  });
  await page.route(`**/api/referrals/${referral.id}/contacts`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    linkWrites += 1;
    linkStarted();
    await held;
    await route.continue();
  });

  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake`);
    await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
    const contacts = page.getByRole("region", { name: "Contact and coordination", exact: true });
    await contacts.getByRole("button", { name: "Add new contact" }).click();
    await contacts.getByLabel("First name").fill("Maya");
    await contacts.getByLabel("Last name").fill(lastName);
    await contacts.getByRole("button", { name: "Save and add" }).click();

    await started;
    await expect(contacts.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(contactWrites).toBe(1);
  } finally {
    releaseLink();
  }

  const contacts = page.getByRole("region", { name: "Contact and coordination", exact: true });
  await expect(contacts.getByText(`Maya ${lastName}`, { exact: true })).toBeVisible();
  expect(linkWrites).toBe(1);
  const linked = await page.request.get(`/api/referrals/${referral.id}/contacts`);
  expect(linked.ok()).toBe(true);
  expect((await linked.json()).contacts).toHaveLength(1);
});

test("retries a lost contact-create response without adding another directory entry", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Contact create replay ${randomUUID().slice(0, 8)}`,
    owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const lastName = `Replay${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const mutationIds: string[] = [];
  await page.route("**/api/contacts", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    mutationIds.push(route.request().postDataJSON().client_mutation_id);
    if (mutationIds.length > 1) return route.continue();
    const committed = await route.fetch();
    expect(committed.ok()).toBe(true);
    await route.abort("failed");
  });

  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake`);
  await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
  const contacts = page.getByRole("region", { name: "Contact and coordination", exact: true });
  await contacts.getByRole("button", { name: "Add new contact" }).click();
  await contacts.getByLabel("First name").fill("Maya");
  await contacts.getByLabel("Last name").fill(lastName);
  await contacts.getByRole("button", { name: "Save and add" }).click();
  await expect(contacts.getByRole("alert")).toContainText("Pipeline could not be reached");
  await contacts.getByRole("button", { name: "Save and add" }).click();

  await expect(contacts.getByText(`Maya ${lastName}`, { exact: true })).toBeVisible();
  expect(mutationIds).toHaveLength(2);
  expect(mutationIds[1]).toBe(mutationIds[0]);
  const directory = await page.request.get(`/api/contacts?referral_id=${referral.id}&q=${encodeURIComponent(lastName)}`);
  expect(directory.ok()).toBe(true);
  expect((await directory.json()).contacts).toHaveLength(1);
  const linked = await page.request.get(`/api/referrals/${referral.id}/contacts`);
  expect((await linked.json()).contacts).toHaveLength(1);
});

test("changing a failed contact-create form starts a new mutation", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Contact create edit ${randomUUID().slice(0, 8)}`,
    owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const lastName = `Changed${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const mutationIds: string[] = [];
  await page.route("**/api/contacts", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    mutationIds.push(route.request().postDataJSON().client_mutation_id);
    if (mutationIds.length === 1) return route.fulfill({ status: 503, json: { error: "Synthetic create rejection" } });
    await route.continue();
  });

  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake`);
  await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
  const contacts = page.getByRole("region", { name: "Contact and coordination", exact: true });
  await contacts.getByRole("button", { name: "Add new contact" }).click();
  await contacts.getByLabel("First name").fill("Maya");
  await contacts.getByRole("button", { name: "Save and add" }).click();
  await expect(contacts.getByRole("alert")).toContainText("Synthetic create rejection");
  await contacts.getByLabel("Last name").fill(lastName);
  await contacts.getByRole("button", { name: "Save and add" }).click();

  await expect(contacts.getByText(`Maya ${lastName}`, { exact: true })).toBeVisible();
  expect(mutationIds).toHaveLength(2);
  expect(mutationIds[1]).not.toBe(mutationIds[0]);
});

test("retries lost contact and referral-link edit responses with their original mutations", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Contact edit replay ${randomUUID().slice(0, 8)}`,
    owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const lastName = `Edit${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const createdResponse = await page.request.post("/api/contacts", { data: {
    referral_id: referral.id,
    client_mutation_id: randomUUID(),
    contact: { firstName: "Maya", lastName, organization: "", jobTitle: "", phone: "555-010-2040", email: "", preferredContactMethod: "phone", bestContactTime: "", notes: "" },
  } });
  expect(createdResponse.ok()).toBe(true);
  const created = (await createdResponse.json()).record as { id: string };
  const linkedResponse = await page.request.post(`/api/referrals/${referral.id}/contacts`, { data: {
    contact_id: created.id, role: "scheduling_contact", relationship: "", notes: "", primary_for_scheduling: true,
    client_mutation_id: randomUUID(),
  } });
  expect(linkedResponse.ok()).toBe(true);
  const linkId = (await linkedResponse.json()).record.id as string;

  const mutationIds: string[] = [];
  await page.route(`**/api/contacts/${created.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    mutationIds.push(route.request().postDataJSON().client_mutation_id);
    if (mutationIds.length > 1) return route.continue();
    const committed = await route.fetch();
    expect(committed.ok()).toBe(true);
    await route.abort("failed");
  });

  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake`);
  await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
  const contacts = page.getByRole("region", { name: "Contact and coordination", exact: true });
  await contacts.getByRole("button", { name: `Edit Maya ${lastName}` }).click();
  await contacts.getByRole("textbox", { name: "Phone", exact: true }).fill("555-010-2041");
  await contacts.getByRole("button", { name: "Save contact" }).click();
  await expect(contacts.getByRole("alert")).toContainText("Pipeline could not be reached");
  await contacts.getByRole("button", { name: "Save contact" }).click();

  await expect(contacts.getByRole("button", { name: `Edit Maya ${lastName}` })).toBeVisible();
  await expect(contacts.getByText("(555) 010-2041", { exact: true })).toBeVisible();
  expect(mutationIds).toHaveLength(2);
  expect(mutationIds[1]).toBe(mutationIds[0]);
  const linked = await page.request.get(`/api/referrals/${referral.id}/contacts`);
  expect((await linked.json()).contacts[0].contact.version).toBe(2);

  const linkMutationIds: string[] = [];
  await page.route(`**/api/referrals/${referral.id}/contacts/${linkId}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    linkMutationIds.push(route.request().postDataJSON().client_mutation_id);
    if (linkMutationIds.length > 1) return route.continue();
    const committed = await route.fetch();
    expect(committed.ok()).toBe(true);
    await route.abort("failed");
  });
  await contacts.getByRole("button", { name: `Edit Maya ${lastName}` }).click();
  await contacts.getByLabel("Connection to referral").selectOption("case_manager");
  await contacts.getByRole("button", { name: "Save contact" }).click();
  await expect(contacts.getByRole("alert")).toContainText("Pipeline could not be reached");
  await contacts.getByRole("button", { name: "Save contact" }).click();

  await expect(contacts.getByText("Case manager", { exact: true })).toBeVisible();
  expect(linkMutationIds).toHaveLength(2);
  expect(linkMutationIds[1]).toBe(linkMutationIds[0]);
  expect(mutationIds).toHaveLength(2);
  const finalLinks = await page.request.get(`/api/referrals/${referral.id}/contacts`);
  const finalLink = (await finalLinks.json()).contacts[0];
  expect(finalLink.version).toBe(2);
  expect(finalLink.contact.version).toBe(2);
});
