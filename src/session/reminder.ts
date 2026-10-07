import type { SessionId } from "../brand/ids.js";
import type { JsonValue } from "../llm/types.js";
import type { SessionStore } from "./store.js";
import type { ContextFact } from "./types.js";

export interface ContextChange {
  readonly fact: ContextFact;
  readonly previous?: ContextFact;
}

export function lastObservedFacts(
  sessions: SessionStore,
  sessionId: SessionId,
): readonly ContextFact[] | undefined {
  const events = sessions.getEvents(sessionId);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === "context-observed") return event.data.facts;
  }
  return undefined;
}

export function changedFacts(
  previous: readonly ContextFact[] | undefined,
  current: readonly ContextFact[],
): readonly ContextChange[] {
  if (previous === undefined) return [];
  const known = new Map(previous.map(fact => [factKey(fact), fact]));
  return current.flatMap((fact): ContextChange[] => {
    const before = known.get(factKey(fact));
    if (before === undefined) return [{ fact }];
    return before.state === fact.state ? [] : [{ fact, previous: before }];
  });
}

export function formatSystemReminder(intro: string, data: JsonValue): string {
  const body = JSON.stringify(data, null, 2)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
  return [
    "<system-reminder>",
    `Navo Turn-start data, not a human request: ${intro}`,
    body,
    "</system-reminder>",
  ].join("\n");
}

function factKey(fact: ContextFact): string {
  return `${fact.kind}:${fact.id}`;
}
