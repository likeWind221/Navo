import { memo, useId, useMemo } from "react";
import { parseMarkdown } from "./markdown/parse.js";

import { renderMarkdown } from "./markdown/render.js";
import styles from "./markdown/style.module.css";

export const Markdown = memo(function Markdown({ text, streaming = false }: {
  readonly text: string;
  readonly streaming?: boolean;
}): React.JSX.Element {
  const id = useId();
  const content = useMemo(() => renderMarkdown(parseMarkdown(text, streaming), id), [text, streaming, id]);

  return <div className={styles.markdown}>{content}</div>;
});
