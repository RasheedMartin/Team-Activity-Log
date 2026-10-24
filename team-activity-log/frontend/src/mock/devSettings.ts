// Dev-only mock controls (§A3 scenarios). Read before MSW starts, so they live in localStorage.

export type DataScenario = "empty" | "small" | "busy" | "multiOrg" | "viewer";

export interface DevSettings {
  scenario: DataScenario;
  slowNetwork: boolean;
  randomErrors: boolean;
  indexLag: boolean;
  liveActivity: boolean;
}

export const SCENARIOS: { id: DataScenario; label: string; description: string }[] = [
  { id: "empty", label: "Empty org", description: "One owner, one empty workspace" },
  { id: "small", label: "Small team", description: "6 people, 20 posts" },
  { id: "busy", label: "Busy org", description: "5,000 posts, 800 images, 12 people, 60 tags, 3 years" },
  { id: "multiOrg", label: "Multi-org user", description: "Small team plus a second org" },
  { id: "viewer", label: "Viewer only", description: "Small team, signed in as a viewer" },
];

const KEY = "tal.dev";
const DEFAULTS: DevSettings = {
  scenario: "small",
  slowNetwork: false,
  randomErrors: false,
  indexLag: false,
  liveActivity: true,
};

export function readDevSettings(): DevSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function writeDevSettings(patch: Partial<DevSettings>): DevSettings {
  const next = { ...readDevSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage blocked: settings apply for this page only
  }
  return next;
}
