import { Box, Link, type SxProps, type Theme } from "@mui/material";
import type { CSSProperties, ReactNode } from "react";
import type { PMNode } from "../lib/prosemirror";
import { fontStack } from "../lib/slideFonts";
import { proseSx } from "../theme/prose";

// Render ProseMirror JSON as React elements. Never uses innerHTML (§B12: no raw HTML),
// and only http(s)/mailto links survive.

const SAFE_HREF = /^(https?:|mailto:)/i;
const HEX = /^#[0-9a-f]{6}$/i; // colors are only ever plain hex (the backend enforces it too)
const FONT_SIZE = /^\d{1,3}(\.\d)?px$/; // designed slides only, where 1 px = 1 pt
const FONT_NAME = /^[\w .-]{1,64}$/;
const cellStyle = (node: PMNode) => {
  const bg = String(node.attrs?.background ?? "");
  const color = String(node.attrs?.color ?? "");
  return { ...(HEX.test(bg) ? { background: bg } : {}), ...(HEX.test(color) ? { color } : {}) } as CSSProperties;
};
/** Column widths from the first row's cells, when every cell has them (designed slides). */
const tableWidths = (node: PMNode): number[] | undefined => {
  const cells = node.content?.[0]?.content ?? [];
  const widths = cells.flatMap((c) => (Array.isArray(c.attrs?.colwidth) ? (c.attrs!.colwidth as unknown[]).map(Number) : [NaN]));
  return widths.length && widths.every((w) => Number.isFinite(w) && w > 0) ? widths : undefined;
};
const ALIGN = new Set(["left", "center", "right", "justify"]);
const align = (node: PMNode) => (ALIGN.has(String(node.attrs?.textAlign)) ? { textAlign: node.attrs!.textAlign as "center" } : undefined);

function marks(node: PMNode, child: ReactNode, key: number): ReactNode {
  return (node.marks ?? []).reduce<ReactNode>((acc, m, i) => {
    const k = `${key}-${i}`;
    switch (m.type) {
      case "bold":
        return <strong key={k}>{acc}</strong>;
      case "italic":
        return <em key={k}>{acc}</em>;
      case "underline":
        return <u key={k}>{acc}</u>;
      case "strike":
        return <s key={k}>{acc}</s>;
      case "code":
        return <code key={k}>{acc}</code>;
      case "textStyle": {
        const color = String(m.attrs?.color ?? "");
        const size = String(m.attrs?.fontSize ?? "");
        const family = String(m.attrs?.fontFamily ?? "");
        const style = { ...(HEX.test(color) ? { "--tc": color } : {}), ...(FONT_SIZE.test(size) ? { fontSize: size } : {}), ...(FONT_NAME.test(family) ? { fontFamily: fontStack(family) } : {}) } as CSSProperties;
        return Object.keys(style).length ? (
          <span key={k} {...(HEX.test(color) ? { "data-tc": "" } : {})} style={style}>
            {acc}
          </span>
        ) : (
          acc
        );
      }
      case "highlight": {
        const color = String(m.attrs?.color ?? "");
        return (
          <mark key={k} data-hl="" style={HEX.test(color) ? ({ "--hl": color } as CSSProperties) : undefined}>
            {acc}
          </mark>
        );
      }
      case "link": {
        const href = String(m.attrs?.href ?? "");
        return SAFE_HREF.test(href) ? (
          <Link key={k} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {acc}
          </Link>
        ) : (
          acc
        );
      }
      default:
        return acc;
    }
  }, child);
}

function render(node: PMNode | undefined, key: number): ReactNode {
  if (!node) return null;
  const kids = () => node.content?.map((c, i) => render(c, i));
  switch (node.type) {
    case "doc":
      return <>{kids()}</>;
    case "text":
      return marks(node, node.text ?? "", key);
    case "paragraph":
      return <p key={key} style={align(node)}>{kids()}</p>;
    case "heading": {
      const level = Math.min(4, Math.max(2, Number(node.attrs?.level ?? 2)));
      const Tag = `h${level}` as "h2";
      return <Tag key={key} style={align(node)}>{kids()}</Tag>;
    }
    case "bulletList":
      return <ul key={key}>{kids()}</ul>;
    case "orderedList":
      return <ol key={key} start={Number(node.attrs?.start ?? 1)}>{kids()}</ol>;
    case "listItem":
      return <li key={key}>{kids()}</li>;
    case "blockquote":
      return <blockquote key={key}>{kids()}</blockquote>;
    case "codeBlock":
      return (
        <pre key={key}>
          <code>{node.content?.map((c) => c.text).join("")}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr key={key} />;
    case "hardBreak":
      return <br key={key} />;
    case "mention":
      return (
        <Box key={key} component="span" className="mention">
          @{String(node.attrs?.label ?? "someone")}
        </Box>
      );
    case "table": {
      const widths = tableWidths(node);
      const border = String(node.attrs?.borderColor ?? "");
      return (
        <Box key={key} className="table-wrap" sx={{ overflowX: "auto" }}>
          <table
            {...(widths ? { "data-widths": "" } : {})}
            style={{ ...(widths ? { tableLayout: "fixed", width: widths.reduce((a, b) => a + b, 0) } : {}), ...(HEX.test(border) ? { "--tb": border } : {}) } as CSSProperties}
          >
            {widths && (
              <colgroup>
                {widths.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
            )}
            <tbody>{kids()}</tbody>
          </table>
        </Box>
      );
    }
    case "tableRow":
      return <tr key={key}>{kids()}</tr>;
    case "tableHeader":
      return <th key={key} colSpan={Number(node.attrs?.colspan ?? 1)} rowSpan={Number(node.attrs?.rowspan ?? 1)} style={cellStyle(node)}>{kids()}</th>;
    case "tableCell":
      return <td key={key} colSpan={Number(node.attrs?.colspan ?? 1)} rowSpan={Number(node.attrs?.rowspan ?? 1)} style={cellStyle(node)}>{kids()}</td>;
    default:
      return <>{kids()}</>;
  }
}

export function RichText({ doc, sx }: { doc: unknown; sx?: SxProps<Theme> }) {
  return <Box sx={[proseSx, ...(Array.isArray(sx) ? sx : [sx])]}>{render(doc as PMNode, 0)}</Box>;
}
