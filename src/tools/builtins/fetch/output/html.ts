import { gfm } from "@joplin/turndown-plugin-gfm";
import TurndownService from "turndown";

import { FetchError } from "../errors.js";

const MAX_HTML_DEPTH = 512;
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "noscript"]);
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const converter = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
converter.use(gfm);
converter.addRule("removeNonContent", {
  filter(node) {
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED"]
      .includes(node.nodeName)) return true;
    if (node.hasAttribute("hidden") ||
        node.getAttribute("aria-hidden")?.toLowerCase() === "true") return true;
    const declarations = node.getAttribute("style")?.split(";") ?? [];
    return declarations.some((declaration: string) => {
      const separator = declaration.indexOf(":");
      if (separator === -1) return false;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration.slice(separator + 1).trim().toLowerCase()
        .replace(/\s*!important\s*$/u, "");
      return property === "display" && value === "none" ||
        property === "visibility" && ["hidden", "collapse"].includes(value);
    });
  },
  replacement() {
    return "";
  },
});

/** Convert one complete HTML document to Markdown without returning raw markup. */
export function htmlToMarkdown(html: string): string {
  if (exceedsHtmlDepth(html)) {
    throw new FetchError("conversion-failed", "Fetch HTML nesting is too deep.");
  }
  try {
    return converter.turndown(html).trim();
  } catch (error: unknown) {
    throw new FetchError("conversion-failed", "Fetch HTML conversion failed.", {
      cause: error,
    });
  }
}

/** Conservatively detect markup that would create a deeply recursive DOM. */
export function exceedsHtmlDepth(html: string): boolean {
  const lower = html.toLowerCase();
  const open: string[] = [];
  let offset = 0;
  let inComment = false;
  while (offset < html.length) {
    const start = html.indexOf("<", offset);
    if (inComment) {
      const end = html.indexOf("-->", offset);
      if (end !== -1 && (start === -1 || end < start)) {
        inComment = false;
        offset = end + 3;
        continue;
      }
    }
    if (start === -1) break;
    if (!inComment && html.startsWith("<!--", start)) {
      inComment = true;
      offset = start + 4;
      continue;
    }
    let cursor = start + 1;
    const closing = html[cursor] === "/";
    if (closing) cursor += 1;
    const nameStart = cursor;
    while (/[a-zA-Z0-9-]/.test(html[cursor] ?? "")) cursor += 1;
    if (cursor === nameStart || !/[a-zA-Z]/.test(html[nameStart] ?? "")) {
      offset = start + 1;
      continue;
    }
    const name = lower.slice(nameStart, cursor);
    let quote: "\"" | "'" | undefined;
    while (cursor < html.length) {
      const character = html[cursor];
      cursor += 1;
      if (quote !== undefined) {
        if (character === quote) quote = undefined;
      } else if (character === "\"" || character === "'") {
        quote = character;
      } else if (character === ">") break;
    }
    if (html[cursor - 1] !== ">") break;
    if (closing) {
      if (!inComment && open.at(-1) === name) open.pop();
    } else {
      let last = cursor - 2;
      while (/\s/.test(html[last] ?? "")) last -= 1;
      if (!VOID_ELEMENTS.has(name) && html[last] !== "/") {
        open.push(name);
        if (open.length > MAX_HTML_DEPTH) return true;
        if (!inComment && RAW_TEXT_ELEMENTS.has(name)) {
          const end = findRawTextEnd(lower, name, cursor);
          if (end === -1) break;
          offset = end;
          continue;
        }
      }
    }
    offset = cursor;
  }
  return false;
}

function findRawTextEnd(lower: string, name: string, from: number): number {
  const prefix = `</${name}`;
  let candidate = lower.indexOf(prefix, from);
  while (candidate !== -1 &&
      !isTagBoundary(lower[candidate + prefix.length])) {
    candidate = lower.indexOf(prefix, candidate + prefix.length);
  }
  return candidate;
}

function isTagBoundary(value: string | undefined): boolean {
  return value === undefined || value === ">" || value === "/" || /\s/.test(value);
}
