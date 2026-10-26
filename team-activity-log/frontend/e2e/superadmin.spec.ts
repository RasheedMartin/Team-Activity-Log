import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

// Super admin: listed accounts only; deleting an org needs its URL name typed; wiping everything
// is off unless the server allows it.
test("super admin page: orgs at a glance, guarded deletes", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Super admin" }).click();
  await expect(page.getByRole("heading", { name: "Super admin" })).toBeVisible();
  const table = page.getByRole("table", { name: "Organizations" });
  await expect(table.getByRole("row")).not.toHaveCount(1); // header plus at least one org
  const first = table.getByRole("row").nth(1);
  const slug = ((await first.getByText(/^\//).innerText()) ?? "").slice(1);
  await first.getByRole("button", { name: /^Delete / }).click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: "Delete organization" });
  await expect(confirm).toBeDisabled();
  await page.getByRole("dialog").getByLabel(`Type ${slug} to confirm`).fill(slug);
  await expect(confirm).toBeEnabled();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText(/Switched off on this server/)).toBeVisible();
});
