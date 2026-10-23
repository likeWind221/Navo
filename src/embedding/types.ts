export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly revision: string | null;
  readonly dimension: number;
  readonly documentTemplateVersion: string;
  readonly queryTemplateVersion: string;
  embedMany(request: EmbeddingRequest): Promise<readonly (readonly number[])[]>;
}

export interface EmbeddingRequest {
  readonly kind: "document" | "query";
  readonly inputs: readonly string[];
  readonly signal?: AbortSignal;
}

export interface EmbeddingBatchPolicy {
  readonly batchSize: number;
  readonly maxBatchSize: number;
  readonly maxInputCodePoints: number;
  readonly maxRequestBytes: number;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
}

export const EMBEDDING_BATCH_POLICY: EmbeddingBatchPolicy = Object.freeze({
  batchSize: 16,
  maxBatchSize: 32,
  maxInputCodePoints: 32_768,
  maxRequestBytes: 1024 * 1024,
  timeoutMs: 60_000,
  maxAttempts: 3,
});
