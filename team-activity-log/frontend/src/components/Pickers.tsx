import { Autocomplete, createFilterOptions, TextField } from "@mui/material";
import { useMemo } from "react";
import type { ID, Tag, User } from "../api/contract";
import { useCreateTag, usePeople, useTags } from "../api/hooks";
import { TagChip, TagDot, UserAvatar } from "./ui";

type TagOption = Tag & { group: string; create?: string };
const filter = createFilterOptions<TagOption>({ stringify: (o) => `${o.name} ${o.group}` });

/** Typeahead tag picker, grouped by tag group, color-coded, with inline create (§W2.2). */
export function TagPicker({ orgId, value, onChange, label = "Tags", disabled, canCreate = true }: { orgId: ID; value: ID[]; onChange: (ids: ID[]) => void; label?: string; disabled?: boolean; canCreate?: boolean }) {
  const { data } = useTags(orgId);
  const create = useCreateTag(orgId);
  const options = useMemo<TagOption[]>(() => {
    const groups = new Map(data?.groups.map((g) => [g.id, g.name]));
    return (data?.tags ?? [])
      .map((t) => ({ ...t, group: (t.groupId && groups.get(t.groupId)) || "Other" }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  }, [data]);
  const selected = value.map((id) => options.find((o) => o.id === id)).filter((o): o is TagOption => !!o);
  return (
    <Autocomplete
      multiple
      disabled={disabled}
      options={options}
      value={selected}
      groupBy={(o) => o.group}
      getOptionLabel={(o) => o.create ? `Create “${o.create}”` : o.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(opts, state) => {
        const res = filter(opts, state);
        const q = state.inputValue.trim().toLowerCase().replace(/\s+/g, "-");
        if (canCreate && q && !opts.some((o) => o.name.toLowerCase() === q)) res.push({ id: `__create:${q}`, name: q, color: "#64748b", group: "New tag", create: q });
        return res;
      }}
      onChange={async (_, v) => {
        const created = v.find((o) => o.create);
        if (created) {
          const tag = await create.mutateAsync({ name: created.create! });
          onChange([...v.filter((o) => !o.create).map((o) => o.id), tag.id]);
        } else onChange(v.map((o) => o.id));
      }}
      renderOption={(props, o) => (
        <li {...props} key={o.id}>
          <TagDot color={o.color} />
          <span style={{ marginLeft: 8 }}>{o.create ? `Create “${o.create}”` : o.name}</span>
        </li>
      )}
      renderValue={(vals, getItemProps) => vals.map((t, i) => {
        const { key, onDelete } = getItemProps({ index: i });
        return <TagChip key={key} tag={t} onDelete={disabled ? undefined : onDelete} />;
      })}
      renderInput={(p) => <TextField {...p} label={label} placeholder={selected.length ? "" : "Add tags"} />}
    />
  );
}

/** People picker (co-authors, workspace members). */
export function PeoplePicker({ orgId, value, onChange, exclude = [], label = "People", disabled }: { orgId: ID; value: ID[]; onChange: (ids: ID[]) => void; exclude?: ID[]; label?: string; disabled?: boolean }) {
  const { data: people = [] } = usePeople(orgId);
  const options = people.filter((p) => !exclude.includes(p.id));
  const selected = value.map((id) => people.find((p) => p.id === id)).filter((u): u is User => !!u);
  return (
    <Autocomplete
      multiple
      disabled={disabled}
      options={options}
      value={selected}
      getOptionLabel={(u) => u.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_, v) => onChange(v.map((u) => u.id))}
      renderOption={(props, u) => (
        <li {...props} key={u.id}>
          <UserAvatar user={u} size={22} sx={{ mr: 1 }} />
          {u.name}
        </li>
      )}
      renderInput={(p) => <TextField {...p} label={label} />}
    />
  );
}
