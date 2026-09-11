import { Arrow } from "./icon/Arrow.js";
import { Book } from "./icon/Book.js";
import { Brain } from "./icon/Brain.js";
import { Check } from "./icon/Check.js";
import { Chevron } from "./icon/Chevron.js";
import { Close } from "./icon/Close.js";
import { Guide } from "./icon/Guide.js";
import { Loader } from "./icon/Loader.js";
import { Tool } from "./icon/Tool.js";

export type IconName =
  | "arrow"
  | "book"
  | "guide"
  | "brain"
  | "tool"
  | "loader"
  | "check"
  | "close"
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
};

export function Icon({ name }: { readonly name: IconName }): React.JSX.Element {
  const Shape = shapes[name];
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <Shape />
    </svg>
  );
}
