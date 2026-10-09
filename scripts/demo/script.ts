import { createToolCallId } from "../../src/brand/ids.js";
import type { MockLLMEntry } from "../../src/llm/adapters/mock.js";
import type { ContentBlock, GenerateRequest, Message, ModelEvent } from "../../src/llm/types.js";

export interface DemoScript {
  readonly entries: readonly MockLLMEntry[];
  readonly id: (key: string) => string;
}

export function demoScript(): DemoScript {
  const ids = new Map<string, string>();
  const id = (key: string) => {
    const value = ids.get(key);
    if (!value) throw new Error(`Demo script has not observed ${key} yet.`);
    return value;
  };
  const capture = (request: GenerateRequest, callId: string, key: string, pattern: RegExp) => {
    const match = pattern.exec(resultText(request.messages, callId));
    if (!match?.[1]) throw new Error(`Tool result ${callId} does not contain ${key}.`);
    ids.set(key, match[1]);
  };
  const node = (request: GenerateRequest, callId: string, key: string) =>
    capture(request, callId, key, new RegExp(`- ${key} -> ([^\\s]+)`));
  const resource = (request: GenerateRequest, callId: string, key: string) =>
    capture(request, callId, key, /Resource ID: ([^\s]+)/);
  const work = (key: string, goal: string, depends_on: string[]) => ({
    key, kind: "work", title: key, goal, done_when: [`${key} accepted by Human`], required: true, depends_on,
  });
  const publish = (key: string, description: string) =>
    ({ path: `${key}.txt`, name: key, description, type: "text/plain" });
  const share = (key: string) =>
    ({ resource_id: id(key), expected_revision: 1, access: { kind: "shared", node_ids: [id("synthesis")] } });

  return { id, entries: [
    step(() => call("plan-read", "read_roadmap", {})),
    step(() => call("plan-write", "create_roadmap", { reason: "Initial plan", nodes: [
      work("evidence", "Publish the supplied measurements as a Resource", []),
      work("synthesis", "Recommend A or B from shared evidence", ["evidence"]),
    ] })),
    step(request => {
      node(request, "plan-write", "evidence");
      node(request, "plan-write", "synthesis");
      return answer("Roadmap v1: evidence -> synthesis. Waiting for the Human to start evidence.");
    }),

    step(() => call("publish-evidence", "register_resource", publish("evidence", "Benchmark of candidates A and B"))),
    step(request => {
      resource(request, "publish-evidence", "evidenceResource");
      return call("report-evidence", "send_to_main", { message: `Evidence published as ${id("evidenceResource")}; not independently validated.` });
    }),
    step(() => answer("Evidence published and reported to Main.")),

    step(() => call("handoff-mail", "read_mailbox", {})),
    step(() => call("handoff-evidence", "set_resource_access", share("evidenceResource"))),
    step(() => answer("Evidence shared with synthesis only.")),

    step(() => call("consume-evidence", "fetch_resource", { resource_id: id("evidenceResource") })),
    step(() => call("forbidden-replan", "modify_roadmap", {
      base_version: 1, action: "add_node", reason: "Node tries to replan", ...work("validation", "Validate", []),
    })),
    step(() => call("report-blocker", "send_to_main", { message: "BLOCKER: measurements are not independently validated; please add a validation node." })),
    step(() => answer("Blocked until independent validation exists.")),

    step(() => call("blocker-mail", "read_mailbox", {})),
    step(() => call("replan-read", "read_roadmap", {})),
    step(() => call("add-validation", "modify_roadmap", {
      base_version: 1, action: "add_node", reason: "Resolve synthesis blocker",
      ...work("validation", "Publish the independent validation run", [id("evidence")]),
    })),
    step(request => {
      node(request, "add-validation", "validation");
      return call("stale-connect", "modify_roadmap", {
        base_version: 1, action: "connect", from_node_id: id("validation"), to_node_id: id("synthesis"), reason: "Stale base version",
      });
    }),
    step(() => call("refresh-plan", "read_roadmap", {})),
    step(() => call("connect-validation", "modify_roadmap", {
      base_version: 2, action: "connect", from_node_id: id("validation"), to_node_id: id("synthesis"), reason: "Validate before synthesis",
    })),
    step(() => answer("Roadmap v3: synthesis now also waits for validation.")),

    step(() => call("publish-validation", "register_resource", publish("validation", "Independent repeat of the benchmark"))),
    step(request => {
      resource(request, "publish-validation", "validationResource");
      return call("report-validation", "send_to_main", { message: `Validation published as ${id("validationResource")}.` });
    }),
    step(() => answer("Validation published and reported to Main.")),

    step(() => call("validation-mail", "read_mailbox", {})),
    step(() => call("handoff-validation", "set_resource_access", share("validationResource"))),
    step(() => answer("Validation shared with synthesis.")),

    step(() => call("consume-validation", "fetch_resource", { resource_id: id("validationResource") })),
    step(request => {
      const text = resultText(request.messages, "consume-validation");
      if (!text.includes("125 ms")) throw new Error("Validation resource body was not delivered.");
      return answer("Recommend Candidate A: independently 125 ms / 93.5% meets both limits; B fails latency at 175 ms.");
    }),
  ] };
}

function step(respond: (request: GenerateRequest) => readonly ModelEvent[]): MockLLMEntry {
  return { kind: "handler", handle: respond };
}

function call(id: string, name: string, args: unknown): readonly ModelEvent[] {
  return events({ type: "tool-call", id: createToolCallId(id), name, arguments: JSON.stringify(args) }, "tool-calls");
}

function answer(text: string): readonly ModelEvent[] {
  return events({ type: "text", text }, "stop");
}

function events(content: ContentBlock, finish: "stop" | "tool-calls"): readonly ModelEvent[] {
  const body: ModelEvent[] = content.type === "tool-call"
    ? [
      { type: "content-started", contentIndex: 0, contentType: "tool-call", toolCallId: content.id },
      { type: "content-delta", contentIndex: 0, contentType: "tool-call", toolCallId: content.id, toolNameDelta: content.name, delta: content.arguments },
    ]
    : [
      { type: "content-started", contentIndex: 0, contentType: content.type },
      { type: "content-delta", contentIndex: 0, contentType: content.type, delta: content.text },
    ];
  return [...body, { type: "content-completed", contentIndex: 0, contentType: content.type }, { type: "finished", reason: { kind: finish } }];
}

export function resultText(messages: readonly Message[], callId: string): string {
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool-result" && block.toolCallId === callId) {
        return block.content.flatMap(part => part.type === "text" ? [part.text] : []).join("\n");
      }
    }
  }
  throw new Error(`Missing tool result ${callId}.`);
}
