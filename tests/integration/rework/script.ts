import { expect } from "vitest";
import type { MockLLMEntry } from "../../../src/llm/adapters/mock.js";
import type { GenerateRequest } from "../../../src/llm/types.js";
import { answer, call, resultText, step } from "../longterm/script.js";

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
    key, title: key, goal: `Complete ${key}`, done_when: [`${key} is backed by a cited source`], required: true, depends_on,
  });
  const register = (file: string, name: string) => ({ path: file, name, description: `${name} metadata`, type: "text/plain" });
  const submit = (resources: string[], note: string) => ({
    summary: note, resource_ids: resources.map(id), criteria: [{ criterion_index: 1, satisfied: true, note }], remaining: [],
  });
  const share = (key: string) => ({ resource_id: id(key), expected_revision: 1, access: { kind: "shared", node_ids: [id("synthesis")] } });
  const checklist = (request: GenerateRequest) => JSON.stringify(request.messages.at(-1));

  return { ids, entries: [
    call("plan-read", "read_roadmap", {}),
    step(request => {
      expect(resultText(request, "plan-read")).toContain("Roadmap is empty");
      return call("plan-write", "create_roadmap", { reason: "Initial plan", nodes: [work("evidence", []), work("synthesis", ["evidence"])] });
    }),
    step(request => {
      mapping(request, "plan-write", "evidence");
      mapping(request, "plan-write", "synthesis");
      return answer("Plan ready for Human approval");
    }),

    call("publish-draft", "register_resource", register("draft.txt", "draft")),
    step(request => {
      publication(request, "publish-draft", "draft");
      return call("submit-draft", "submit_completion", submit(["draft"], "Draft published"));
    }),

    step(request => {
      expect(checklist(request)).toContain("not a verified fact");
      expect(checklist(request)).toContain(id("draft"));
      return call("check-draft", "fetch_resource", { resource_id: id("draft") });
    }),
    step(request => {
      expect(resultText(request, "check-draft")).toContain("DRAFT_BODY");
      return call("rework-draft", "submit_review", {
        decision: "rework", reason: "Opened the draft: it cites no source", feedback: "REWORK_FEEDBACK: publish sourced.txt with its source",
      });
    }),
    answer("Evidence returned for rework"),

    step(request => {
      expect(JSON.stringify(request.messages)).toContain(id("draft"));
      expect(JSON.stringify(request.messages.at(-1))).toContain("REWORK_FEEDBACK");
      return call("publish-sourced", "register_resource", register("sourced.txt", "sourced"));
    }),
    step(request => {
      publication(request, "publish-sourced", "sourced");
      return call("submit-sourced", "submit_completion", submit(["sourced"], "Sourced evidence published"));
    }),

    step(request => {
      expect(checklist(request)).toContain(id("sourced"));
      return call("check-log", "read_node_turn", {});
    }),
    step(request => {
      expect(resultText(request, "check-log")).toContain("submit_completion");
      return call("check-sourced", "fetch_resource", { resource_id: id("sourced") });
    }),
    step(request => {
      expect(resultText(request, "check-sourced")).toContain("SOURCED_BODY");
      return call("complete-evidence", "submit_review", { decision: "complete", reason: "Opened sourced.txt: the source is cited" });
    }),
    step(request => {
      expect(resultText(request, "complete-evidence")).toContain("complete");
      return call("adjust-read", "read_roadmap", {});
    }),
    step(request => {
      expect(resultText(request, "adjust-read")).toContain("Roadmap version: 1");
      return call("add-validation", "add_node", { base_version: 1, index: null, reason: "Evidence asks for independent validation", ...work("validation", [id("evidence")]) });
    }),
    step(request => {
      mapping(request, "add-validation", "validation");
      return call("connect-validation", "set_dependency", {
        base_version: 2, connected: true, from_node_id: id("validation"), to_node_id: id("synthesis"), reason: "Validate before synthesis",
      });
    }),
    answer("Evidence complete; validation inserted before synthesis"),

    step(request => {
      expect(checklist(request)).toMatch(/neverExecuted[\\"]+: true/);
      return call("never-ran", "submit_review", { decision: "complete", reason: "Assume validation is done" });
    }),
    step(request => {
      expect(resultText(request, "never-ran")).toContain("never ran");
      return call("escalate-validation", "submit_review", { decision: "escalate", reason: "Validation has not run yet" });
    }),
    answer("Validation must run first"),

    call("publish-validation", "register_resource", register("validation.txt", "validation")),
    step(request => {
      publication(request, "publish-validation", "validationResource");
      return call("submit-validation", "submit_completion", submit(["validationResource"], "Validation published"));
    }),

    step(() => call("check-validation", "fetch_resource", { resource_id: id("validationResource") })),
    step(request => {
      expect(resultText(request, "check-validation")).toContain("VALIDATION_BODY");
      return call("complete-validation", "submit_review", { decision: "complete", reason: "Opened validation.txt: independent check" });
    }),
    step(() => call("share-sourced", "set_resource_access", share("sourced"))),
    step(() => call("share-validation", "set_resource_access", share("validationResource"))),
    answer("Validation complete; resources shared with synthesis"),

    step(request => {
      expect(JSON.stringify(request.messages[0])).toContain(id("sourced"));
      expect(JSON.stringify(request.messages[0])).toContain(id("validationResource"));
      return call("read-sourced", "fetch_resource", { resource_id: id("sourced") });
    }),
    step(() => call("read-validation", "fetch_resource", { resource_id: id("validationResource") })),
    step(request => {
      expect(resultText(request, "read-sourced")).toContain("SOURCED_BODY");
      expect(resultText(request, "read-validation")).toContain("VALIDATION_BODY");
      return call("submit-synthesis", "submit_completion", submit([], "Recommendation cites sourced evidence and validation"));
    }),

    call("check-synthesis", "read_node_turn", {}),
    step(request => {
      expect(resultText(request, "check-synthesis")).toContain("fetch_resource");
      return call("complete-synthesis", "submit_review", { decision: "complete", reason: "Work log shows both resources were read" });
    }),
    answer("Project work complete"),
  ] };
}
