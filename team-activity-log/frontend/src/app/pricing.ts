/**
 * Plans as shown on the landing page. Draft numbers (docs/PRICING.md); the backend enforces the
 * same limits from backend/src/tal/plans.py — change both together.
 */
export type Plan = { id: "free" | "team" | "business" | "enterprise"; name: string; price: string; per?: string; note?: string; features: string[]; cta: string; highlight?: boolean };

export const PLANS: Plan[] = [
  { id: "free", name: "Free", price: "$0", note: "Up to 10 people", features: ["1 workspace", "2 GB storage", "5 slide imports a month", "Full search history"], cta: "Get started" },
  { id: "team", name: "Team", price: "$8", per: "per member / month, yearly", note: "14-day free trial, no card needed", features: ["Unlimited workspaces and imports", "10 GB per member", "Private workspaces", "Email support"], cta: "Start free trial", highlight: true },
  { id: "business", name: "Business", price: "$16", per: "per member / month, yearly", features: ["Everything in Team", "25 GB per member", "SSO, SCIM, and audit log (coming soon)", "Priority support"], cta: "Start free trial" },
  { id: "enterprise", name: "Enterprise", price: "Custom", features: ["Self-hosted or region-pinned", "Dedicated search index", "SLA and onboarding"], cta: "Contact us" },
];

/** What an upgrade costs, per member per month (yearly is billed once a year). */
export const UPGRADE_PRICES: Record<"team" | "business", Record<"month" | "year", string>> = {
  team: { month: "$10", year: "$8" },
  business: { month: "$20", year: "$16" },
};

export const ACADEMIC_NOTE = "50% off for universities, national labs, and nonprofits.";
