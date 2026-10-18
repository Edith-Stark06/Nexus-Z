/**
 * A small, safe reader for the Markdown-like text a hosted model writes. It returns plain data (blocks of inline
 * pieces); the chat renders that data as React elements, so nothing is ever put into the page as HTML.
 *
 * Understood: paragraphs (blank line between), line breaks inside a paragraph, **bold**, `code`, bullet lists
 * ("- " or "* " or "• "), numbered lists ("1. " or "1) "), and headings ("# " to "####", shown as bold lines).
 * Anything else, including tables, links and raw HTML, stays as ordinary text.
 */
export const MAX_RICH_CHARS = 8000;

/** Split one line into text, bold and code pieces. An unmatched ** or ` is left as it is. */
export function inline(text) {
  const out = [];
  const pattern = /\*\*([^*][\s\S]*?)\*\*|`([^`\n]+)`/g;
  let last = 0;
  let m;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "bold", v: m[1] });
    else out.push({ t: "code", v: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

const BULLET = /^\s{0,3}(?:[-*•])\s+(.*)$/;
const NUMBER = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,4}\s+(.*)$/;

/** Parse text into blocks: { type: "p" | "ul" | "ol" | "h", lines | items | text }. */
export function parseRich(input) {
  const text = String(input ?? "").replace(/\r\n?/g, "\n").slice(0, MAX_RICH_CHARS);
  const blocks = [];
  let para = null;
  let list = null;
  const flush = () => {
    if (para) blocks.push({ type: "p", lines: para.map(inline) });
    if (list) blocks.push({ type: list.type, items: list.items.map(inline), start: list.start });
    para = null;
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const h = HEADING.exec(line);
    if (h) { flush(); blocks.push({ type: "h", text: inline(h[1]) }); continue; }
    const b = BULLET.exec(line);
    const n = NUMBER.exec(line);
    if (b || n) {
      const type = b ? "ul" : "ol";
      if (!list || list.type !== type) { flush(); list = { type, items: [], start: n ? Number(n[1]) : 1 }; }
      list.items.push(b ? b[1] : n[2]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; } // a wrapped list item
    if (list) flush();
    (para = para || []).push(line.trim());
  }
  flush();
  return blocks;
}
