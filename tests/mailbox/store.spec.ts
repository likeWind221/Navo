import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createProjectId } from "../../src/brand/ids.js";
import { MailboxStore } from "../../src/mailbox/store.js";
import { NodeStore } from "../../src/node/store.js";
import { ProjectStore } from "../../src/project/store.js";

const contexts: Context[] = [];

const objective = (title: string) => ({
  title,
  description: `Do ${title}`,
  acceptanceCriteria: [`Finish ${title}`],
});

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
});

async function domain(): Promise<Context> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  await ctx.plugin(MailboxStore);
  return ctx;
}

describe("Project Mailbox domain", () => {
  it("records only Node-to-Main and Main-to-Node messages in Project order", async () => {
    const ctx = await domain();
    const project = ctx.projects.create({ goal: "Coordinate a research project" });
    const node = ctx.nodes.create({ projectId: project.id, objective: objective("survey A2A") });

    const report = ctx.mailbox.postFromNode({
      projectId: project.id,
      nodeId: node.node.id,
      body: "The survey result is ready.",
    });
    const directive = ctx.mailbox.postFromMain({
      projectId: project.id,
      nodeId: node.node.id,
      body: "Keep the source list for handoff.",
    });

    expect(report).toMatchObject({
      projectId: project.id,
      sequence: 1,
      sender: { kind: "node", nodeId: node.node.id },
      recipient: { kind: "main" },
    });
    expect(directive).toMatchObject({
      projectId: project.id,
      sequence: 2,
      sender: { kind: "main" },
      recipient: { kind: "node", nodeId: node.node.id },
    });
    expect(ctx.mailbox.getHistory(project.id)).toEqual([report, directive]);
    expect(Object.isFrozen(ctx.mailbox.getHistory(project.id))).toBe(true);
    expect(Object.isFrozen(report.sender)).toBe(true);
  });

  it("rejects cross-Project Nodes, control Nodes, archived Projects, and empty bodies", async () => {
    const ctx = await domain();
    const first = ctx.projects.create({ goal: "First" });
    const second = ctx.projects.create({ goal: "Second" });
    const otherNode = ctx.nodes.create({ projectId: second.id, objective: objective("other work") });
    const control = ctx.nodes.create({
      projectId: first.id,
      kind: "control",
      purpose: "checkpoint",
      title: "Human checkpoint",
    });

    expect(() => ctx.mailbox.postFromNode({
      projectId: first.id,
      nodeId: otherNode.node.id,
      body: "Cross project",
    })).toThrow(expect.objectContaining({ code: "node-unavailable" }));

    expect(() => ctx.mailbox.postFromMain({
      projectId: first.id,
      nodeId: control.node.id,
      body: "Control directive",
    })).toThrow(expect.objectContaining({ code: "node-unavailable" }));

    const work = ctx.nodes.create({ projectId: first.id, objective: objective("local work") });
    expect(() => ctx.mailbox.postFromNode({ projectId: first.id, nodeId: work.node.id, body: "  " }))
      .toThrow(expect.objectContaining({ code: "invalid-message" }));

    ctx.projects.archive(first.id, "Pause project");
    expect(() => ctx.mailbox.postFromMain({
      projectId: first.id,
      nodeId: work.node.id,
      body: "Do not run",
    })).toThrow(expect.objectContaining({ code: "project-unavailable" }));
    expect(ctx.mailbox.getHistory(first.id)).toEqual([]);
  });

  it("restores a detached immutable history and continues its sequence", async () => {
    const source = await domain();
    const project = source.projects.create({ goal: "Replay mailbox" });
    const node = source.nodes.create({ projectId: project.id, objective: objective("collect evidence") });
    source.mailbox.postFromNode({ projectId: project.id, nodeId: node.node.id, body: "Evidence collected" });
    source.mailbox.postFromMain({ projectId: project.id, nodeId: node.node.id, body: "Preserve references" });

    const projectHistory = JSON.parse(JSON.stringify(source.projects.getEvents(project.id)));
    const nodeHistory = JSON.parse(JSON.stringify(source.nodes.getEvents(node.node.id)));
    const mailboxHistory = JSON.parse(JSON.stringify(source.mailbox.getHistory(project.id)));

    const target = await domain();
    target.projects.restore(project.id, projectHistory);
    target.nodes.restore(node.node.id, nodeHistory);
    const restored = target.mailbox.restore(project.id, mailboxHistory);

    mailboxHistory[0].body = "mutated outside";
    mailboxHistory.push(mailboxHistory[0]);
    expect(restored).toHaveLength(2);
    expect(restored[0]?.body).toBe("Evidence collected");
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored[0])).toBe(true);

    const next = target.mailbox.postFromMain({
      projectId: project.id,
      nodeId: node.node.id,
      body: "Next instruction",
    });
    expect(next.sequence).toBe(3);
  });

  it("rejects invalid replay routes and malformed histories atomically", async () => {
    const source = await domain();
    const project = source.projects.create({ goal: "Validate replay" });
    const first = source.nodes.create({ projectId: project.id, objective: objective("first") });
    const second = source.nodes.create({ projectId: project.id, objective: objective("second") });
    const message = source.mailbox.postFromNode({
      projectId: project.id,
      nodeId: first.node.id,
      body: "Need coordination",
    });

    const target = await domain();
    target.projects.restore(project.id, JSON.parse(JSON.stringify(source.projects.getEvents(project.id))));
    target.nodes.restore(first.node.id, JSON.parse(JSON.stringify(source.nodes.getEvents(first.node.id))));
    target.nodes.restore(second.node.id, JSON.parse(JSON.stringify(source.nodes.getEvents(second.node.id))));

    const nodeToNode = [{
      ...JSON.parse(JSON.stringify(message)),
      recipient: { kind: "node", nodeId: second.node.id },
    }];
    expect(() => target.mailbox.restore(project.id, nodeToNode))
      .toThrow(expect.objectContaining({ code: "invalid-route" }));
    expect(target.mailbox.getHistory(project.id)).toEqual([]);

    const malformed = [{ ...JSON.parse(JSON.stringify(message)), sequence: 2 }];
    expect(() => target.mailbox.restore(project.id, malformed))
      .toThrow(expect.objectContaining({ code: "invalid-history" }));
    expect(target.mailbox.getHistory(project.id)).toEqual([]);

    expect(() => target.mailbox.restore(createProjectId("missing"), []))
      .toThrow(expect.objectContaining({ code: "project-unavailable" }));
  });

  it("is mounted in NavoApp without requiring AgentRuntime to post messages", async () => {
    const bare = await domain();
    const bareProject = bare.projects.create({ goal: "No runtime dependency" });
    const bareNode = bare.nodes.create({ projectId: bareProject.id, objective: objective("local") });
    expect(bare.mailbox.postFromNode({
      projectId: bareProject.id,
      nodeId: bareNode.node.id,
      body: "Stored without AgentRuntime",
    }).sequence).toBe(1);

    const app = await createApp({ node: { session: { model: { provider: "mock", model: "test" } } } });
    contexts.push(app);
    const project = app.projects.create({ goal: "Mounted mailbox" });
    const node = app.nodes.create({ projectId: project.id, objective: objective("app work") });
    expect(app.mailbox.postFromMain({
      projectId: project.id,
      nodeId: node.node.id,
      body: "Stored in app mailbox",
    }).sequence).toBe(1);
  });
});
