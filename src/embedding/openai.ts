import { EmbeddingError } from "./errors.js";
import { EMBEDDING_BATCH_POLICY, type EmbeddingBatchPolicy, type EmbeddingProvider, type EmbeddingRequest } from "./types.js";

export interface OpenAIEmbeddingConfig {
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly revision?: string;
  readonly policy?: Partial<EmbeddingBatchPolicy>;
  readonly fetch?: typeof fetch;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly random?: () => number;
}

const DEFAULT_MODEL = "Qwen/Qwen3-Embedding-0.6B";
const QUERY_TASK = "Given a user question, retrieve relevant passages that answer the question";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = "openai-compatible";
  readonly model: string;
  readonly revision: string | null;
  readonly dimension = 1024;
  readonly documentTemplateVersion = "qwen3-document-v1";
  readonly queryTemplateVersion = "qwen3-query-v1";
  readonly policy: EmbeddingBatchPolicy;
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly request: typeof fetch;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;

  constructor(config: OpenAIEmbeddingConfig) {
    this.endpoint = endpoint(config.endpoint);
    if (config.apiKey !== undefined && (!config.apiKey || /[\r\n]/.test(config.apiKey))) {
      throw new EmbeddingError("invalid-config", "Embedding API key must be non-empty and contain no newlines.");
    }
    this.apiKey = config.apiKey;
    this.model = config.model?.trim() || DEFAULT_MODEL;
    this.revision = config.revision?.trim() || null;
    this.policy = policy(config.policy);
    this.request = config.fetch ?? fetch;
    this.sleep = config.sleep ?? abortableSleep;
    this.random = config.random ?? Math.random;
  }

  async embedMany({ kind, inputs, signal }: EmbeddingRequest): Promise<readonly (readonly number[])[]> {
    if (inputs.length < 1 || inputs.length > this.policy.maxBatchSize) {
      throw new EmbeddingError("invalid-input", `Embedding batch size must be from 1 through ${this.policy.maxBatchSize}.`);
    }
    const formatted = inputs.map(input => this.format(kind, input));
    for (const input of formatted) {
      if (!input || [...input].length > this.policy.maxInputCodePoints) {
        throw new EmbeddingError("input-too-large", "Embedding input exceeds the configured character limit.");
      }
    }
    return this.sendSplit(formatted, signal);
  }

  private format(kind: EmbeddingRequest["kind"], input: string): string {
    return kind === "query" ? `Instruct: ${QUERY_TASK}\nQuery: ${input}` : input;
  }

  private async sendSplit(inputs: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]> {
    const body = JSON.stringify({ model: this.model, input: inputs });
    if (Buffer.byteLength(body) > this.policy.maxRequestBytes) {
      if (inputs.length === 1) throw new EmbeddingError("input-too-large", "Embedding request exceeds the configured body limit.");
      return this.split(inputs, signal);
    }
    try {
      return await this.send(body, inputs.length, signal);
    } catch (error) {
      if (error instanceof BatchTooLarge) {
        if (inputs.length === 1) throw new EmbeddingError("input-too-large", "Embedding service rejected a single input as too large.");
        return this.split(inputs, signal);
      }
      throw error;
    }
  }

  private async split(inputs: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]> {
    const middle = Math.ceil(inputs.length / 2);
    const left = await this.sendSplit(inputs.slice(0, middle), signal);
    const right = await this.sendSplit(inputs.slice(middle), signal);
    return [...left, ...right];
  }

  private async send(body: string, count: number, signal?: AbortSignal): Promise<readonly (readonly number[])[]> {
    let last: unknown;
    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt++) {
      signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(this.policy.timeoutMs);
      const requestSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
      try {
        const response = await this.request(this.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", ...(this.apiKey === undefined ? {} : { authorization: `Bearer ${this.apiKey}` }) },
          body,
          signal: requestSignal,
        });
        if (response.ok) return validateResponse(await json(response), count, this.dimension);
        if (response.status === 413 || (response.status === 400 && await mentionsLimit(response))) throw new BatchTooLarge();
        if (response.status === 401 || response.status === 403) {
          throw new EmbeddingError("authentication-failed", "Embedding service rejected the configured credentials.");
        }
        if (response.status === 404) throw new EmbeddingError("model-unavailable", "Embedding endpoint or model was not found.");
        if (![408, 429].includes(response.status) && response.status < 500) {
          throw new EmbeddingError("request-failed", `Embedding service returned HTTP ${response.status}.`);
        }
        last = new Error(`HTTP ${response.status}`);
        if (attempt === this.policy.maxAttempts) break;
        await this.sleep(retryDelay(response, attempt, this.random), signal);
      } catch (error) {
        if (error instanceof BatchTooLarge || error instanceof EmbeddingError) throw error;
        if (signal?.aborted) throw signal.reason;
        last = error;
        if (attempt === this.policy.maxAttempts) break;
        await this.sleep(backoff(attempt, this.random), signal);
      }
    }
    throw new EmbeddingError("request-failed", "Embedding request failed after the configured attempts.", { cause: last });
  }
}

