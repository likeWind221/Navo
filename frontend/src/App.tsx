import { lazy, Suspense, useState } from "react";
import { WorkspaceShell } from "./workspace/Shell";
import type { WorkspaceEntry } from "./workspace/Shell";
import { ChatWorkspace } from "./workspace/Chat";
import { ProjectCreate } from "./workspace/project/Create";
import { ProjectDetail } from "./workspace/project/Detail";
import { ProjectNotice } from "./workspace/project/Notice";
import { useProjects } from "./workspace/project/hook";

const DesignSample = import.meta.env.DEV
  ? lazy(() => import("./preview/Sample"))
  : null;

const WorkspacePreview = import.meta.env.DEV ? lazy(() => import("./preview/Workspace")) : null;

export function App(): React.JSX.Element {
  if (WorkspacePreview !== null && new URLSearchParams(window.location.search).get("preview") === "workspace") {
    return <Suspense fallback={<p>正在加载工作区……</p>}><WorkspacePreview /></Suspense>;
  }
  if (DesignSample !== null && new URLSearchParams(window.location.search).get("preview") === "design") {
    return (
      <Suspense fallback={<p className="placeholder" role="status">正在加载视觉样板……</p>}>
        <DesignSample />
      </Suspense>
    );
  }
  return <DesktopWorkspace />;
}

function DesktopWorkspace(): React.JSX.Element {
  const api = window.desktop?.project;
  const projects = useProjects(api);
  const [creating, setCreating] = useState(false);
  const [openRequest, setOpenRequest] = useState<{ readonly id: string } | null>(null);
  const entries: WorkspaceEntry[] = [
    { id: "current", title: "当前会话", kind: "session", content: <ChatWorkspace /> },
    ...projects.state.projects.map((project): WorkspaceEntry => ({
      id: projectEntryId(project.projectId),
      title: project.name,
      kind: "project",
      content: <ProjectDetail api={api} projectId={project.projectId} />,
    })),
  ];

  function created(projectId: string): void {
    setCreating(false);
    setOpenRequest({ id: projectEntryId(projectId) });
  }

  return <>
    <WorkspaceShell
      entries={entries}
      create={{ project: () => setCreating(true) }}
      notice={{ project: <ProjectNotice state={projects.state} onRetry={() => void projects.reload()} /> }}
      openRequest={openRequest}
    />
    {creating && <ProjectCreate api={api} create={projects.create} onCreated={created} onClose={() => setCreating(false)} />}
  </>;
}

function projectEntryId(projectId: string): string {
  return `project:${projectId}`;
}
