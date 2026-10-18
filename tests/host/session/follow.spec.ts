import { describe, expect, it, vi } from "vitest";

import { sessionContextFollowMethod } from "../../../rpc/session.js";
import type { SessionContextFollowEventV1 } from "../../../rpc/session.js";
import type { ModelEvent } from "../../../src/llm/types.js";
import {
  appendAssistant,
  appendUser,
  compact,
  delay,
  host,
  seedConversation,
  session,
} from "./helpers.js";
import { modelResponse } from "../../helpers/runtime.js";

const TIMEOUT = Symbol("timeout");

async function nextFrame(
  iterator: AsyncIterator<SessionContextFollowEventV1>,
  timeoutMs = 2_000,
): Promise<IteratorResult<SessionContextFollowEventV1>> {
  const result = await Promise.race([iterator.next(), delay(timeoutMs).then(() => TIMEOUT)]);
  if (typeof result === "symbol") throw new Error("Session context follow frame timed out");
  return result;
}

async function expectNoFrame(
  iterator: AsyncIterator<SessionContextFollowEventV1>,
  controller: AbortController,
): Promise<void> {
  const pending = iterator.next().catch((error: unknown) => error);
  const result = await Promise.race([pending, delay(50).then(() => TIMEOUT)]);
  expect(result).toBe(TIMEOUT);
  controller.abort();
  await pending;
}

async function close(
  iterator: AsyncIterator<SessionContextFollowEventV1>,
  controller: AbortController,
): Promise<void> {
  controller.abort();
  await iterator.return?.();
}

