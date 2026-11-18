import type { NodeReviewInput, NodeV1 } from "../../../../../rpc/project.js";
import type { DesktopProjectApi, DesktopProjectFailure, DesktopProjectResult } from "../../../../shared/project.js";

export interface ProjectReviewSnapshot {
  readonly busy: boolean;
  readonly failure: DesktopProjectFailure | null;
}

interface ReviewEntry {
  busy: boolean;
  failure: DesktopProjectFailure | null;
}

interface ProjectEntry {
  readonly nodes: Map<string, ReviewEntry>;
}

export class ProjectReviews {
  private readonly entries = new Map<string, ProjectEntry>();

  constructor(
    private readonly api: DesktopProjectApi | undefined,
    private readonly changed: (projectId: string) => void,
  ) {}

  snapshot(projectId: string, nodeId: string): ProjectReviewSnapshot {
    const entry = this.ensure(projectId, nodeId);
    return { busy: entry.busy, failure: entry.failure };
  }

  dismiss(projectId: string, nodeId: string): void {
    const entry = this.ensure(projectId, nodeId);
    if (entry.failure === null) return;
    entry.failure = null;
    this.changed(projectId);
  }

  async review(input: NodeReviewInput): Promise<DesktopProjectResult<NodeV1>> {
    const entry = this.ensure(input.projectId, input.nodeId);
    if (entry.busy) {
      return {
        type: "failed",
        failure: { code: "turn-active", message: "该节点已有验收操作正在进行。" },
      };
    }
    entry.busy = true;
    entry.failure = null;
    this.changed(input.projectId);
    if (this.api === undefined) {
      entry.busy = false;
      entry.failure = { code: "bridge-closed", message: "节点验收仅在桌面应用中可用" };
      this.changed(input.projectId);
      return { type: "failed", failure: entry.failure };
    }
    const result = await this.api.review(input);
    entry.busy = false;
    entry.failure = result.type === "failed" ? result.failure : null;
    this.changed(input.projectId);
    return result;
  }

  dispose(): void {
    this.entries.clear();
  }

  private ensure(projectId: string, nodeId: string): ReviewEntry {
    let project = this.entries.get(projectId);
    if (project === undefined) {
      project = { nodes: new Map() };
      this.entries.set(projectId, project);
    }
    let entry = project.nodes.get(nodeId);
    if (entry === undefined) {
      entry = { busy: false, failure: null };
      project.nodes.set(nodeId, entry);
    }
    return entry;
  }
}
