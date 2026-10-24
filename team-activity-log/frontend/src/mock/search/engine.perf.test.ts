import { describe, expect, it } from "vitest";
import { db } from "../db";
import { seedScenario } from "../seed";
import { engine } from "../server";

// §A4 budget: filter change → results < 150 ms on the 5,000-post scenario (mock).
// The engine is the dominant cost, so it gets a guard here.
describe("search engine performance (busy scenario)", () => {
  it("answers typical searches well under budget", { timeout: 60_000 }, async () => {
    await db.wipe();
    seedScenario("busy");
    const org = db.t.orgs.all()[0];
    const ws = db.t.workspaces.find((w) => w.slug === "detector")!;
    const me = db.t.users.all()[0];
    const ctx = { orgId: org.id, workspaceIds: [ws.id], me: me.id, canSeeHidden: true };
    const calib = db.t.tags.find((t) => t.name === "calibration")!.id;

    let t0 = performance.now();
    engine.search({}, ctx);
    const build = performance.now() - t0;
    t0 = performance.now();
    engine.warm(); // the app does this in idle time after first render
    const warm = performance.now() - t0;

    const specs = [
      { q: "drift" },
      { q: "drift OR noise" },
      { q: "(gain OR offset) -pump" },
      { q: "title:calibration" },
      { q: '"noise floor"' },
      { all: [{ field: "tag" as const, op: "in" as const, value: [calib] }] },
      { q: "detector", all: [{ field: "workDate" as const, op: "between" as const, value: { preset: "this_year" as const } }], view: "gallery" as const },
    ];
    const times: Record<string, number> = {};
    for (const s of specs) {
      t0 = performance.now();
      engine.search(s, ctx);
      times[JSON.stringify(s).slice(0, 40)] = Math.round(performance.now() - t0);
    }
    console.log(`first feed query ${Math.round(build)} ms, idle warm ${Math.round(warm)} ms`, times);
    expect(build).toBeLessThan(150);
    for (const t of Object.values(times)) expect(t).toBeLessThan(150);
  });
});
