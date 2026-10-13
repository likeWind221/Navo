import { ChatGPTAuthError } from "./error.js";
import { record, text } from "./schema.js";
import { AUTH_RESOURCE } from "./types.js";
import type { ChatGPTModel } from "./types.js";

export async function listChatGPTModels(accessToken: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ChatGPTModel[]> {
  let response: Response;
  try {
    response = await fetchImpl(`${AUTH_RESOURCE}/models`, {
      signal, redirect: "error", headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
  } catch {
    signal.throwIfAborted();
    throw new ChatGPTAuthError("models-network", "The ChatGPT model catalog could not be reached.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    const code = response.status === 401 ? "login-required" : response.status === 403 ? "models-denied" : "models-failed";
    throw new ChatGPTAuthError(code, "The ChatGPT account model catalog could not be queried.", response.status);
  }
  const value: unknown = await response.json().catch(() => null);
  if (!record(value) || !Array.isArray(value.models)) invalid();
  const models: ChatGPTModel[] = [];
  const slugs = new Set<string>();
  for (const model of value.models) {
    if (!record(model) || !text(model.slug) || !text(model.visibility)) invalid();
    if (model.visibility !== "list") continue;
    if (!text(model.display_name) || slugs.has(model.slug)) invalid();
    slugs.add(model.slug);
    models.push({ slug: model.slug, displayName: model.display_name });
  }
  return models;
}

function invalid(): never {
  throw new ChatGPTAuthError("invalid-models", "The ChatGPT account model catalog is invalid.");
}
