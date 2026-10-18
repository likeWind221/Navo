import type { LLMAdapter } from "../../src/llm/adapter.js";
import type { GenerateRequest, ModelEvent } from "../../src/llm/types.js";
import { estimateRequest } from "../../src/context/meter.js";

export const EXPIRED = Symbol("acceptance-deadline-expired");
export const SUMMARY_MARKER = "Compress the conversation above into one durable checkpoint";

export interface RequestEntry {
  readonly index: number;
  readonly kind: "task" | "summary";
  readonly model: string;
  readonly messageCount: number;
  readonly toolCount: number;
  readonly estimatedTokens: number;
  readonly startedAt: string;
  status: "started" | "completed" | "failed" | "rejected";
  finishedAt?: string;
  error?: string;
}

export class RequestLedger {
  private readonly items: RequestEntry[] = [];
  private count = 0;

  constructor(
    readonly limit: number,
    private readonly onChange?: (entry: RequestEntry, used: number) => void,
  ) {}

  get used(): number {
    return this.count;
  }

  get entries(): readonly RequestEntry[] {
    return this.items;
  }

  begin(request: GenerateRequest): RequestEntry | undefined {
    const kind = isSummaryRequest(request) ? "summary" : "task";
    const entry: RequestEntry = {
      index: this.items.length + 1,
      kind,
      model: request.model,
      messageCount: request.messages.length,
      toolCount: request.tools?.length ?? 0,
      estimatedTokens: estimateRequest(request),
      startedAt: new Date().toISOString(),
      status: "started",
    };
    this.items.push(entry);
    if (this.count >= this.limit) {
      entry.status = "rejected";
      entry.finishedAt = new Date().toISOString();
      this.onChange?.(entry, this.count);
      return undefined;
    }
    this.count += 1;
    this.onChange?.(entry, this.count);
    return entry;
  }

  finish(entry: RequestEntry, status: "completed" | "failed", error?: string): void {
    entry.status = status;
    entry.finishedAt = new Date().toISOString();
    if (error !== undefined) entry.error = error;
    this.onChange?.(entry, this.count);
  }
}

export function createGuardedAdapter(
  inner: LLMAdapter,
  ledger: RequestLedger,
  onExhausted: () => void,
): LLMAdapter {
  return {
    stream(request: GenerateRequest): AsyncIterable<ModelEvent> {
      return guardedStream(inner, ledger, onExhausted, request);
    },
  };
}

async function* guardedStream(
  inner: LLMAdapter,
  ledger: RequestLedger,
  onExhausted: () => void,
  request: GenerateRequest,
): AsyncGenerator<ModelEvent> {
  const entry = ledger.begin(request);
  if (entry === undefined) {
    onExhausted();
    throw new Error(`Acceptance request budget of ${ledger.limit} requests is exhausted.`);
  }
  try {
    for await (const event of inner.stream(request)) yield event;
    ledger.finish(entry, "completed");
  } catch (error: unknown) {
    ledger.finish(entry, "failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export function isSummaryRequest(request: GenerateRequest): boolean {
  const last = request.messages.at(-1);
  const text = last === undefined
    ? ""
    : last.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n");
  return text.includes(SUMMARY_MARKER);
}

export interface Deadline {
  readonly expired: Promise<typeof EXPIRED>;
  cancel(): void;
}

export function deadlineAfter(ms: number): Deadline {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof EXPIRED>((resolve) => {
    timer = setTimeout(() => resolve(EXPIRED), Math.max(1, ms));
  });
  return {
    expired,
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

export function raceDeadline<T>(promise: Promise<T>, deadline: Deadline): Promise<T | typeof EXPIRED> {
  return Promise.race([promise, deadline.expired]);
}
