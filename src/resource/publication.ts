import type { ResourceLifecycle } from "./lifecycle.js";
import { libraryPathKey, numberedLibraryPath } from "./library.js";
import type { PublishResourceInput, ReplaceResourceInput } from "./model.js";
import { resourceEntryRefFromSource, resolveResourcePublishSource } from "./path.js";
import type { ProjectWorkspace } from "../workspace/model.js";

export async function publishResource(lifecycle: ResourceLifecycle, input: PublishResourceInput, signal?: AbortSignal,
  folderPaths: () => ReadonlySet<string> = () => new Set()) {
  const intake = workspaceIntake(input.sourceRef);
  return lifecycle.create(input, { ...intake,
    choosePath: resources => numberedLibraryPath(intake.filename,
      new Set([...folderPaths(), ...resources.map(resource => libraryPathKey(resource.libraryPath))])) }, signal);
}

export async function replaceResource(lifecycle: ResourceLifecycle, input: ReplaceResourceInput, signal?: AbortSignal) {
  return lifecycle.replace(input, workspaceIntake(input.sourceRef), signal);
}

function workspaceIntake(sourceRef: string) {
  return { filename: resourceEntryRefFromSource(sourceRef),
    receive: (workspace: ProjectWorkspace) => resolveResourcePublishSource(workspace, sourceRef) };
}
