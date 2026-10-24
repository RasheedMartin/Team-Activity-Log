import { Box, Link, type SxProps, type Theme } from "@mui/material";
import type { ReactNode } from "react";
import type { PMNode } from "../lib/prosemirror";
import { proseSx } from "../theme/prose";

// Render ProseMirror JSON as React elements. Never uses innerHTML (§B12: no raw HTML),
// and only http(s)/mailto links survive.

const SAFE_HREF = /^(https?:|mailto:)/i;

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
      return <p key={key}>{kids()}</p>;
    case "heading": {
      const level = Math.min(4, Math.max(2, Number(node.attrs?.level ?? 2)));
      const Tag = `h${level}` as "h2";
      return <Tag key={key}>{kids()}</Tag>;
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
    case "table":
      return (
        <Box key={key} sx={{ overflowX: "auto" }}>
          <table>
            <tbody>{kids()}</tbody>
          </table>
        </Box>
      );
    case "tableRow":
      return <tr key={key}>{kids()}</tr>;
    case "tableHeader":
      return <th key={key} colSpan={Number(node.attrs?.colspan ?? 1)} rowSpan={Number(node.attrs?.rowspan ?? 1)}>{kids()}</th>;
    case "tableCell":
      return <td key={key} colSpan={Number(node.attrs?.colspan ?? 1)} rowSpan={Number(node.attrs?.rowspan ?? 1)}>{kids()}</td>;
    default:
      return <>{kids()}</>;
  }
}

export function RichText({ doc, sx }: { doc: unknown; sx?: SxProps<Theme> }) {
  return <Box sx={[proseSx, ...(Array.isArray(sx) ? sx : [sx])]}>{render(doc as PMNode, 0)}</Box>;
}
