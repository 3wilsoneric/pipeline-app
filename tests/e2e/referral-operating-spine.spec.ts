import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.describe("Referral-to-decision operating spine", () => {
  test("saves, edits, unlinks, and reuses scheduling contacts from Intake", async ({ page }) => {
    const clientName = `Contact ${randomUUID().replaceAll("-", "").slice(0, 10).replace(/[0-9]/gu, "a")}`;
    await page.goto("/?view=referrals");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Create new referral" }).click();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(clientName);
    await page.getByRole("textbox", { name: "DOB", exact: true }).fill("1984-06-12");
    await page.getByRole("combobox", { name: "Community:" }).selectOption("San Pablo");
    await page.getByRole("combobox", { name: "County:" }).selectOption("Contra Costa County");
    await page.getByRole("textbox", { name: "Referent:", exact: true }).fill("Synthetic county access");
    const memberResponse = await page.request.get("/api/members?scope=assessors");
    expect(memberResponse.ok()).toBeTruthy();
    const members = (await memberResponse.json() as { members: Array<{ principal_id: string }> }).members;
    expect(members.length).toBeGreaterThan(0);
    await page.getByRole("combobox", { name: "Owner (@name):" }).selectOption(members[0].principal_id);
    await page.getByRole("button", { name: "Create referral", exact: true }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).not.toBeNull();
    const referralId = Number(new URL(page.url()).searchParams.get("referralId"));
    const contacts = page.getByRole("region", { name: "Contact and coordination", exact: true });
    await expect(contacts).toBeVisible();
    await expect(contacts.getByText("Contact needed", { exact: true })).toBeVisible();

    const referralResponse = await page.request.get(`/api/referrals/${referralId}`);
    expect(referralResponse.ok()).toBeTruthy();
    const referral = (await referralResponse.json() as {
      referral: { version: number; sectionVersions: { documents: number } };
    }).referral;
    const manualIntake = await page.request.post(`/api/referrals/${referralId}/manual-intake`, {
      data: {
        if_match: referral.version,
        if_match_section: referral.sectionVersions.documents,
        reason: "Synthetic operating-spine scheduling proof.",
        client_mutation_id: crypto.randomUUID(),
      },
    });
    expect(manualIntake.ok()).toBeTruthy();
    const assessmentResponse = await page.request.post(`/api/referrals/${referralId}/assessments`, {
      data: { data: {}, client_mutation_id: crypto.randomUUID() },
    });
    expect(assessmentResponse.ok()).toBeTruthy();
    const assessment = (await assessmentResponse.json() as {
      record?: { assessment_id: string; version: number };
      assessment?: { assessment_id: string; version: number };
    });
    const createdAssessment = assessment.record ?? assessment.assessment;
    expect(createdAssessment).toBeDefined();
    const scheduledStart = new Date(Date.now() + 2 * 60 * 60 * 1_000).toISOString();
    const blockedSchedule = await page.request.post(`/api/assessments/${createdAssessment!.assessment_id}/schedule`, {
      data: {
        if_match: createdAssessment!.version,
        client_mutation_id: crypto.randomUUID(),
        allow_conflict: true,
        schedule: { status: "scheduled", start_at: scheduledStart, duration_minutes: 60, method: "zoom", location: "Synthetic Zoom room" },
      },
    });
    expect(blockedSchedule.status()).toBe(422);
    await expect(blockedSchedule.json()).resolves.toMatchObject({ code: "assessment_not_ready_to_schedule" });

    await contacts.getByRole("button", { name: "Add new contact" }).click();
    await contacts.getByLabel("First name").fill("Jordan");
    await contacts.getByLabel("Last name").fill("Coordinator");
    await contacts.getByLabel("Organization").fill("Synthetic County");
    await contacts.getByRole("textbox", { name: "Phone", exact: true }).fill("555-010-2026");
    await contacts.getByLabel("Relationship note").fill("County scheduling coordinator");
    await contacts.getByRole("button", { name: "Save and add" }).click();

    await expect(contacts.getByText("Jordan Coordinator", { exact: true })).toBeVisible();
    await expect(contacts.getByText("Ready to schedule", { exact: true })).toBeVisible();
    await expect(contacts.getByText("Scheduling", { exact: true })).toBeVisible();

    const scheduled = await page.request.post(`/api/assessments/${createdAssessment!.assessment_id}/schedule`, {
      data: {
        if_match: createdAssessment!.version,
        client_mutation_id: crypto.randomUUID(),
        allow_conflict: true,
        schedule: { status: "scheduled", start_at: scheduledStart, duration_minutes: 60, method: "zoom", location: "Synthetic Zoom room" },
      },
    });
    const scheduledPayload = await scheduled.json() as { error?: string; blockers?: string[] };
    expect(scheduled.ok(), JSON.stringify(scheduledPayload)).toBeTruthy();

    const saved = await page.request.get(`/api/referrals/${referralId}/contacts`);
    expect(saved.ok()).toBeTruthy();
    const savedPayload = await saved.json() as { contacts: Array<{ id: string; contact: { id: string; phone: string } }> };
    expect(savedPayload.contacts).toHaveLength(1);
    expect(savedPayload.contacts[0].contact.phone).toBe("555-010-2026");

    await contacts.getByRole("button", { name: "Edit Jordan Coordinator" }).click();
    await contacts.getByRole("textbox", { name: "Phone", exact: true }).fill("555-010-2027");
    await contacts.getByLabel("Connection to referral").selectOption("case_manager");
    await contacts.getByRole("button", { name: "Save contact" }).click();
    await expect(contacts.getByText("Case manager", { exact: true })).toBeVisible();
    await expect(contacts.getByText(/555-010-2027/)).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await contacts.getByRole("button", { name: "Remove Jordan Coordinator from referral" }).click();
    await expect(contacts.getByText("No saved contacts are connected yet.", { exact: true })).toBeVisible();
    await expect(contacts.getByText("Contact needed", { exact: true })).toBeVisible();

    await contacts.getByRole("button", { name: "Find saved contact" }).click();
    const savedResult = contacts.getByRole("button", { name: /Jordan Coordinator/ }).first();
    await expect(savedResult).toBeVisible();
    await savedResult.click();
    await expect(contacts.getByRole("button", { name: "Find saved contact" })).toBeVisible();
    await expect(contacts.getByText("Jordan Coordinator", { exact: true })).toBeVisible();
    await expect(contacts.getByText("Ready to schedule", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("region", { name: "Contact and coordination" }).getByText("Jordan Coordinator", { exact: true })).toBeVisible();
    const activity = await page.request.get(`/api/referrals/${referralId}/activity`);
    expect(activity.ok()).toBeTruthy();
    const activityPayload = await activity.json() as { events: Array<{ action: string }> };
    expect(activityPayload.events.map((event) => event.action)).toEqual(expect.arrayContaining([
      "referral_contact_attached",
      "referral_contact_details_updated",
      "referral_contact_unlinked",
    ]));
  });
});