class BatchTooLarge extends Error {}

function validateResponse(value: unknown, count: number, dimension: number): readonly (readonly number[])[] {
  if (typeof value !== "object" || value === null || !("data" in value) || !Array.isArray(value.data)) invalid();
  const result: (readonly number[])[] = new Array(count);
  for (const item of value.data) {
    if (typeof item !== "object" || item === null || !("index" in item) || !("embedding" in item)
      || !Number.isInteger(item.index) || Number(item.index) < 0 || Number(item.index) >= count
      || !Array.isArray(item.embedding) || result[Number(item.index)] !== undefined) invalid();
    const vector = item.embedding;
    if (vector.length !== dimension || vector.some((component: unknown) => typeof component !== "number" || !Number.isFinite(component))) invalid();
    result[Number(item.index)] = Object.freeze([...vector]);
  }
  for (let index = 0; index < count; index++) if (result[index] === undefined) invalid();
  return Object.freeze(result);
}

function invalid(): never {
  throw new EmbeddingError("invalid-response", "Embedding service returned an invalid response.");
}

async function json(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch (error) { throw new EmbeddingError("invalid-response", "Embedding service returned invalid JSON.", { cause: error }); }
}

async function mentionsLimit(response: Response): Promise<boolean> {
  const text = await response.text();
  return /(?:token|context|length|large|limit)/i.test(text);
}

function retryDelay(response: Response, attempt: number, random: () => number): number {
  if (response.status === 429) {
    const value = response.headers.get("retry-after");
    if (value !== null) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
      const date = Date.parse(value);
      if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 60_000));
    }
  }
  return backoff(attempt, random);
}

function backoff(attempt: number, random: () => number): number {
  return Math.round(1000 * 2 ** (attempt - 1) * (0.8 + random() * 0.4));
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    const abort = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
    function done(): void { signal?.removeEventListener("abort", abort); resolve(); }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function endpoint(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    const path = url.pathname.replace(/\/$/, "");
    url.pathname = path.endsWith("/v1/embeddings") ? path : path.endsWith("/v1") ? `${path}/embeddings` : `${path}/v1/embeddings`;
    return url.toString();
  } catch {
    throw new EmbeddingError("invalid-config", "Embedding endpoint must be an HTTP(S) URL.");
  }
}

function integer(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new EmbeddingError("invalid-config", `Embedding ${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function policy(overrides: Partial<EmbeddingBatchPolicy> | undefined): EmbeddingBatchPolicy {
  const value = { ...EMBEDDING_BATCH_POLICY, ...overrides };
  integer("batchSize", value.batchSize, 1, 32);
  integer("maxBatchSize", value.maxBatchSize, value.batchSize, 32);
  integer("maxInputCodePoints", value.maxInputCodePoints, 1, 10_000_000);
  integer("maxRequestBytes", value.maxRequestBytes, 1, 100 * 1024 * 1024);
  integer("timeoutMs", value.timeoutMs, 1, 600_000);
  integer("maxAttempts", value.maxAttempts, 1, 10);
  return Object.freeze(value);
}
