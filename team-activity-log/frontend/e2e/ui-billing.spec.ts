import { expect, test } from "@playwright/test";
import { LIVE, openScenario } from "./helpers";

// Trial and billing on the plan card. The real backend runs here, with its plan answer and
// Stripe stood in (Stripe needs keys and a network; the backend's billing tests cover the API).
test.skip(!LIVE, "billing needs the real API");

const plan = (over: object) => ({
  plan: "team",
  paidPlan: "free",
  name: "Team",
  trial: { endsAt: "2026-11-05T00:00:00Z", daysLeft: 11, active: true },
  billing: { enabled: true, status: "active", subscribed: false, canManage: false, options: ["team:month", "team:year", "business:month", "business:year"] },
  limits: { members: null, workspaces: null, privateWorkspaces: true, storageBytes: null, importsPerMonth: null },
  usage: { members: 3, pendingInvites: 0, workspaces: 2, storageBytes: 1e8, importsThisMonth: 2 },
  ...over,
});

test("trial and upgrade on the plan card", async ({ page }) => {
  await openScenario(page, "small");
  const org = /\/o\/([^/]+)\//.exec(page.url())![1];
  await page.route("**/v1/orgs/*/plan", (r) => r.fulfill({ json: plan({}) }));
  let checkout: unknown;
  await page.route("**/v1/orgs/*/billing/checkout", async (r) => {
    checkout = r.request().postDataJSON();
    await r.fulfill({ json: { url: "/stripe-checkout-stand-in" } });
  });
  await page.goto(`/o/${org}/admin/settings`);
  await expect(page.getByText("Team trial: 11 days left")).toBeVisible();
  await expect(page.getByRole("button", { name: /Upgrade to Team/ })).toContainText("$8 per member / month, billed yearly");
  await page.getByRole("button", { name: "Monthly" }).click();
  await expect(page.getByRole("button", { name: /Upgrade to Business/ })).toContainText("$20 per member / month");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: /Upgrade to Team/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/plan-card-trial-phone.png", fullPage: true });
  await page.getByRole("button", { name: /Upgrade to Team/ }).click();
  await expect(page).toHaveURL(/stripe-checkout-stand-in/);
  expect(checkout).toEqual({ plan: "team", interval: "month" });
});

test("subscribed: manage billing; payment trouble is flagged", async ({ page }) => {
  await openScenario(page, "small");
  const org = /\/o\/([^/]+)\//.exec(page.url())![1];
  await page.route("**/v1/orgs/*/plan", (r) => r.fulfill({ json: plan({ paidPlan: "team", trial: null, billing: { enabled: true, status: "past_due", subscribed: true, canManage: true, options: [] } }) }));
  await page.goto(`/o/${org}/admin/settings?billing=success`);
  await expect(page.getByText("Thanks! You're on Team.")).toBeVisible();
  await expect(page.getByText(/last payment didn't go through/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage billing" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Upgrade to/ })).toHaveCount(0);
});
