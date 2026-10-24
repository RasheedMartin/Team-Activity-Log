import type { DatePreset, DateRangeValue, Interval, ISODate } from "../api/contract";

// All bucketing runs in UTC on calendar days. workDate is a plain date; timestamps are
// truncated to their UTC day (see DECISIONS.md: histogram time zone).

export type FixedInterval = Exclude<Interval, "auto">;
const DAY = 86_400_000;

export const toISODate = (d: Date): ISODate => d.toISOString().slice(0, 10);
export const parseISODate = (s: string): Date => new Date(`${s.slice(0, 10)}T00:00:00Z`);
export const todayISO = (now = new Date()): ISODate => toISODate(now);
export const addDays = (s: ISODate, n: number): ISODate =>
  toISODate(new Date(parseISODate(s).getTime() + n * DAY));
export const daysBetween = (a: ISODate, b: ISODate) =>
  Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / DAY);

/** Start of the calendar bucket containing `d` (weeks start Monday, like ES calendar_interval). */
export function bucketStart(d: Date, interval: FixedInterval): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (interval) {
    case "day":
      return new Date(Date.UTC(y, m, d.getUTCDate()));
    case "week": {
      const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      return new Date(Date.UTC(y, m, d.getUTCDate() - dow));
    }
    case "month":
      return new Date(Date.UTC(y, m, 1));
    case "quarter":
      return new Date(Date.UTC(y, m - (m % 3), 1));
    case "year":
      return new Date(Date.UTC(y, 0, 1));
  }
}

export function nextBucket(d: Date, interval: FixedInterval): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  switch (interval) {
    case "day":
      return new Date(Date.UTC(y, m, day + 1));
    case "week":
      return new Date(Date.UTC(y, m, day + 7));
    case "month":
      return new Date(Date.UTC(y, m + 1, 1));
    case "quarter":
      return new Date(Date.UTC(y, m + 3, 1));
    case "year":
      return new Date(Date.UTC(y + 1, 0, 1));
  }
}

/** §W4.2 auto interval: ≤60 days → day · ≤1 year → week · ≤4 years → month · ≤10 years → quarter · else year. */
export function autoInterval(from: ISODate, to: ISODate): FixedInterval {
  const days = daysBetween(from, to) + 1;
  if (days <= 60) return "day";
  if (days <= 366) return "week";
  if (days <= 4 * 366) return "month";
  if (days <= 10 * 366) return "quarter";
  return "year";
}

/** Resolve a stored range (absolute or relative preset) to concrete inclusive dates. */
export function resolveRange(
  v: DateRangeValue,
  now = new Date(),
): { from?: ISODate; to?: ISODate } {
  if (!("preset" in v)) return v;
  const today = todayISO(now);
  const preset: DatePreset = v.preset;
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "last_7_days":
      return { from: addDays(today, -6), to: today };
    case "last_30_days":
      return { from: addDays(today, -29), to: today };
    case "last_90_days":
      return { from: addDays(today, -89), to: today };
    case "this_quarter":
      return { from: toISODate(bucketStart(now, "quarter")), to: today };
    case "this_year":
      return { from: toISODate(bucketStart(now, "year")), to: today };
  }
}

export const PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  this_quarter: "This quarter",
  this_year: "This year",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDay(s: ISODate, withYear = true): string {
  const d = parseISODate(s);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ""}`;
}

export function formatRange(from?: ISODate, to?: ISODate): string {
  if (from && to) {
    if (from === to) return formatDay(from);
    const sameYear = from.slice(0, 4) === to.slice(0, 4);
    return `${formatDay(from, !sameYear)} – ${formatDay(to)}`;
  }
  if (from) return `after ${formatDay(from)}`;
  if (to) return `before ${formatDay(to)}`;
  return "All time";
}

/** Label for a histogram bucket at a given interval (axis ticks and tooltips). */
export function formatBucket(startIso: string, interval: FixedInterval, long = false): string {
  const d = new Date(startIso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (interval) {
    case "day":
      return long ? formatDay(toISODate(d)) : `${d.getUTCDate()} ${MONTHS[m]}`;
    case "week":
      return long ? `Week of ${formatDay(toISODate(d))}` : `${d.getUTCDate()} ${MONTHS[m]}`;
    case "month":
      return long ? `${MONTHS[m]} ${y}` : MONTHS[m];
    case "quarter":
      return `Q${Math.floor(m / 3) + 1} ${y}`;
    case "year":
      return String(y);
  }
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return formatDay(iso.slice(0, 10), new Date(iso).getUTCFullYear() !== new Date(now).getUTCFullYear());
}
