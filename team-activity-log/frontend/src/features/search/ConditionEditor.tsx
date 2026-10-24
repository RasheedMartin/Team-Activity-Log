import { Autocomplete, Chip, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup } from "@mui/material";
import type { Condition, DatePreset, DateRangeValue, ID } from "../../api/contract";
import { useCollections } from "../../api/hooks";
import { PeoplePicker, TagPicker } from "../../components/Pickers";
import { PRESET_LABELS } from "../../lib/dates";
import { useWs } from "../../app/session";
import { fieldDef, IMAGE_TYPE_LABELS, OP_LABEL } from "./fields";

export function DateRangeEditor({ value, onChange }: { value: DateRangeValue; onChange: (v: DateRangeValue) => void }) {
  const preset = "preset" in value ? value.preset : "custom";
  const abs = "preset" in value ? {} : value;
  return (
    <Stack spacing={1}>
      <TextField select size="small" label="Range" value={preset} onChange={(e) => onChange(e.target.value === "custom" ? {} : { preset: e.target.value as DatePreset })}>
        {(Object.keys(PRESET_LABELS) as DatePreset[]).map((p) => (
          <MenuItem key={p} value={p}>{PRESET_LABELS[p]}</MenuItem>
        ))}
        <MenuItem value="custom">Custom range…</MenuItem>
      </TextField>
      {preset === "custom" && (
        <Stack direction="row" spacing={1}>
          <TextField size="small" type="date" label="From" value={abs.from ?? ""} onChange={(e) => onChange({ ...abs, from: e.target.value || undefined })} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField size="small" type="date" label="To" value={abs.to ?? ""} onChange={(e) => onChange({ ...abs, to: e.target.value || undefined })} slotProps={{ inputLabel: { shrink: true } }} />
        </Stack>
      )}
    </Stack>
  );
}

/** Edits one condition's operator and value according to its field kind. */
export function ConditionEditor({ cond, onChange }: { cond: Condition; onChange: (c: Condition) => void }) {
  const { org, ws } = useWs();
  const { data: collections = [] } = useCollections(org.id, ws.id);
  const def = fieldDef(cond.field);
  if (!def) return null;
  const set = (patch: Partial<Condition>) => onChange({ ...cond, ...patch });
  const ids = Array.isArray(cond.value) ? (cond.value as ID[]) : [];
  const opPicker =
    def.ops.length > 1 ? (
      <TextField select size="small" value={cond.op} onChange={(e) => set({ op: e.target.value as Condition["op"] })} sx={{ minWidth: 130 }} inputProps={{ "aria-label": "Operator" }}>
        {def.ops.map((o) => <MenuItem key={o} value={o}>{OP_LABEL[o]}</MenuItem>)}
      </TextField>
    ) : null;

  switch (def.kind) {
    case "flag":
      return (
        <ToggleButtonGroup size="small" exclusive value={cond.value !== false} onChange={(_, v) => v !== null && set({ value: v })} aria-label={def.label}>
          <ToggleButton value={true}>Yes</ToggleButton>
          <ToggleButton value={false}>No</ToggleButton>
        </ToggleButtonGroup>
      );
    case "visibility":
      return (
        <ToggleButtonGroup size="small" exclusive value={cond.value} onChange={(_, v) => v && set({ value: v })} aria-label="Hidden posts">
          <ToggleButton value="any">Include hidden</ToggleButton>
          <ToggleButton value="hidden">Hidden only</ToggleButton>
        </ToggleButtonGroup>
      );
    case "tags":
      return (
        <Stack spacing={1}>
          {opPicker}
          <TagPicker orgId={org.id} value={ids} onChange={(v) => set({ value: v })} canCreate={false} />
        </Stack>
      );
    case "people":
      return (
        <Stack spacing={1}>
          {opPicker}
          <PeoplePicker orgId={org.id} value={ids} onChange={(v) => set({ value: v })} />
        </Stack>
      );
    case "collection":
      return (
        <Stack spacing={1}>
          {opPicker}
          <Autocomplete
            multiple
            size="small"
            options={collections}
            value={collections.filter((c) => ids.includes(c.id))}
            getOptionLabel={(c) => c.name}
            onChange={(_, v) => set({ value: v.map((c) => c.id) })}
            renderInput={(p) => <TextField {...p} label="Collections" />}
          />
        </Stack>
      );
    case "imageType":
      return (
        <Stack spacing={1}>
          {opPicker}
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {Object.entries(IMAGE_TYPE_LABELS).map(([t, label]) => (
              <Chip key={t} label={label} variant={ids.includes(t) ? "filled" : "outlined"} color={ids.includes(t) ? "primary" : "default"} onClick={() => set({ value: ids.includes(t) ? ids.filter((x) => x !== t) : [...ids, t] })} />
            ))}
          </Stack>
        </Stack>
      );
    case "date":
      return <DateRangeEditor value={(cond.value as DateRangeValue) ?? {}} onChange={(v) => set({ value: v })} />;
    case "number":
      return <TextField size="small" type="number" label={def.label} value={cond.value ?? ""} onChange={(e) => set({ value: Number(e.target.value) })} slotProps={{ htmlInput: { min: 0, step: 100 } }} />;
    case "keyValue": {
      const kv = (cond.value ?? {}) as { key?: string; value?: string };
      return (
        <Stack direction="row" spacing={1}>
          <TextField size="small" label="Field" placeholder="run_id" value={kv.key ?? ""} onChange={(e) => set({ value: { ...kv, key: e.target.value } })} />
          <TextField size="small" label="Value (optional)" value={kv.value ?? ""} onChange={(e) => set({ value: { ...kv, value: e.target.value || undefined } })} />
        </Stack>
      );
    }
    default:
      return (
        <Stack direction="row" spacing={1}>
          {opPicker}
          <TextField size="small" autoFocus label={def.label} value={String(cond.value ?? "")} onChange={(e) => set({ value: e.target.value })} sx={{ flex: 1 }} />
        </Stack>
      );
  }
}
