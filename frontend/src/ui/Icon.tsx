import { useId } from "react";
import { ArrowRight } from "reicon-react/icons/ArrowRight";
import { BookOpen } from "reicon-react/icons/BookOpen";
import { Compass } from "reicon-react/icons/Compass";
import { Loader } from "reicon-react/icons/Loader";
import { Check } from "reicon-react/icons/Check";
import { X } from "reicon-react/icons/X";
import { ChevronRight } from "reicon-react/icons/ChevronRight";
import { Globe } from "reicon-react/icons/Globe";
import { TerminalSquare } from "reicon-react/icons/TerminalSquare";
import { Pen } from "reicon-react/icons/Pen";
import { Folder } from "reicon-react/icons/Folder";
import { Chat } from "reicon-react/icons/Chat";
import { Plus } from "reicon-react/icons/Plus";
import { Gear } from "reicon-react/icons/Gear";
import { SidebarLeft } from "reicon-react/icons/SidebarLeft";
import { Stop } from "reicon-react/icons/Stop";
import { Brain } from "./icon/Brain";
import { Tool } from "./icon/Tool";
import styles from "./icon/style.module.css";

const shapes = { arrow: ArrowRight, book: BookOpen, guide: Compass, loader: Loader, check: Check, close: X, chevron: ChevronRight, globe: Globe, terminal: TerminalSquare, pen: Pen, folder: Folder, chat: Chat, plus: Plus, settings: Gear, sidebar: SidebarLeft, stop: Stop };
export type IconName = keyof typeof shapes | "brain" | "tool";

export function Icon({ name, active = false }: { readonly name: IconName; readonly active?: boolean }): React.JSX.Element {
  const Custom = name === "brain" ? Brain : name === "tool" ? Tool : null;
  const Library = name !== "brain" && name !== "tool" ? shapes[name] : null;
  const shape = Custom ? <Custom /> : Library ? <Library size={24} strokeWidth={1.75} stroke="none" /> : null;
  const id = useId();
  const maskId = `${id}-mask`;
  const gradientId = `${id}-gradient`;
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {shape}
      {active && <>
        <defs>
          <linearGradient id={gradientId}>
            <stop offset="30%" stopColor="#948a7e" />
            <stop offset="48%" stopColor="#33291f" />
            <stop offset="66%" stopColor="#948a7e" />
          </linearGradient>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <g stroke="white" color="white">{shape}</g>
          </mask>
        </defs>
        <g mask={`url(#${maskId})`} className={styles.highlight}>
          <rect x="-24" y="0" width="72" height="24" stroke="none" fill={`url(#${gradientId})`} className={styles.sweep} />
        </g>
      </>}
    </svg>
  );
}