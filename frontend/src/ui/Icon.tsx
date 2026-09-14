import { Arrow } from "./icon/Arrow.js";
import { Book } from "./icon/Book.js";
import { Brain } from "./icon/Brain.js";
import { Check } from "./icon/Check.js";
import { Chevron } from "./icon/Chevron.js";
import { Close } from "./icon/Close.js";
import { Guide } from "./icon/Guide.js";
import { Loader } from "./icon/Loader.js";
import { Tool } from "./icon/Tool.js";
import { Globe } from "./icon/Globe.js";
import { Terminal } from "./icon/Terminal.js";
import { Pen } from "./icon/Pen.js";

export type IconName =
  | "arrow"
  | "book"
  | "guide"
  | "brain"
  | "tool"
  | "loader"
  | "check"
  | "close"
  | "globe"
  | "terminal"
  | "pen"
  | "chevron";

const shapes: Record<IconName, () => React.JSX.Element> = {
  arrow: Arrow,
  book: Book,
  guide: Guide,
  brain: Brain,
  tool: Tool,
  loader: Loader,
  check: Check,
  close: Close,
  chevron: Chevron,
  globe: Globe,
  terminal: Terminal,
  pen: Pen,
};

export function Icon({ name, active = false }: { readonly name: IconName; readonly active?: boolean }): React.JSX.Element {
  const Shape = shapes[name];
  const id = useId();
  const maskId = `${id}-mask`;
  const gradientId = `${id}-gradient`;
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <Shape />
      {active && <>
        <defs>
          <linearGradient id={gradientId}>
            <stop offset="30%" stopColor="#948a7e" />
            <stop offset="48%" stopColor="#33291f" />
            <stop offset="66%" stopColor="#948a7e" />
          </linearGradient>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <g stroke="white"><Shape /></g>
          </mask>
        </defs>
        <g mask={`url(#${maskId})`} className={styles.highlight}>
          <rect x="-24" y="0" width="72" height="24" stroke="none" fill={`url(#${gradientId})`} className={styles.sweep} />
        </g>
      </>}
    </svg>
  );
}
import { useId } from "react";
import styles from "./icon/style.module.css";
