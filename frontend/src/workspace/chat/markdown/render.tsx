import { Fragment, createElement, type ReactNode } from "react";
import type { Definition, FootnoteDefinition, Nodes, Root } from "mdast";

import { externalHref } from "../../../../shared/link.js";
import styles from "./style.module.css";
import { Math } from "./Math.js";

export function renderMarkdown(root: Root, id: string): ReactNode {
  const definitions = new Map<string, Definition>();
  const footnotes = new Map<string, FootnoteDefinition>();
  function collect(node: Nodes): void {
    if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    if (node.type === "footnoteDefinition" && !footnotes.has(node.identifier)) footnotes.set(node.identifier, node);
    if ("children" in node) node.children.forEach(collect);
  }
  collect(root);
  const referenced: string[] = [];
  function children(node: Extract<Nodes, { children: unknown }>): ReactNode {
    return node.children.map((child, index) => <Fragment key={child.position?.start.offset ?? index}>{render(child)}</Fragment>);
  }
  function link(url: string, title: string | null | undefined, content: ReactNode): ReactNode {
    const href = externalHref(url);
    return href === null ? content : <a href={href} title={title ?? undefined} target="_blank" rel="noopener noreferrer">{content}</a>;
  }
  function render(node: Nodes): ReactNode {
    switch (node.type) {
      case "root": return children(node);
      case "text": return node.value;
      case "paragraph": return <p>{children(node)}</p>;
      case "heading": return createElement(`h${node.depth}`, null, children(node));
      case "strong": return <strong>{children(node)}</strong>;
      case "emphasis": return <em>{children(node)}</em>;
      case "delete": return <del>{children(node)}</del>;
      case "blockquote": return <blockquote>{children(node)}</blockquote>;
      case "break": return <br />;
      case "thematicBreak": return <hr />;
      case "inlineCode": return <code>{node.value}</code>;
      case "inlineMath": return <Math value={node.value} display={false} />;
      case "math": return <Math value={node.value} display />;
      case "code": return <div className={styles.codeBlock}>
        {node.lang && <div className={styles.language}>{node.lang}</div>}
        <pre tabIndex={0} aria-label="代码块"><code>{node.value}</code></pre>
      </div>;
      case "html":
      case "yaml": return node.value;
      case "link": return link(node.url, node.title, children(node));
      case "linkReference": {
        const definition = definitions.get(node.identifier);
        return definition ? link(definition.url, definition.title, children(node)) : children(node);
      }
      case "image":
      case "imageReference": return node.alt ?? "";
      case "list": return node.ordered
        ? <ol start={node.start ?? 1}>{children(node)}</ol>
        : <ul>{children(node)}</ul>;
      case "listItem": return <li>
        {typeof node.checked === "boolean" && <input type="checkbox" checked={node.checked} disabled aria-label={node.checked ? "已完成" : "未完成"} />}
        {children(node)}
      </li>;
      case "table": return <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="表格">
        <table>
          <thead><tr>{node.children[0]?.children.map((cell, index) => <th key={index} style={{ textAlign: node.align?.[index] ?? undefined }}>{children(cell)}</th>)}</tr></thead>
          <tbody>{node.children.slice(1).map((row, index) => <tr key={row.position?.start.offset ?? index}>
            {row.children.map((cell, column) => <td key={column} style={{ textAlign: node.align?.[column] ?? undefined }}>{children(cell)}</td>)}
          </tr>)}</tbody>
        </table>
      </div>;
      case "tableRow":
      case "tableCell": return children(node);
      case "footnoteReference": {
        if (!footnotes.has(node.identifier)) return `[^${node.identifier}]`;
        if (!referenced.includes(node.identifier)) referenced.push(node.identifier);
        const number = referenced.indexOf(node.identifier) + 1;
        return <sup><a href={`#${id}-note-${number}`} aria-label={`脚注 ${number}`}>{number}</a></sup>;
      }
      case "definition":
      case "footnoteDefinition": return null;
    }
    const unsupported: never = node;
    return unsupported;
  }
  const content = render(root);
  const notes: ReactNode[] = [];
  for (let index = 0; index < referenced.length; index += 1) {
    const note = footnotes.get(referenced[index]!);
    if (note) notes.push(<li key={note.identifier} id={`${id}-note-${index + 1}`}>{children(note)}</li>);
  }
  return <>{content}{notes.length > 0 && <section aria-label="脚注"><hr /><ol>{notes}</ol></section>}</>;
}
