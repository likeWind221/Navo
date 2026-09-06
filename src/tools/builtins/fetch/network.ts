import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup as systemLookup } from "node:dns/promises";
import { isIP } from "node:net";

import ipaddr from "ipaddr.js";
import type { Response } from "undici";

import { FetchError } from "./errors.js";

/** One public address retained from validation through connection setup. */
export interface PublicAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Response plus the private Undici dispatcher owned by this request. */
export interface PinnedResponse {
  readonly response: Response;
  close(): Promise<void>;
}

export type AddressResolver = (
  hostname: string,
  options: { readonly all: true; readonly order: "verbatim" },
) => Promise<LookupAddress[]>;

type PrefixLength = 32 | 40 | 48 | 56 | 64 | 96;

interface Nat64Prefix {
  readonly bytes: readonly number[];
  readonly length: PrefixLength;
}

const NAT64_PREFIX_LENGTHS: readonly PrefixLength[] = [32, 40, 48, 56, 64, 96];
const IPV4ONLY_HOST = "ipv4only.arpa";
const IPV4ONLY_SENTINELS = new Set(["192.0.0.170", "192.0.0.171"]);

/** Accept only globally reachable unicast, including mapped public IPv4. */
export function isPublicIpAddress(input: string): boolean {
  let address: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    address = ipaddr.parse(stripIpv6Brackets(input));
  } catch {
    return false;
  }
  if (address instanceof ipaddr.IPv4) return address.range() === "unicast";
  if (address.isIPv4MappedAddress()) {
    return address.toIPv4Address().range() === "unicast";
  }
  return address.range() === "unicast";
}

/** Resolve once, reject a mixed unsafe set, and retain the validated addresses. */
export async function resolvePublicAddresses(
  hostname: string,
  signal: AbortSignal,
  resolver: AddressResolver = systemLookup,
): Promise<readonly PublicAddress[]> {
  assertActive(signal);
  const bareHostname = stripIpv6Brackets(hostname);
  const literalFamily = isIP(bareHostname);
  const resolved = literalFamily === 0
    ? await resolveWithSignal(bareHostname, signal, resolver)
    : [{ address: bareHostname, family: literalFamily }];
  if (resolved.length === 0) {
    throw new FetchError("dns-failed", `Hostname '${hostname}' resolved empty.`);
  }

  const hasIpv6 = resolved.some((item) =>
    item.family === 6 && isIP(item.address) === 6);
  const prefixes = hasIpv6
    ? await discoverNat64Prefixes(signal, resolver)
    : [];
  const accepted: PublicAddress[] = [];
  for (const item of resolved) {
    if ((item.family !== 4 && item.family !== 6) ||
        isIP(item.address) !== item.family) {
      throw new FetchError(
        "dns-failed",
        `Hostname '${hostname}' returned an invalid address family.`,
      );
    }
    if (!isPublicIpAddress(item.address)) {
      throw new FetchError(
        "blocked-url",
        `Hostname '${hostname}' resolved to a non-public address.`,
      );
    }
    const translated = translatedIpv4Address(item.address, prefixes);
    if (translated !== undefined && !isPublicIpAddress(translated)) {
      throw new FetchError(
        "blocked-url",
        `Hostname '${hostname}' resolves through NAT64 to a blocked address.`,
      );
    }
    accepted.push(Object.freeze({
      address: canonicalIp(item.address),
      family: item.family,
    }));
  }
  return Object.freeze(accepted);
}

