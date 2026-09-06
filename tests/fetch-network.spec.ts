import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPinnedLookup,
  isPublicIpAddress,
  requestPinned,
  resolvePublicAddresses,
} from "../src/tools/builtins/fetch/network.js";
import {
  isSameOrigin,
  validateFetchUrl,
} from "../src/tools/builtins/fetch/policy.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Fetch URL and public address policy", () => {
  it("accepts HTTP(S) and rejects credentials, schemes, and long URLs", () => {
    expect(validateFetchUrl("https://example.test/a").pathname).toBe("/a");
    expect(() => validateFetchUrl("file:///secret"))
      .toThrow(expect.objectContaining({ code: "invalid-url" }));
    expect(() => validateFetchUrl("https://user:pass@example.test"))
      .toThrow(expect.objectContaining({ code: "blocked-url" }));
    expect(() => validateFetchUrl(`https://example.test/${"x".repeat(2048)}`))
      .toThrow(expect.objectContaining({ code: "invalid-url" }));
    expect(isSameOrigin(
      new URL("https://example.test/a"),
      new URL("https://example.test/b"),
    )).toBe(true);
    expect(isSameOrigin(
      new URL("https://example.test"),
      new URL("http://example.test"),
    )).toBe(false);
  });

  it("accepts public unicast and rejects special IPv4 and IPv6 ranges", () => {
    for (const address of ["8.8.8.8", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
      expect(isPublicIpAddress(address), address).toBe(true);
    }
    for (const address of [
      "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1",
      "169.254.169.254", "192.0.2.1", "224.0.0.1", "::", "::1",
      "fe80::1", "fc00::1", "ff02::1", "::ffff:127.0.0.1",
      "64:ff9b::808:808", "not-an-ip",
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
  });

  it("rejects an entire mixed DNS set", async () => {
    const resolver = vi.fn(async () => [
      { address: "8.8.8.8", family: 4 as const },
      { address: "127.0.0.1", family: 4 as const },
    ]);
    await expect(resolvePublicAddresses(
      "mixed.test",
      new AbortController().signal,
      resolver,
    )).rejects.toMatchObject({ code: "blocked-url" });
  });

  it("detects private IPv4 translated through a discovered NAT64 prefix", async () => {
    const resolver = vi.fn(async (hostname: string) => hostname === "ipv4only.arpa"
      ? [{ address: "2001:4860:64:64::c000:aa", family: 6 as const }]
      : [{ address: "2001:4860:64:64::7f00:1", family: 6 as const }]);
    await expect(resolvePublicAddresses(
      "nat64.test",
      new AbortController().signal,
      resolver,
    )).rejects.toMatchObject({ code: "blocked-url" });
  });

  it("stops waiting for an unresolved DNS operation when cancelled", async () => {
    const resolver = vi.fn(() => new Promise<never[]>(() => undefined));
    const controller = new AbortController();
    const pending = resolvePublicAddresses("slow.test", controller.signal, resolver);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });
});

describe("pinned HTTP connection", () => {
  it("serves only retained addresses through the lookup callback", async () => {
    const lookup = createPinnedLookup([
      { address: "8.8.8.8", family: 4 },
      { address: "2001:4860:4860:0:0:0:0:8888", family: 6 },
    ]);
    const call = (family: 4 | 6) => new Promise<unknown>((resolve) => {
      lookup("ignored.test", { family }, (error, address, resultFamily) => {
        resolve({ error, address, family: resultFamily });
      });
    });

    await expect(call(4)).resolves.toMatchObject({
      error: null,
      address: "8.8.8.8",
      family: 4,
    });
    await expect(call(6)).resolves.toMatchObject({
      error: null,
      address: "2001:4860:4860:0:0:0:0:8888",
      family: 6,
    });
  });

  it("connects to a pinned address without resolving the URL hostname", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("pinned");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const pinned = await requestPinned(
        new URL(`http://does-not-resolve.invalid:${port}/`),
        [{ address: "127.0.0.1", family: 4 }],
        {},
        new AbortController().signal,
      );
      try {
        await expect(pinned.response.text()).resolves.toBe("pinned");
      } finally {
        await pinned.close();
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error) reject(error);
        else resolve();
      }));
    }
  });
});
