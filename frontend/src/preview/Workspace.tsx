import { WorkspaceShell } from "../workspace/Shell";


export default function WorkspacePreview(): React.JSX.Element {
  return <WorkspaceShell entries={[
    { id: "session1", kind: "session", title: "消息展示验收", content: <div style={{ padding: 32 }}><h2>消息展示验收</h2><p>这是第一个会话。</p><textarea aria-label="第一会话草稿" /></div> },
    { id: "session2", kind: "session", title: "研究计划讨论与资料整理的长会话标题", content: <div style={{ padding: 32 }}><h2>研究计划讨论</h2><p>会话预览</p><textarea aria-label="预览草稿" placeholder="输入草稿后切换标签，内容仍会保留" /></div> },
    { id: "project1", kind: "project", title: "Research Workspace", content: <div style={{ padding: 32 }}><h2>Research Workspace</h2><p>项目预览</p></div> },
  ]} />;
}
