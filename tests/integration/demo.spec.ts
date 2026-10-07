import { expect, it } from "vitest";
import { runDemo } from "../../scripts/demo.js";

it("runs the offline long-horizon demo end to end", async () => {
  const lines: string[] = [];
  const summary = await runDemo(line => lines.push(line));
  expect(summary).toMatchObject({
    humanActions: 13,
    agentTurns: 8,
    roadmapRevision: 3,
    nodes: { evidence: "completing", synthesis: "completing", validation: "completing" },
    rejectedToolCalls: ["forbidden-replan", "stale-connect"],
  });
  expect(summary.answer).toContain("Recommend Candidate A");
  expect(lines.filter(line => line.includes("gate   refused"))).toHaveLength(2);
});
