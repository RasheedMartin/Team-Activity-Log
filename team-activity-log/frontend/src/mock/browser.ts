import { setupWorker } from "msw/browser";
import { db } from "./db";
import { readDevSettings, writeDevSettings, type DataScenario } from "./devSettings";
import { authHandlers } from "./handlers/auth";
import { discussionHandlers } from "./handlers/discussion";
import { importHandlers } from "./handlers/imports";
import { orgHandlers } from "./handlers/orgs";
import { postHandlers } from "./handlers/posts";
import { searchHandlers } from "./handlers/search";
import { seedScenario } from "./seed";
import { engine, invalidateComments, SESSION_COOKIE } from "./server";

export const handlers = [...authHandlers, ...orgHandlers, ...postHandlers, ...searchHandlers, ...discussionHandlers, ...importHandlers];

const SEEDED_KEY = "tal.seeded";

function setSessionCookie(id?: string) {
  document.cookie = id ? `${SESSION_COOKIE}=${id}; Path=/; SameSite=Lax` : `${SESSION_COOKIE}=; Path=/; Max-Age=0`;
}

/** Wipe the store and seed a scenario, signing in as that scenario's default persona. */
export async function loadScenario(scenario: DataScenario) {
  await db.wipe();
  engine.reset();
  invalidateComments();
  const { sessionId } = seedScenario(scenario);
  await db.flush();
  writeDevSettings({ scenario });
  localStorage.setItem(SEEDED_KEY, scenario);
  setSessionCookie(sessionId);
}

export async function startMockServer() {
  await db.load();
  const scenario = readDevSettings().scenario;
  if (db.isEmpty() || localStorage.getItem(SEEDED_KEY) !== scenario) await loadScenario(scenario);
  const worker = setupWorker(...handlers);
  await worker.start({
    onUnhandledRequest: (req, print) => {
      if (new URL(req.url).pathname.startsWith("/v1/")) print.warning();
    },
    quiet: true,
  });
}
