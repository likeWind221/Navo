import type { FileOperation } from "../../../src/storage/operations.js";

export const CRASH_POINTS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"] as const;
export type CrashPoint = typeof CRASH_POINTS[number];

export interface CrashRequest {
  readonly mode: "interrupt" | "retry";
  readonly point: CrashPoint;
  readonly path: string;
  readonly projectId: string;
  readonly resourceId: string;
}

export interface Checkpoint {
  readonly point: CrashPoint;
  readonly transaction: boolean;
  readonly operation: FileOperation;
  readonly matchingEvents: number;
}

export const NEW_CONTENT = Buffer.alloc(2 * 1024 * 1024, "N");
export const OLD_CONTENT = "original generation\n";
export const GUARD_CONTENT = "unrelated resource\n";

export function crashOperationId(point: CrashPoint): string {
  return `fault-${point}`;
}
