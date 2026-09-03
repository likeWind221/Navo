import type { GenerateRequest, StreamChunk } from "./types.js";

/** Provider boundary: implementations translate provider data into the canonical stream. */
export interface LLMAdapter {
  stream(request: GenerateRequest): AsyncIterable<StreamChunk>;
}
