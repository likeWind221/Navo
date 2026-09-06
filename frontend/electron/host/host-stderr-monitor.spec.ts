import { describe, expect, it, vi } from "vitest";

import { HostStderrMonitor, redactHostLog } from "./host-stderr-monitor.js";

describe("HostStderrMonitor", () => {
  it("recognizes a split ready marker and redacts credential-shaped logs", () => {
    const onReady = vi.fn();
    const logs: string[] = [];
    const monitor = new HostStderrMonitor({
      readyMarker: "[kernel-host] ready",
      secrets: ["exact-secret"],
      onReady,
      onLog: (line) => logs.push(line),
    });

    monitor.push(Buffer.from("[kernel-host] rea"));
    monitor.push(Buffer.from("dy Bearer token exact-secret\n"));

    expect(onReady).toHaveBeenCalledOnce();
    expect(logs).toEqual(["[kernel-host] ready Bearer [REDACTED] [REDACTED]"]);
  });

  it("drops an oversized stderr line instead of leaking fragments", () => {
    const logs: string[] = [];
    const monitor = new HostStderrMonitor({
      readyMarker: "ready",
      maxLineChars: 4,
      onReady: vi.fn(),
      onLog: (line) => logs.push(line),
    });

    monitor.push(Buffer.from("sensitive"));
    monitor.push(Buffer.from(" tail\n"));

    expect(logs).toEqual(["[kernel-host] stderr line exceeded the safe log limit"]);
  });
});

describe("redactHostLog", () => {
  it("redacts common API key and authorization formats", () => {
    expect(redactHostLog("api_key=abc authorization: xyz"))
      .toBe("api_key=[REDACTED] authorization: [REDACTED]");
  });
});
