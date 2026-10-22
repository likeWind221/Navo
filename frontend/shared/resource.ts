import type {
  ResourceDeleteInputV1,
  ResourceDeleteResultV1,
  ResourceFailureCode,
  ResourceFolderCreateInputV1,
  ResourceFolderDeleteInputV1,
  ResourceFolderDeleteResultV1,
  ResourceFolderOrganizeInputV1,
  ResourceLibraryDirectoryV1,
  ResourceLibraryInputV1,
  ResourceLibraryItemV1,
  ResourceLibrarySnapshotV1,
  ResourceReplaceInputV1,
  ResourceUpdateInputV1,
  UserImportInputV1,
  UserImportItemV1,
  UserImportSourceV1,
} from "../../rpc/resource.js";

export interface DesktopResourceApi {
  browse(input: ResourceLibraryInputV1): Promise<DesktopResourceResult<ResourceLibrarySnapshotV1>>;
  createFolder(input: ResourceFolderCreateInputV1): Promise<DesktopResourceResult<ResourceLibraryDirectoryV1>>;
  organizeFolder(input: ResourceFolderOrganizeInputV1): Promise<DesktopResourceResult<ResourceLibraryDirectoryV1>>;
  deleteFolder(input: ResourceFolderDeleteInputV1): Promise<DesktopResourceResult<ResourceFolderDeleteResultV1>>;
  update(input: ResourceUpdateInputV1): Promise<DesktopResourceResult<ResourceLibraryItemV1>>;
  replace(input: ResourceReplaceInputV1): Promise<DesktopResourceResult<ResourceLibraryItemV1>>;
  delete(input: ResourceDeleteInputV1): Promise<DesktopResourceResult<ResourceDeleteResultV1>>;
  startImport(input: UserImportInputV1): Promise<DesktopResourceResult<DesktopResourceStreamHandle>>;
  startFollow(input: ResourceLibraryInputV1): Promise<DesktopResourceResult<DesktopResourceStreamHandle>>;
  cancel(operationId: string): Promise<DesktopResourceResult<null>>;
  chooseFiles(): Promise<DesktopResourceResult<readonly UserImportSourceV1[]>>;
  chooseDirectory(): Promise<DesktopResourceResult<readonly UserImportSourceV1[]>>;
  chooseReplacement(): Promise<DesktopResourceResult<string | null>>;
  onEvent(listener: DesktopResourceEventListener): () => void;
}

export interface DesktopResourceStreamHandle {
  readonly subscriptionId: string;
}

export type DesktopResourceResult<T> =
  | { readonly type: "ok"; readonly value: T }
  | { readonly type: "failed"; readonly failure: DesktopResourceFailure };

export interface DesktopResourceFailure {
  readonly code: DesktopResourceFailureCode;
  readonly message: string;
}

export type DesktopResourceFailureCode = ResourceFailureCode
  | "cancelled"
  | "host-unavailable"
  | "invalid-input"
  | "invalid-output"
  | "bridge-closed";

export type DesktopResourceEventListener = (event: DesktopResourceEvent) => void;

export type DesktopResourceEvent =
  | { readonly type: "import-item"; readonly subscriptionId: string; readonly item: UserImportItemV1 }
  | { readonly type: "library-snapshot"; readonly subscriptionId: string; readonly snapshot: ResourceLibrarySnapshotV1 }
  | { readonly type: "stream-complete"; readonly subscriptionId: string; readonly status: "completed" | "cancelled" }
  | { readonly type: "stream-error"; readonly subscriptionId: string; readonly failure: DesktopResourceFailure };
