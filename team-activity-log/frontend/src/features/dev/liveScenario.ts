import { post } from "../../api/client";
import type { DataScenario } from "../../mock/devSettings";

// Live mode: generate a scenario with the mock's own seed code (so mock and live show the same
// data), then hand the rows to the backend's dev loader, which replaces its Postgres + search data.

async function base64Of(url: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function loadLiveScenario(scenario: DataScenario): Promise<void> {
  const [{ db }, { seedScenario }, manifest] = await Promise.all([import("../../mock/db"), import("../../mock/seed"), import("../../mock/fixtures/assetManifest.json")]);
  await db.wipe();
  const { sessionId } = seedScenario(scenario);
  const signInAs = sessionId ? db.t.sessions.get(sessionId)?.userId : undefined;
  const tables = Object.fromEntries(Object.entries(db.t).map(([name, table]) => [name, (table as { all(): unknown[] }).all()]));
  const assetFiles = Object.fromEntries(await Promise.all(manifest.default.map(async (m) => [m.file, await base64Of(`/mock-assets/${m.file}`)] as const)));
  await db.wipe(); // the browser copy was only scaffolding
  await post("/dev/load", { tables, assetFiles, signInAs });
}
