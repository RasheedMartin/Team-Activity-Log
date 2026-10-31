import { expect, test, type Page } from "@playwright/test";
import { openScenario } from "./helpers";

// Owner request: saved-search alerts. Follow a saved search; when someone else publishes a post
// that matches, it shows up in Activity. Your own posts don't alert you.

async function signInAs(page: Page, name: string) {
  await page.evaluate(async (n) => {
    const personas = await (await fetch("/v1/dev/personas")).json();
    const p = personas.find((x: { user: { name: string } }) => x.user.name === n);
    await fetch("/v1/dev/sign-in-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: p.user.id }) });
  }, name);
}

/** Publish a post as whoever is signed in, in the workspace on screen (through the API). */
async function publish(page: Page, title: string) {
  const slug = /\/w\/([^/?]+)/.exec(page.url())![1];
  await page.evaluate(async ([t, slug]) => {
    const me = await (await fetch("/v1/me")).json();
    const org = me.orgs[0].org.id;
    const ws = me.orgs[0].workspaces.find((w: { slug: string }) => w.slug === slug).id;
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Bench results for the unicorn calorimeter." }] }] };
    const d = await (await fetch(`/v1/orgs/${org}/workspaces/${ws}/posts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t, blocks: [{ id: "b1", type: "text", doc }] }) })).json();
    const r = await fetch(`/v1/orgs/${org}/posts/${d.post.id}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) throw new Error(await r.text());
  }, [title, slug]);
}

test("follow a saved search: someone else's new match lands in Activity", async ({ page }) => {
  await openScenario(page, "small");
  const slug = /\/w\/([^/?]+)/.exec(page.url())![1];
  const viewId = await page.evaluate(async (slug) => {
    const me = await (await fetch("/v1/me")).json();
    const org = me.orgs[0].org.id;
    const ws = me.orgs[0].workspaces.find((w: { slug: string }) => w.slug === slug).id;
    const v = await (await fetch(`/v1/orgs/${org}/workspaces/${ws}/saved-views`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Unicorn watch", filterSpec: { q: "unicorn" }, shared: true }) })).json();
    return v.id as string;
  }, slug);

  // A link to just the saved search (as alert emails use) opens it with its filters.
  await page.goto(page.url().replace(/\/search.*$/, `/search?view=${viewId}`));
  await expect(page.getByRole("heading", { name: "Unicorn watch" })).toBeVisible();
  await expect(page).toHaveURL(/q=unicorn/);

  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await page.getByRole("menuitem", { name: /As they're published/ }).click();
  await expect(page.getByText("You'll see new matches in Activity")).toBeVisible();
  await expect(page.getByRole("button", { name: "Alerts: as they're published" })).toBeVisible();

  // Your own matching post doesn't alert you; a colleague's does.
  await publish(page, "My unicorn notes");
  await signInAs(page, "Marcus Lindqvist");
  await publish(page, "Unicorn calorimeter bench test");
  await signInAs(page, "Dana Okafor");

  await page.goto(page.url().replace(/\/search.*$/, "/activity"));
  const row = page.getByRole("button", { name: /New post matches “Unicorn watch”/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Unicorn calorimeter bench test");
  await expect(page.getByRole("button", { name: /“Unicorn watch”/ })).toHaveCount(1); // one alert: Marcus's post, not Dana's
  await row.click();
  await expect(page.getByRole("heading", { name: "Unicorn calorimeter bench test" })).toBeVisible();

  // Turn it off.
  await page.goto(page.url().replace(/\/p\/.*$/, `/search?view=${viewId}`));
  await page.getByRole("button", { name: "Alerts: as they're published" }).click();
  await page.getByRole("menuitem", { name: /^Off/ }).click();
  await expect(page.getByRole("button", { name: "Alerts", exact: true })).toBeVisible();
});
