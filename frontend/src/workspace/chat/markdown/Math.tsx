import { memo, useLayoutEffect, useRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import styles from "./style.module.css";

export const Math = memo(function Math({ value, display }: {
  readonly value: string;
  readonly display: boolean;
}): React.JSX.Element {
  const container = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = container.current;
    if (element === null) return;
    element.removeAttribute("title");
    try {
      katex.render(value, element, {
        displayMode: display,
        throwOnError: false,
        strict: "ignore",
        trust: false,
        maxExpand: 1000,
        maxSize: 20,
        output: "htmlAndMathml",
      });
    } catch (error) {
      element.textContent = value;
      element.title = error instanceof Error ? error.message : "公式无法排版";
    }
  }, [value, display]);

  return <span ref={container} data-math={display ? "block" : "inline"}
    className={display ? styles.mathBlock : styles.mathInline}
    {...(display ? { tabIndex: 0, role: "region", "aria-label": "数学公式" } : {})} />;
});
