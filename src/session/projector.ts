import type { Message } from "../llm/types.js";
import type { SessionEvent } from "./types.js";

/** Deterministically projects model-visible messages from committed events. */
export function projectMessages(
  events: readonly SessionEvent[],
): readonly Message[] {
  const messages: Message[] = [];

  for (const event of events) {
    switch (event.type) {
      case "user-message":
      case "tool-call-result":
        messages.push(event.data.message);
        break;
      case "assistant-message":
        if (event.data.message.content.length > 0) {
          messages.push(event.data.message);
        }
        break;
    }
  }

  return messages;
}
