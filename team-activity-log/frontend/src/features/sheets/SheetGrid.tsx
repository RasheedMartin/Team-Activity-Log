import { ArrowDownwardRounded, ArrowUpwardRounded } from "@mui/icons-material";
import { Box, ButtonBase, Paper } from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { SheetCell, SheetColumn } from "../../api/contract";
import { colIndex, fmtCell, type Sort } from "../../lib/sheetData";
import { TYPE_ICON, WIDTH } from "./columnTypes";

const ROW_H = 36;
const NUM_W = 56;

/** The raw text a cell edits as (numbers without thousands separators). */
const editText = (v: SheetCell | undefined) => (v === null || v === undefined ? "" : String(v));

export interface Active {
  r: number; // index into `shown`
  c: number; // index into `columns`
}

/**
 * A tab's rows, only the visible ones in the page (tabs hold up to 50,000). Read-only, or edited
 * like a spreadsheet: arrows move, Enter or typing edits, Enter/Tab save and move, Esc cancels,
 * Delete clears. On touch: tap a cell, tap it again to edit. Row numbers select rows.
 */
export function SheetGrid({
  columns,
  rows,
  shown,
  sort,
  editable,
  pending,
  selectedRows,
  onSelectRow,
  onHeader,
  onSet,
  active,
  setActive,
}: {
  columns: SheetColumn[];
  rows: SheetCell[][];
  shown: number[];
  sort: Sort;
  editable: boolean;
  /** Values saving now, shown in place until the server answers: "rowIndex:key" → value. */
  pending: Map<string, SheetCell>;
  selectedRows: Set<number>;
  onSelectRow: (rowIndex: number, range: boolean) => void;
  onHeader: (el: HTMLElement, col: SheetColumn) => void;
  onSet: (rowIndex: number, col: SheetColumn, value: string) => void;
  active: Active | null;
  setActive: (a: Active | null) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditingState] = useState<{ value: string } | null>(null);
  // The editor's state, readable synchronously: Enter saves, then the input's blur must not save again.
  const editRef = useRef<{ value: string } | null>(null);
  const setEditing = (e: { value: string } | null) => ((editRef.current = e), setEditingState(e));
  const v = useVirtualizer({ count: shown.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 12 });
  const template = `${NUM_W}px ${columns.map((c) => `${WIDTH[c.type]}px`).join(" ")}`;
  const width = NUM_W + columns.reduce((n, c) => n + WIDTH[c.type], 0);
  const cell = { px: 1.25, height: ROW_H, display: "flex", alignItems: "center", borderRight: 1, borderBottom: 1, borderColor: "divider", minWidth: 0, fontSize: "0.85rem" } as const;
  const valueAt = (r: number, col: SheetColumn) => {
    const key = `${shown[r]}:${col.key}`;
    return pending.has(key) ? pending.get(key)! : rows[shown[r]]?.[colIndex(col.key)];
  };

  // Keep the active cell in view and the editor focused.
  useEffect(() => {
    if (active) v.scrollToIndex(active.r, { align: "auto" });
  }, [active, v]);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  const move = (dr: number, dc: number) => {
    if (!active || !shown.length) return;
    setActive({ r: Math.min(Math.max(0, active.r + dr), shown.length - 1), c: Math.min(Math.max(0, active.c + dc), columns.length - 1) });
  };
  const commit = (dr: number, dc: number) => {
    const ed = editRef.current;
    if (!ed) return;
    setEditing(null);
    if (active && columns[active.c] && shown[active.r] !== undefined && ed.value !== editText(valueAt(active.r, columns[active.c]))) onSet(shown[active.r], columns[active.c], ed.value);
    move(dr, dc);
    scroller.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (editing) {
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (e.key === "Enter") commit(e.shiftKey ? -1 : 1, 0);
        else commit(0, e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setEditing(null);
        scroller.current?.focus();
      }
      return;
    }
    if (!active) return;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[e.key]) return (e.preventDefault(), move(...arrows[e.key]));
    if (e.key === "Tab") return (e.preventDefault(), move(0, e.shiftKey ? -1 : 1));
    if (!editable) return;
    if (e.key === "Enter" || e.key === "F2") return (e.preventDefault(), setEditing({ value: editText(valueAt(active.r, columns[active.c])) }));
    if ((e.key === "Delete" || e.key === "Backspace") && editText(valueAt(active.r, columns[active.c]))) return (e.preventDefault(), onSet(shown[active.r], columns[active.c], ""));
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setEditing({ value: e.key }); // typing replaces
    }
  };

  return (
    <Paper
      variant="outlined"
      ref={scroller}
      role="grid"
      aria-rowcount={shown.length + 1}
      aria-colcount={columns.length}
      aria-readonly={!editable}
      tabIndex={0}
      onKeyDown={onKey}
      onFocus={() => !active && shown.length && setActive({ r: 0, c: 0 })}
      sx={{ overflow: "auto", height: { xs: "60vh", md: "calc(100vh - 290px)" }, minHeight: 280, position: "relative", outline: "none", "&:focus-visible": { boxShadow: (t) => `0 0 0 2px ${t.palette.primary.main}` } }}
    >
      <Box sx={{ width, minWidth: "100%" }}>
        <Box role="row" sx={{ display: "grid", gridTemplateColumns: template, position: "sticky", top: 0, zIndex: 2, bgcolor: "background.paper", boxShadow: (t) => `0 1px 0 ${t.palette.divider}` }}>
          <Box sx={{ ...cell, position: "sticky", left: 0, bgcolor: "background.paper", zIndex: 1 }} />
          {columns.map((c) => (
            <ButtonBase
              key={c.key}
              role="columnheader"
              aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
              onClick={(e) => onHeader(e.currentTarget, c)}
              sx={{ ...cell, justifyContent: c.type === "number" ? "flex-end" : "flex-start", gap: 0.5, fontWeight: 600, "&:hover": { bgcolor: "action.hover" } }}
            >
              <Box component="span" sx={{ color: "text.disabled", display: "flex" }} aria-hidden>{TYPE_ICON[c.type]}</Box>
              <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</Box>
              {sort?.key === c.key && (sort.dir === "asc" ? <ArrowUpwardRounded sx={{ fontSize: 14 }} /> : <ArrowDownwardRounded sx={{ fontSize: 14 }} />)}
            </ButtonBase>
          ))}
        </Box>
        <Box sx={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((it) => {
            const i = shown[it.index];
            const picked = selectedRows.has(i);
            return (
              <Box key={it.key} role="row" aria-rowindex={it.index + 2} aria-selected={picked || undefined} sx={{ display: "grid", gridTemplateColumns: template, position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${it.start}px)`, "& > *": picked ? { bgcolor: "action.selected" } : {}, "&:hover > *": { bgcolor: picked ? "action.selected" : "action.hover" } }}>
                <ButtonBase
                  aria-label={`Row ${i + 1}${picked ? ", selected" : ""}`}
                  aria-pressed={picked}
                  onClick={(e) => onSelectRow(i, e.shiftKey)}
                  sx={{ ...cell, position: "sticky", left: 0, zIndex: 1, bgcolor: "background.paper", color: picked ? "primary.main" : "text.disabled", fontWeight: picked ? 700 : 400, justifyContent: "flex-end", fontSize: "0.75rem", fontVariantNumeric: "tabular-nums" }}
                >
                  {i + 1}
                </ButtonBase>
                {columns.map((c, ci) => {
                  const isActive = active?.r === it.index && active.c === ci;
                  const value = valueAt(it.index, c);
                  const text = fmtCell(value, c.type);
                  const saving = pending.has(`${i}:${c.key}`);
                  return (
                    <Box
                      key={c.key}
                      role="gridcell"
                      aria-selected={isActive || undefined}
                      title={text.length > 24 ? text : undefined}
                      onClick={() => (isActive && editable && !editing ? setEditing({ value: editText(value) }) : setActive({ r: it.index, c: ci }))}
                      onDoubleClick={() => editable && (setActive({ r: it.index, c: ci }), setEditing({ value: editText(value) }))}
                      sx={{
                        ...cell,
                        position: "relative",
                        justifyContent: c.type === "number" ? "flex-end" : "flex-start",
                        fontVariantNumeric: c.type === "number" ? "tabular-nums" : undefined,
                        color: saving ? "text.secondary" : undefined,
                        cursor: editable ? "cell" : "default",
                        ...(isActive ? { outline: 2, outlineColor: "primary.main", outlineOffset: -2, zIndex: 1 } : {}),
                      }}
                    >
                      {isActive && editing ? (
                        <Box
                          component="input"
                          ref={input}
                          aria-label={`${c.name}, row ${i + 1}`}
                          value={editing.value}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setEditing({ value: e.target.value })}
                          onBlur={() => commit(0, 0)}
                          inputMode={c.type === "number" ? "decimal" : undefined}
                          sx={{ position: "absolute", inset: 0, px: 1.25, border: 0, outline: 2, outlineColor: "primary.main", outlineStyle: "solid", outlineOffset: -2, font: "inherit", fontSize: { xs: 16, sm: "0.85rem" }, bgcolor: "background.paper", color: "text.primary", textAlign: c.type === "number" ? "right" : "left" }}
                        />
                      ) : (
                        <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Paper>
  );
}
