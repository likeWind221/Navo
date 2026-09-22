import { expect } from "vitest";
import { createToolCallId } from "../../../src/brand/ids.js";
import type { MockLLMEntry } from "../../../src/llm/adapters/mock.js";
import type { GenerateRequest } from "../../../src/llm/types.js";
import { modelResponse } from "../../helpers/runtime.js";

export interface Scenario {
  readonly ids: Map<string, string>;
  readonly entries: readonly MockLLMEntry[];
}

export function scenario(): Scenario {
  const ids = new Map<string, string>();
  const id = (key: string) => {
    const value = ids.get(key);
    if (!value) throw new Error(`Missing model-visible identity: ${key}`);
    return value;
  };
  const mapping = (request: GenerateRequest, callId: string, key: string) => {
    const match = new RegExp(`- ${key} -> ([^\\s]+)`).exec(resultText(request, callId));
    expect(match).not.toBeNull();
    ids.set(key, match![1]!);
  };
  const publication = (request: GenerateRequest, callId: string, key: string) => {
    const match = /Resource ID: ([^\s]+)/.exec(resultText(request, callId));
    expect(match).not.toBeNull();
    ids.set(key, match![1]!);
  };
  const work = (key: string, depends_on: string[]) => ({
    key, kind: "work", title: key, goal: `Complete ${key}`, done_when: [`${key} accepted`], required: true, depends_on,
  });
  const register = (key: string) => ({ path: `${key}.txt`, name: key, description: `${key} metadata`, type: "text/plain" });
  const share = (key: string) => ({ resource_id: id(key), expected_revision: 1, access: { kind: "shared", node_ids: [id("synthesis")] } });
  return { ids, entries: [
    step(request => {
      expect(JSON.stringify(request.messages)).toContain("Deliver an evidence-backed recommendation");
      return call("plan-read", "read_roadmap", {});
    }),
    step(request => {
      expect(resultText(request, "plan-read")).toContain("Roadmap is empty");
      return call("plan-write", "write_roadmap", { reason: "Initial plan", nodes: [work("evidence", []), work("synthesis", ["evidence"])] });
    }),
    step(request => {
      mapping(request, "plan-write", "evidence");
      mapping(request, "plan-write", "synthesis");
      return answer("Plan ready for Human approval");
    }),

    call("publish-evidence", "register_resource", register("evidence")),
    step(request => {
      publication(request, "publish-evidence", "evidenceResource");
      return call("report-evidence", "send_to_main", { message: `Evidence resource ${id("evidenceResource")} ready` });
    }),
    answer("EVIDENCE_SESSION_PRIVATE_NOTE"),

    call("handoff-mail", "read_mailbox", {}),
    step(request => {
      expect(resultText(request, "handoff-mail")).toContain(id("evidenceResource"));
      return call("handoff-evidence", "set_resource_access", share("evidenceResource"));
    }),
    answer("Evidence shared; Human may start synthesis"),

    step(request => {
      expect(JSON.stringify(request.messages[0])).toContain(id("evidenceResource"));
      expect(JSON.stringify(request.messages[0])).not.toContain("EVIDENCE_BODY");
      return call("consume-evidence", "fetch_resource", { resource_id: id("evidenceResource") });
    }),
    step(request => {
      expect(resultText(request, "consume-evidence")).toContain("EVIDENCE_BODY");
      return call("forbidden-replan", "modify_roadmap", { base_version: 1, action: "remove_node", node_id: id("evidence"), reason: "Node cannot replan" });
    }),
    step(request => {
      expect(resultText(request, "forbidden-replan")).toContain("not allowed");
      return call("report-blocker", "send_to_main", { message: "BLOCKER: independent validation is missing; Main must add a validation node" });
    }),
    answer("Waiting for independent validation"),

    call("blocker-mail", "read_mailbox", {}),
    step(request => {
      expect(resultText(request, "blocker-mail")).toContain("BLOCKER: independent validation");
      return call("replan-read", "read_roadmap", {});
    }),
    step(request => {
      expect(resultText(request, "replan-read")).toContain("Roadmap version: 1");
      return call("add-validation", "modify_roadmap", { base_version: 1, action: "add_node", reason: "Resolve synthesis blocker", ...work("validation", [id("evidence")]) });
    }),
    step(request => {
      mapping(request, "add-validation", "validation");
      return call("stale-connect", "modify_roadmap", { base_version: 1, action: "connect", from_node_id: id("validation"), to_node_id: id("synthesis"), reason: "Stale plan" });
    }),
    step(request => {
      expect(resultText(request, "stale-connect")).toContain("Call read_roadmap again");
      return call("refresh-plan", "read_roadmap", {});
    }),
    step(request => {
      expect(resultText(request, "refresh-plan")).toContain("Roadmap version: 2");
      return call("connect-validation", "modify_roadmap", { base_version: 2, action: "connect", from_node_id: id("validation"), to_node_id: id("synthesis"), reason: "Validation before synthesis" });
    }),
    answer("Validation inserted; synthesis must wait"),

    step(request => {
      expect(JSON.stringify(request.messages[0])).not.toContain(id("evidenceResource"));
      return call("private-fetch", "fetch_resource", { resource_id: id("evidenceResource") });
    }),
    step(request => {
      expect(resultText(request, "private-fetch")).toContain("unavailable");
      return call("publish-validation", "register_resource", register("validation"));
    }),
    step(request => {
      publication(request, "publish-validation", "validationResource");
      return call("report-validation", "send_to_main", { message: `Validation resource ${id("validationResource")} ready` });
    }),
    answer("VALIDATION_SESSION_PRIVATE_NOTE"),

    call("validation-mail", "read_mailbox", {}),
    step(request => {
      expect(resultText(request, "validation-mail")).toContain(id("validationResource"));
      return call("handoff-validation", "set_resource_access", share("validationResource"));
    }),
    answer("Validation shared; Human must confirm and continue"),

    step(request => {
      expect(JSON.stringify(request.messages)).toContain("Waiting for independent validation");
      expect(JSON.stringify(request.messages[0])).toContain(id("validationResource"));
      expect(JSON.stringify(request.messages[0])).not.toContain("VALIDATION_BODY");
      return call("consume-validation", "fetch_resource", { resource_id: id("validationResource") });
    }),
    step(request => {
      expect(resultText(request, "consume-validation")).toContain("VALIDATION_BODY");
      return answer("Final recommendation supported by evidence and validation");
    }),
  ] };
}

function step(respond: (request: GenerateRequest) => ReturnType<typeof modelResponse>): MockLLMEntry {
  return { kind: "handler", handle: request => respond(request).events };
}

function call(id: string, name: string, args: unknown) {
  return modelResponse([{ type: "tool-call", id: createToolCallId(id), name, arguments: JSON.stringify(args) }], "tool-calls");
}

function answer(text: string) {
  return modelResponse([{ type: "text", text }]);
}

function resultText(request: GenerateRequest, callId: string): string {
  for (const message of request.messages) {
    for (const block of message.content) {
      if (block.type === "tool-result" && block.toolCallId === callId) {
        return block.content.filter(part => part.type === "text").map(part => part.text).join("\n");
      }
    }
  }
  throw new Error(`Missing Tool result: ${callId}`);
}
