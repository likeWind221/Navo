import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context } from "cordis";

import { createApp } from "../src/app.js";
import type { ProjectId } from "../src/brand/ids.js";
import { resolveKernelHostConfig } from "../src/host/config.js";
import { QwenChatCompletionsAdapter } from "../src/llm/adapters/qwen.js";
import { captureTurn, writeEvidence } from "./longterm/evidence.js";

interface Scenario {
  readonly name: string;
  readonly goal: string | null;
  readonly turns: readonly Step[];
}

interface Step {
  readonly text: string;
  readonly expect: { readonly planned: boolean; readonly goal: string | null | "changed" };
}

const PREFILLED = "调研 RAG 系统的检索质量评测方法，并给出适合本团队的评测方案推荐。";

const scenarios: readonly Scenario[] = [
  { name: "greeting", goal: null, turns: [
    { text: "你好！今天过得怎么样？", expect: { planned: false, goal: null } },
  ] },
  { name: "prefilled-plan", goal: PREFILLED, turns: [
    { text: "执行规划", expect: { planned: false, goal: PREFILLED } },
    { text: "同意，按这个目标开始规划。", expect: { planned: true, goal: PREFILLED } },
  ] },
  { name: "prefilled-conflict", goal: PREFILLED, turns: [
    { text: "帮我规划一下：在百万级向量数据上比较 Milvus、Qdrant 和 pgvector 的检索延迟与部署成本，给出选型建议。", expect: { planned: false, goal: PREFILLED } },
    { text: "确认，采用你建议的新目标并开始规划。", expect: { planned: true, goal: "changed" } },
  ] },
  { name: "extract-goal", goal: null, turns: [
    { text: "我想写一份关于 LLM Agent 长期记忆机制的综述，覆盖主流方法和评测基准，帮我规划一下。", expect: { planned: false, goal: null } },
    { text: "对，就按这个目标开始规划。", expect: { planned: true, goal: "changed" } },
  ] },
  { name: "ambiguous", goal: null, turns: [
    { text: "帮我搞点东西吧。", expect: { planned: false, goal: null } },
  ] },
];

async function runScenario(app: Context, scenario: Scenario, evidenceDir: string): Promise<boolean> {
  const project = app.projects.create({ name: scenario.name, goal: scenario.goal });
  await app.projectWorkspaces.create(project.id, await mkdtemp(join(tmpdir(), `navo-goal-${scenario.name}-`)));
  let passed = true;
  for (const [index, step] of scenario.turns.entries()) {
    const started = Date.now();
    const result = await app.projectRuntime.startMain({ projectId: project.id, text: step.text });
    const evidence = captureTurn(app, project.id, result.sessionId, result.turn.turnId);
    const state = observe(app, project.id);
    const goalOk = step.expect.goal === "changed"
      ? state.goal !== null && state.goal !== scenario.goal
      : state.goal === step.expect.goal;
    const ok = result.turn.status === "completed" && state.planned === step.expect.planned && goalOk;
    passed &&= ok;
    const file = await writeEvidence(evidenceDir, `${scenario.name}-${index + 1}`, {
      scenario: scenario.name, user: step.text, expect: step.expect, state, ok, ...evidence.record,
    });
    console.log(JSON.stringify({
      scenario: scenario.name,
      turn: index + 1,
      ok,
      seconds: (Date.now() - started) / 1000,
      status: result.turn.status,
      user: step.text,
      calls: evidence.calls,
      state,
      answer: evidence.answers.at(-1) ?? "",
      evidence: file,
    }));
  }
  return passed;
}

function observe(app: Context, projectId: ProjectId) {
  const project = app.projects.get(projectId)!;
  return {
    goal: project.goal,
    revision: project.revision,
    planned: app.roadmaps.get(projectId) !== undefined,
    nodes: app.nodes.getByProject(projectId).length,
  };
}

async function main(): Promise<void> {
  const config = resolveKernelHostConfig();
  const app = await createApp({
    node: { session: { model: config.agent.model } },
    runtime: { maxSteps: 16, maxModelRetries: 0 },
  });
  const evidenceDir = process.env.NAVO_EVIDENCE_DIR?.trim() || join(tmpdir(), `navo-goal-evidence-${Date.now()}`);
  console.log(JSON.stringify({ evidenceDir, model: config.agent.model.model, thinking: config.adapter.enableThinking }));
  try {
    app.llm.registerAdapter(config.provider, new QwenChatCompletionsAdapter(config.adapter));
    const only = process.argv[2];
    const failed: string[] = [];
    for (const scenario of scenarios.filter(value => only === undefined || value.name === only)) {
      if (!await runScenario(app, scenario, evidenceDir)) failed.push(scenario.name);
    }
    console.log(JSON.stringify({ failed }));
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    await app.fiber.dispose();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
