import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "../src/app.js";
import { createNodeId } from "../src/brand/ids.js";
import type { NodeId, SessionId, TurnId } from "../src/brand/ids.js";
import { MockLLMAdapter } from "../src/llm/adapters/mock.js";
import { demoScript } from "./demo/script.js";

export interface DemoSummary {
  readonly humanActions: number;
  readonly agentTurns: number;
  readonly modelSteps: number;
  readonly roadmapRevision: number | undefined;
  readonly nodes: Readonly<Record<string, string>>;
  readonly rejectedToolCalls: readonly string[];
  readonly answer: string;
}

interface Turn { readonly sessionId: SessionId; readonly turn: { readonly turnId: TurnId; readonly steps: number } }

const goal = "Recommend candidate A or B: latency must stay below 150 ms and accuracy at least 93%.";

export async function runDemo(print: (line: string) => void = console.log): Promise<DemoSummary> {
  const root = await mkdtemp(join(tmpdir(), "navo-demo-"));
  const app = await createApp({ node: { session: { model: { provider: "mock", model: "demo" } } } });
  try {
    await writeFile(join(root, "evidence.txt"), "Candidate A: 120 ms, 94%. Candidate B: 180 ms, 95%. Not independently validated.");
    await writeFile(join(root, "validation.txt"), "Independent repeat: A 125 ms, 93.5%; B 175 ms, 94.5%. A meets both limits; B fails latency.");
    const script = demoScript();
    const adapter = new MockLLMAdapter(script.entries);
    app.llm.registerAdapter("mock", adapter);
    const project = app.projects.create({ name: "Project", goal });
    await app.projectWorkspaces.create(project.id, root);
    const projectId = project.id;
    const nodeId = (key: string) => createNodeId(script.id(key));
    const title = (id: NodeId) => {
      const value = app.nodes.get(id)?.node;
      return value?.kind === "work" ? value.objective.title : id;
    };
    const rejected: string[] = [];
    let actions = 0;
    let answer = "";
    const turns: Turn[] = [];

    const state = () => {
      const nodes = app.nodes.getByProject(projectId).map(value => `${title(value.node.id)}=${value.status}`).join(" ");
      const resources = app.resources.listByProject(projectId).map(value =>
        `${value.name}:${value.access.kind === "shared" ? `shared(${value.access.nodeIds.map(title).join(",")})` : value.access.kind}`).join(" ");
      print(`    state  roadmap=v${app.roadmaps.get(projectId)?.revision ?? 0} ${nodes || "(no nodes)"}`);
      print(`           mailbox=${app.mailbox.getHistory(projectId).length} resources=[${resources}]`);
    };
    const human = (label: string) => print(`\n[${++actions}] Human: ${label}`);
    const trace = (result: Turn) => {
      turns.push(result);
      for (const event of app.sessions.getEvents(result.sessionId)) {
        if (!("turnId" in event.data) || event.data.turnId !== result.turn.turnId) continue;
        if (event.type === "tool-call-requested") {
          print(`    call   ${event.data.toolCall.name} ${clip(event.data.toolCall.arguments, 70)}`);
        } else if (event.type === "tool-call-result") {
          const block = event.data.message.content[0];
          const text = block.content.flatMap(part => part.type === "text" ? [part.text] : []).join(" ");
          if (block.isError) rejected.push(block.toolCallId);
          print(`    ${block.isError ? "REJECT" : "result"} ${clip(text, 90)}`);
        } else if (event.type === "assistant-message") {
          for (const block of event.data.message.content) {
            if (block.type === "text") print(`    says   "${(answer = block.text)}"`);
          }
        }
      }
      state();
    };
    const blocked = (label: string, action: () => unknown) => {
      human(`try to ${label}`);
      try {
        action();
        throw new Error(`${label} was expected to be refused.`);
      } catch (error) {
        print(`    gate   refused: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const confirm = (key: string) => {
      human(`review and confirm Node "${key}" as complete`);
      const id = nodeId(key);
      app.projectRuntime.confirmCompletion(projectId, id, { confirmedBy: "human", reason: "Reviewed in demo", reviewedRevision: app.nodes.get(id)!.revision });
      state();
    };
    const main = async (label: string) => {
      human(`start a Main Agent turn (${label})`);
      trace(await app.projectRuntime.startMain({ projectId, text: label }));
    };
    const node = async (key: string, resume = false) => {
      human(`${resume ? "continue" : "start"} Node "${key}"`);
      const input = { projectId, nodeId: nodeId(key), text: `Work on ${key}` };
      trace(await (resume ? app.projectRuntime.continueNode(input) : app.projectRuntime.startNode(input)));
    };

    print(`Navo offline demo (scripted Mock model, no network)\nGoal: ${goal}\nWorkspace: ${root}`);
    state();
    await main("plan the roadmap");
    blocked("start synthesis before evidence is confirmed", () => app.projectRuntime.startNode({ projectId, nodeId: nodeId("synthesis"), text: "Go" }));
    await node("evidence");
    confirm("evidence");
    await main("route the new evidence");
    await node("synthesis");
    await main("handle the blocker and replan");
    blocked("continue synthesis while validation is pending", () => app.projectRuntime.continueNode({ projectId, nodeId: nodeId("synthesis"), text: "Go" }));
    await node("validation");
    await main("route the validation result");
    confirm("validation");
    await node("synthesis", true);
    confirm("synthesis");

    if (adapter.remainingEntries !== 0) throw new Error(`${adapter.remainingEntries} scripted model responses were not used.`);
    const summary: DemoSummary = {
      humanActions: actions,
      agentTurns: turns.length,
      modelSteps: turns.reduce((total, value) => total + value.turn.steps, 0),
      roadmapRevision: app.roadmaps.get(projectId)?.revision,
      nodes: Object.fromEntries(app.nodes.getByProject(projectId).map(value => [title(value.node.id), value.status])),
      rejectedToolCalls: rejected,
      answer,
    };
    print(`\nDone: ${summary.agentTurns} agent turns, ${summary.modelSteps} model steps, ${summary.humanActions} human actions, roadmap v${summary.roadmapRevision}.`);
    print(`Guardrails exercised: ${rejected.join(", ")}`);
    return summary;
  } finally {
    await app.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

function clip(text: string, length: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > length ? `${line.slice(0, length - 3)}...` : line;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDemo().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