/** Execute GET through a dispatcher that can only use validated addresses. */
export async function requestPinned(
  url: URL,
  addresses: readonly PublicAddress[],
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
): Promise<PinnedResponse> {
  assertActive(signal);
  if (addresses.length === 0) {
    throw new FetchError("dns-failed", "Pinned request received no addresses.");
  }
  const { Agent, fetch } = await import("undici");
  const dispatcher = new Agent({
    autoSelectFamily: true,
    connect: { lookup: createPinnedLookup(addresses) },
  });
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers,
      signal,
      dispatcher,
    });
    return Object.freeze({
      response,
      close: async () => { await dispatcher.close(); },
    });
  } catch (error: unknown) {
    await dispatcher.close();
    if (signal.aborted) {
      throw new FetchError("aborted", "Pinned request was cancelled.", {
        cause: error,
      });
    }
    throw new FetchError("network-failed", "Pinned HTTP request failed.", {
      cause: error,
    });
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** Create a Node lookup callback that never performs another DNS query. */
export function createPinnedLookup(addresses: readonly PublicAddress[]): (
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
) => void {
  return (hostname, options, callback): void => {
    const family = typeof options.family === "number"
      ? options.family
      : options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : 0;
    const eligible = family === 0
      ? addresses
      : addresses.filter((address) => address.family === family);
    const selected = eligible[0];
    if (selected === undefined) {
      const error = Object.assign(
        new Error(`No pinned address for '${hostname}' family ${family}.`),
        { code: "ENOTFOUND", hostname },
      );
      callback(error, options.all === true ? [] : "", family);
      return;
    }
    if (options.all === true) {
      callback(null, eligible.map((address) => ({ ...address })));
      return;
    }
    callback(null, selected.address, selected.family);
  };
}

/** Mutable method slots allow focused tests to replace network effects only. */
export const publicFetchNetwork = {
  resolve: resolvePublicAddresses,
  request: requestPinned,
};

async function discoverNat64Prefixes(
  signal: AbortSignal,
  resolver: AddressResolver,
): Promise<Nat64Prefix[]> {
  const answers = await resolveWithSignal(IPV4ONLY_HOST, signal, resolver);
  const prefixes: Nat64Prefix[] = [];
  const seen = new Set<string>();
  for (const answer of answers) {
    if (answer.family !== 6 || isIP(answer.address) !== 6) continue;
    const bytes = ipaddr.parse(answer.address).toByteArray();
    for (const length of NAT64_PREFIX_LENGTHS) {
      const embedded = embeddedIpv4Address(bytes, length);
      if (embedded === undefined || !IPV4ONLY_SENTINELS.has(embedded)) continue;
      const prefix = bytes.slice(0, length / 8);
      const key = `${length}:${prefix.join(".")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      prefixes.push(Object.freeze({ bytes: Object.freeze(prefix), length }));
    }
  }
  return prefixes;
}

function translatedIpv4Address(
  input: string,
  prefixes: readonly Nat64Prefix[],
): string | undefined {
  if (isIP(input) !== 6) return undefined;
  const bytes = ipaddr.parse(input).toByteArray();
  for (const prefix of prefixes) {
    if (!prefix.bytes.every((byte, index) => bytes[index] === byte)) continue;
    const embedded = embeddedIpv4Address(bytes, prefix.length);
    if (embedded !== undefined) return embedded;
  }
  return undefined;
}

function embeddedIpv4Address(
  bytes: readonly number[],
  prefixLength: PrefixLength,
): string | undefined {
  if (prefixLength === 96) return bytes.slice(12, 16).join(".");
  if (bytes[8] !== 0) return undefined;
  const prefixBytes = prefixLength / 8;
  const beforeReserved = 8 - prefixBytes;
  return [
    ...bytes.slice(prefixBytes, prefixBytes + beforeReserved),
    ...bytes.slice(9, 9 + 4 - beforeReserved),
  ].join(".");
}

async function resolveWithSignal(
  hostname: string,
  signal: AbortSignal,
  resolver: AddressResolver,
): Promise<LookupAddress[]> {
  assertActive(signal);
  try {
    return await raceWithSignal(
      resolver(hostname, { all: true, order: "verbatim" }),
      signal,
    );
  } catch (error: unknown) {
    if (error instanceof FetchError) throw error;
    if (signal.aborted) {
      throw new FetchError("aborted", "Fetch DNS lookup was cancelled.", {
        cause: error,
      });
    }
    throw new FetchError("dns-failed", `DNS lookup failed for '${hostname}'.`, {
      cause: error,
    });
  }
}

function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  assertActive(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(new FetchError(
      "aborted",
      "Fetch was cancelled during DNS lookup.",
      { cause: signal.reason },
    ));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new FetchError("aborted", "Fetch network operation was cancelled.");
  }
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function canonicalIp(input: string): string {
  return ipaddr.parse(input).toNormalizedString();
}