describe("Kernel Host session.context.follow.v1", () => {
  it("starts with a snapshot before any other frame", async () => {
    const { ctx, client } = await host();
    const sessionId = session("follow-snapshot");
    appendUser(ctx, sessionId, "follow-snapshot-user", "hello");
    const controller = new AbortController();
    const iterator = client.stream(sessionContextFollowMethod,
      { sessionId: String(sessionId) }, { signal: controller.signal })[Symbol.asyncIterator]();

    const first = await nextFrame(iterator);
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ type: "snapshot" });
    if (first.value?.type !== "snapshot") return;
    expect(first.value.snapshot.sessionId).toBe(sessionId);
    expect(first.value.snapshot.eventSequence).toBe(1);
    await close(iterator, controller);
  });

  it("emits ordered context updates for visible messages", async () => {
    const { ctx, client } = await host();
    const sessionId = session("follow-updates");
    const controller = new AbortController();
    const iterator = client.stream(sessionContextFollowMethod,
      { sessionId: String(sessionId) }, { signal: controller.signal })[Symbol.asyncIterator]();
    await nextFrame(iterator);

    appendUser(ctx, sessionId, "follow-user-1", "one");
    const first = await nextFrame(iterator);
    expect(first.value).toMatchObject({ type: "context-updated" });
    if (first.value?.type !== "context-updated") return;
    expect(first.value.snapshot.eventSequence).toBe(1);

    appendAssistant(ctx, sessionId, "follow-assistant-1", "two");
    const second = await nextFrame(iterator);
    expect(second.value).toMatchObject({ type: "context-updated" });
    if (second.value?.type !== "context-updated") return;
    expect(second.value.snapshot.eventSequence).toBe(2);
    expect(second.value.snapshot.measurement.usedTokens)
      .toBeGreaterThanOrEqual(first.value.snapshot.measurement.usedTokens);
    await close(iterator, controller);
  });

  it("does not forward another Session's events or duplicate a committed event", async () => {
    const { ctx, client } = await host();
    const sessionId = session("follow-isolated");
    const otherId = session("follow-other");
    const controller = new AbortController();
    const iterator = client.stream(sessionContextFollowMethod,
      { sessionId: String(sessionId) }, { signal: controller.signal })[Symbol.asyncIterator]();
    await nextFrame(iterator);

    appendUser(ctx, otherId, "other-user", "not mine");
    await expectNoFrame(iterator, controller);

    const secondController = new AbortController();
    const second = client.stream(sessionContextFollowMethod,
      { sessionId: String(sessionId) }, { signal: secondController.signal })[Symbol.asyncIterator]();
    await nextFrame(second);
    appendUser(ctx, sessionId, "isolated-user", "mine");
    const update = await nextFrame(second);
    expect(update.value).toMatchObject({ type: "context-updated" });
    const event = ctx.sessions.getEvents(sessionId).at(-1)!;
    await ctx.parallel("session/event", event);
    await expectNoFrame(second, secondController);
  });

  it("observes started, checkpoint and ended in order with one context snapshot", async () => {
    const { ctx, client } = await host([
      modelResponse([{ type: "text", text: "## Summary\n- Keep the task." }]),
    ]);
    const sessionId = session("follow-compaction");
    seedConversation(ctx, sessionId, 8, 1_200);
    const controller = new AbortController();
    const iterator = client.stream(sessionContextFollowMethod,
      { sessionId: String(sessionId) }, { signal: controller.signal })[Symbol.asyncIterator]();
    await nextFrame(iterator);

    const running = compact(ctx, sessionId);
    const frames: SessionContextFollowEventV1[] = [];
    while (frames.length < 20) {
      const next = await nextFrame(iterator);
      if (next.done) break;
      frames.push(next.value!);
      if (next.value?.type === "compaction-event" && next.value.event.kind === "ended") break;
    }
    await running;

    const compaction = frames.filter((frame): frame is Extract<
      SessionContextFollowEventV1, { type: "compaction-event" }
    > => frame.type === "compaction-event").map(frame => frame.event);
    expect(compaction.map(event => event.kind)).toEqual(["started", "checkpoint", "ended"]);
    const checkpoint = compaction[1];
    expect(checkpoint).toMatchObject({
      kind: "checkpoint", summaryVersion: 1, surfaceGeneration: 1,
    });
    expect(compaction[0]).toMatchObject({ kind: "started", trigger: "manual" });
    expect(compaction[2]).toMatchObject({ kind: "ended", status: "completed" });
    const checkpointIndex = frames.findIndex(frame =>
      frame.type === "compaction-event" && frame.event.kind === "checkpoint");
    const updateIndex = frames.findIndex(frame => frame.type === "context-updated");
    expect(updateIndex).toBeGreaterThan(checkpointIndex);
    const update = frames[updateIndex];
    expect(update?.type === "context-updated" ? update.snapshot.surfaceGeneration : -1).toBe(1);
    await close(iterator, controller);
  });

  it("uses a mid-compaction baseline without replaying started", async () => {
    const release = Promise.withResolvers<void>();
    const { ctx, client } = await host([{
      kind: "handler",
      async *handle(): AsyncIterable<ModelEvent> {
        await release.promise;
        yield* summaryEvents();
      },
    }]);
    const sessionId = session("follow-mid-compaction");
    seedConversation(ctx, sessionId, 8, 1_200);
    const running = compact(ctx, sessionId);
    await vi.waitFor(() => {
      expect(ctx.sessions.getEvents(sessionId).some(event => event.type === "compaction-started"))
        .toBe(true);
    });

    const controller = new AbortController();
    const iterator = client.stream(sessionContextFollowMethod,
      { sessionId: String(sessionId) }, { signal: controller.signal })[Symbol.asyncIterator]();
    const first = await nextFrame(iterator);
    expect(first.value?.type).toBe("snapshot");
    const startedSequence = ctx.sessions.getEvents(sessionId)
      .find(event => event.type === "compaction-started")!.sequence;
    if (first.value?.type === "snapshot") {
      expect(first.value.snapshot.eventSequence).toBeGreaterThanOrEqual(startedSequence);
    }

    release.resolve();
    const frames: SessionContextFollowEventV1[] = [];
    while (frames.length < 20) {
      const next = await nextFrame(iterator);
      if (next.done) break;
      frames.push(next.value!);
      if (next.value?.type === "compaction-event" && next.value.event.kind === "ended") break;
    }
    await running;

    const kinds = frames.flatMap(frame =>
      frame.type === "compaction-event" ? [frame.event.kind] : []);
    expect(kinds).toEqual(["checkpoint", "ended"]);
    await close(iterator, controller);
  });

  it("ends the queue after cancellation and releases the listener", async () => {
    const { ctx, client } = await host();
    const sessionId = session("follow-cancel");
    const controller = new AbortController();
    const iterator = client.stream(sessionContextFollowMethod,
      { sessionId: String(sessionId) }, { signal: controller.signal })[Symbol.asyncIterator]();
    await nextFrame(iterator);

    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: "cancelled" });
    appendUser(ctx, sessionId, "after-cancel", "ignored");
    await delay(20);
  });
});

function summaryEvents(): readonly ModelEvent[] {
  return modelResponse([{ type: "text", text: "## Summary\n- Keep the task." }]).events;
}
