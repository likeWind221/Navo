import { lazy, Suspense } from "react";
import { WorkspaceShell } from "./workspace/Shell";
import { ChatWorkspace } from "./workspace/Chat";

const DesignSample = import.meta.env.DEV
  ? lazy(() => import("./preview/Sample"))
  : null;

export function App(): React.JSX.Element {
  if (DesignSample !== null && new URLSearchParams(window.location.search).get("preview") === "design") {
    return (
      <Suspense fallback={<p className="placeholder" role="status">正在加载视觉样板……</p>}>
        <DesignSample />
      </Suspense>
    );
  }
  return (
    <WorkspaceShell>
      <ChatWorkspace />
    </WorkspaceShell>
  );
}
