import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

// §W1 done-when: register → org + workspace → invite → accept (sees only their workspaces)
// → switch workspaces → edit profile and preferences (apply immediately and persist).
test("v1 Get In end to end", async ({ page }) => {
  await openScenario(page, "empty");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  // Register a new account and organization.
  await page.getByRole("link", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("Ines Achterberg");
  await page.getByLabel("Work email").fill("ines@northlab.example");
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("link", { name: "Set up organization" }).click();
  await page.getByLabel("Organization name").fill("North Lab");
  await expect(page.getByText("Available")).toBeVisible();
  await page.getByLabel("First workspace").fill("Optics");
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/o\/north-lab\/w\/optics/);
  await expect(page.getByText("Get started in Optics")).toBeVisible();

  // Second, private workspace.
  await page.goto("/o/north-lab/admin/workspaces");
  await page.getByRole("button", { name: "New workspace" }).click();
  await page.getByLabel("Name").fill("Secret Project");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Secret Project" })).toBeVisible();

  // Invite a teammate (to the open workspace only).
  await page.goto("/o/north-lab/admin/members");
  await page.getByRole("button", { name: "Invite people" }).click();
  await page.getByLabel("Emails").fill("omar@northlab.example");
  await page.getByRole("button", { name: /Send 1 invite/ }).click();
  await expect(page.getByText("1 invite sent.")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("cell", { name: "omar@northlab.example" })).toBeVisible();

  // The invite email is in the dev outbox.
  await page.goto("/dev");
  const link = await page.getByRole("link", { name: /\/accept-invite\// }).first().textContent();
  expect(link).toBeTruthy();

  // The teammate accepts in the same browser after the owner signs out (the mock DB lives in this origin's IndexedDB).
  await page.goto("/o/north-lab/w/optics");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.goto(link!);
  await expect(page.getByRole("heading", { name: "Join North Lab" })).toBeVisible();
  await page.getByLabel("Full name").fill("Omar Haddad");
  await page.getByLabel("Choose a password").fill("another-pass");
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page).toHaveURL(/\/o\/north-lab\/w\/optics/);
  // A member without access to the private workspace never sees a picker for it.
  await expect(page.getByRole("button", { name: /Switch workspace/ })).toHaveCount(0);

  // Preferences apply immediately and persist.
  await page.goto("/me/preferences");
  const saved = page.waitForResponse((r) => r.url().endsWith("/v1/me/preferences") && r.ok());
  await page.getByRole("button", { name: "Dark" }).click();
  await saved;
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(17, 19, 23)");
  await page.reload();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(17, 19, 23)");

  // Profile edit.
  await page.goto("/me/profile");
  await page.getByLabel("Title or team").fill("Optics postdoc");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();
});

test("workspace switcher lists every accessible workspace", async ({ page }) => {
  await openScenario(page, "multiOrg");
  await page.getByRole("button", { name: /Switch workspace/ }).click();
  await expect(page.getByRole("menuitem", { name: "Test Stand" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Test Stand" }).click();
  await expect(page).toHaveURL(/\/o\/northfield\/w\/test-stand/);
});

test("expired and revoked invites explain themselves", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.goto("/accept-invite/expired-invite");
  await expect(page.getByText(/This invite is expired/)).toBeVisible();
  await page.goto("/accept-invite/revoked-invite");
  await expect(page.getByText(/This invite is revoked/)).toBeVisible();
});

test("viewer persona can't see admin or new post", async ({ page }) => {
  await openScenario(page, "viewer");
  await expect(page.getByRole("button", { name: /New post/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Organization admin" })).toHaveCount(0);
});
