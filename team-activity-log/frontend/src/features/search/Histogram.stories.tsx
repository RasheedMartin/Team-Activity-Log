import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { HistogramBucket, SearchResponse } from "../../api/contract";
import { tagMap } from "../../stories/fixtures";
import { Histogram, HistogramTable } from "./Histogram";

type Hist = NonNullable<SearchResponse["histogram"]>;

function weeks(n: number, f: (i: number) => number): HistogramBucket[] {
  const start = Date.UTC(2026, 0, 5);
  return Array.from({ length: n }, (_, i) => ({
    start: new Date(start + i * 7 * 86_400_000).toISOString(),
    end: new Date(start + (i + 1) * 7 * 86_400_000).toISOString(),
    count: f(i),
    topTags: f(i) ? [{ tagId: "t1", count: Math.ceil(f(i) / 2) }, { tagId: "t2", count: Math.ceil(f(i) / 4) }] : undefined,
  }));
}

const busy: Hist = { field: "workDate", interval: "week", buckets: weeks(42, (i) => Math.round(8 + 6 * Math.sin(i / 3) + (i % 11 === 0 ? 14 : 0))) };

function Interactive({ hist }: { hist: Hist }) {
  const [sel, setSel] = useState<Hist["selectedRange"]>(hist.selectedRange);
  return (
    <Box sx={{ maxWidth: 900 }}>
      <Histogram
        hist={{ ...hist, selectedRange: sel }}
        tags={tagMap}
        onSelect={(r) => setSel({ from: `${r.from}T00:00:00.000Z`, to: new Date(new Date(`${r.to}T00:00:00Z`).getTime() + 86_400_000).toISOString() })}
        onClear={() => setSel(undefined)}
      />
    </Box>
  );
}

const meta: Meta = { title: "Search/Histogram" };
export default meta;

export const Busy: StoryObj = { render: () => <Interactive hist={busy} /> };
export const WithSelection: StoryObj = {
  render: () => <Interactive hist={{ ...busy, selectedRange: { from: busy.buckets[10].start, to: busy.buckets[16].end } }} />,
};
export const Sparse: StoryObj = { render: () => <Interactive hist={{ field: "workDate", interval: "week", buckets: weeks(30, (i) => (i % 9 === 0 ? 3 : 0)) }} /> };
export const SingleBar: StoryObj = { render: () => <Interactive hist={{ field: "workDate", interval: "day", buckets: weeks(1, () => 5) }} /> };
export const Empty: StoryObj = { render: () => <Interactive hist={{ field: "workDate", interval: "week", buckets: weeks(12, () => 0) }} /> };
export const Refetching: StoryObj = {
  render: () => (
    <Box sx={{ maxWidth: 900 }}>
      <Histogram hist={busy} tags={tagMap} dimmed onSelect={() => {}} onClear={() => {}} />
    </Box>
  ),
};
export const AsTable: StoryObj = { render: () => <HistogramTable hist={busy} tags={tagMap} /> };
