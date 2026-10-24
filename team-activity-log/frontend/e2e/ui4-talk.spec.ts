import { expect, test, type Page } from "@playwright/test";
import { openScenario } from "./helpers";

async function signInAs(page: Page, name: string) {
  await page.evaluate(async (n) => {
    const personas = await (await fetch("/v1/dev/personas")).json();
    const p = personas.find((x: { user: { name: string } }) => x.user.name === n);
    await fetch("/v1/dev/sign-in-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: p.user.id }) });
  }, name);
}

async function openDeepThread(page: Page) {
  await page.getByRole("combobox", { name: "Search" }).fill("east side");
  await expect(page.locator("[data-post-id]").first()).toBeVisible();
  await page.locator("[data-post-id]").first().click();
  await expect(page.getByRole("heading", { name: /Discussion/ })).toBeVisible();
}

// §W3 done-when: two personas converse live in a deep thread, mention each other, see Activity
// items, and resolve a question; viewers can only react; hidden posts' threads are read-only.
test("v3 Talk About It: live deep thread, mention, activity, resolve", async ({ page, context }) => {
  await openScenario(page, "small");
  await openDeepThread(page);
  const postUrl = page.url();
  await expect(page.getByText("Why is the drift larger on the east side?")).toBeVisible();
  // Depth > 4 collapses behind "Continue thread".
  await expect(page.getByRole("button", { name: /Continue thread/ })).toBeVisible();

  // A second persona joins from another tab.
  const other = await context.newPage();
  await other.goto(postUrl);
  await expect(other.getByRole("heading", { name: /Discussion/ })).toBeVisible();
  await signInAs(other, "Marcus Lindqvist");
  await other.reload();
  await expect(other.getByRole("heading", { name: /Discussion/ })).toBeVisible();
  const box = other.getByRole("textbox", { name: /Add a comment/ });
  await box.click();
  await other.keyboard.type("Thanks ");
  await other.keyboard.type("@Dan");
  await expect(other.getByRole("option", { name: "Dana Okafor" })).toBeVisible();
  await other.keyboard.press("Enter");
  await other.keyboard.type(" — the cold head explains it.");
  await other.keyboard.press("Meta+Enter");
  await expect(other.getByText("the cold head explains it.")).toBeVisible();

  // It appears live in the first tab without a reload (SSE).
  await expect(page.getByText("the cold head explains it.")).toBeVisible({ timeout: 10_000 });

  // Resolve the question.
  const question = page.locator("[id^=comment-]").filter({ hasText: "Why is the drift larger on the east side?" }).first();
  await question.getByRole("button", { name: "Mark resolved" }).first().click();
  await expect(question.getByText("Resolved").first()).toBeVisible();

  // Dana's Activity has the mention.
  await signInAs(page, "Dana Okafor");
  await page.reload(); // a real sign-in starts a fresh client cache
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByText(/Marcus Lindqvist mentioned you/)).toBeVisible();
  await page.getByText(/Marcus Lindqvist mentioned you/).click();
  await expect(page).toHaveURL(/#comment-/);
});

test("pin a comment on an image", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("button", { name: "Images" }).click();
  await page.getByRole("button", { name: /from / }).first().click();
  await page.getByRole("link", { name: "Open post" }).click();
  await page.getByRole("button", { name: "Comment on image" }).first().click();
  await page.getByLabel("Click to place a comment pin").first().click({ position: { x: 80, y: 60 } });
  await page.getByRole("textbox", { name: "Comment on this spot…" }).click();
  await page.keyboard.type("This bump needs a second look");
  await page.getByRole("button", { name: /^Comment/ }).last().click();
  await expect(page.getByText("Pinned comment added")).toBeVisible();
  const pin = page.getByRole("button", { name: /Comment pin \d/ }).last();
  await expect(pin).toBeVisible();
  await pin.click();
  await page.getByRole("button", { name: "Open in discussion" }).click();
  await expect(page.getByText("This bump needs a second look").last()).toBeVisible();
});

test("viewers can react but not comment", async ({ page }) => {
  await openScenario(page, "viewer");
  await page.locator("[data-post-id]").first().click();
  await expect(page.getByText("Viewers can react to comments but not reply.")).toBeVisible();
  await page.getByRole("button", { name: "Add reaction" }).first().click();
  await page.getByRole("button", { name: "React 🎉" }).click();
  await expect(page.getByRole("button", { name: /🎉 \d+, including you/ })).toBeVisible();
});

test("hidden posts have read-only threads", async ({ page }) => {
  await openScenario(page, "small");
  await page.locator("[data-post-id]").first().click();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Hide/ }).click();
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(page.getByText("This post is hidden, so its discussion is read-only.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Add a comment/ })).toHaveCount(0);
});

test("threads collapse and expand (chevron, thread line, collapse all)", async ({ page }) => {
  await openScenario(page, "small");
  await openDeepThread(page);
  const root = page.locator("[id^=comment-]").filter({ hasText: "Why is the drift larger on the east side?" }).first();
  await root.getByRole("button", { name: "Collapse thread" }).first().click();
  await expect(page.getByText(/\d+ replies hidden/).first()).toBeVisible();
  await expect(page.getByText("Probably the cold head is closer there.")).toHaveCount(0);
  await page.getByRole("button", { name: /Expand thread/ }).first().click();
  await expect(page.getByText("Probably the cold head is closer there.")).toBeVisible();
  // The thread line itself collapses a branch.
  await page.getByRole("button", { name: /Collapse replies to/ }).first().click();
  await expect(page.getByText(/repl(y|ies) hidden/).first()).toBeVisible();
  await page.getByRole("button", { name: /Expand thread/ }).first().click();
  // Collapse all / Expand all.
  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(page.getByText("Probably the cold head is closer there.")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(page.getByText("Probably the cold head is closer there.")).toBeVisible();
});
