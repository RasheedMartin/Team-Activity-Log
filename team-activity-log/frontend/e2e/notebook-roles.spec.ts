import { expect, test, type Page } from "@playwright/test";
import { openScenario, notebookAction } from "./helpers";

// Owner request: others can only view a notebook unless its owner makes them an editor (or owner).

async function signInAs(page: Page, name: string) {
  await page.evaluate(async (n) => {
    const personas = await (await fetch("/v1/dev/personas")).json();
    const p = personas.find((x: { user: { name: string } }) => x.user.name === n);
    await fetch("/v1/dev/sign-in-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: p.user.id }) });
  }, name);
}
// Switching person starts fresh, as signing in does (nothing cached from the previous person).
const go = async (page: Page, path: string) => {
  await page.goto(path);
  await expect(page.getByLabel("Notebook title").or(page.getByRole("button", { name: "Account menu" })).first()).toBeVisible();
};

test("notebooks are view-only for others until the owner shares editing", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Notebooks" }).click();
  await page.getByRole("button", { name: "New notebook" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Shared lab book");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await notebookAction(page, "Add posts");
  await page.getByRole("dialog").getByRole("list", { name: "Posts to add" }).getByRole("button").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Add 1" }).click();
  await expect(page.getByText(/^1 entry/)).toBeVisible();
  const nb = new URL(page.url()).pathname;

  // Someone else: view only.
  await signInAs(page, "Marcus Lindqvist");
  await go(page, nb);
  await expect(page.getByText(/· view only/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Write a page" })).toHaveCount(0);
  await page.getByRole("button", { name: "Notebook actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Add posts" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Delete notebook…" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The owner makes them an editor.
  await signInAs(page, "Dana Okafor");
  await go(page, nb);
  await notebookAction(page, "Share…");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Add a person").fill("Marcus");
  await page.getByRole("option", { name: /Marcus Lindqvist/ }).click();
  await expect(dialog.getByRole("combobox", { name: "Role for Marcus Lindqvist" })).toHaveText("Editor");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Sharing updated")).toBeVisible();

  // Now they can write and add, but still not delete or share.
  await signInAs(page, "Marcus Lindqvist");
  await go(page, nb);
  await expect(page.getByRole("button", { name: "Write a page" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Notebook actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Add posts" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete notebook…" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Share…" })).toHaveCount(0);
});

test("a notebook shared with specific people is hidden from everyone else and listed under Shared with me", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Notebooks" }).click();
  await page.getByRole("button", { name: "New notebook" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Just for Marcus");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Notebook title")).toHaveValue("Just for Marcus");
  const nb = new URL(page.url()).pathname;
  const notebooks = nb.replace(/\/[^/]+$/, "");

  await notebookAction(page, "Share…");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /Only the people added here/ }).check();
  await dialog.getByLabel("Add a person").fill("Marcus");
  await page.getByRole("option", { name: /Marcus Lindqvist/ }).click();
  await expect(dialog.getByRole("combobox", { name: "Role for Marcus Lindqvist" })).toHaveText("Viewer");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Shared with specific people")).toBeVisible();

  await signInAs(page, "Marcus Lindqvist");
  await page.goto(`${notebooks}?shared=1`);
  await expect(page.getByRole("main").getByText("Just for Marcus")).toBeVisible();
  await expect(page.getByRole("main").getByText(/shared with you/)).toBeVisible();

  await signInAs(page, "Amara Nwosu");
  await page.goto(notebooks);
  await expect(page.getByRole("button", { name: "New notebook" })).toBeVisible(); // the list has loaded
  await expect(page.getByRole("main").getByText("Just for Marcus")).toHaveCount(0);
  await page.goto(nb);
  await expect(page.getByText("Notebook not found")).toBeVisible();
});
