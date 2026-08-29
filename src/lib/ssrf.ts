import { lookup } from "node:dns/promises";
import type dns from "node:dns";
import { isIP } from "node:net";

import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";

const DNS_TIMEOUT_MS = 5_000;

export function isBlockedAddress(ip: string): boolean {
  const trimmed = ip.trim();
  if (/^::5efe:/i.test(trimmed)) {
    // ISATAP (::5efe:a.b.c.d) embeds an IPv4 address.
    const embedded = trimmed.slice(trimmed.lastIndexOf(":") + 1);
    return isBlockedAddress(embedded);
  }
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(trimmed);
  } catch {
    return true;
  }
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      return isBlockedAddress(v6.toIPv4Address().toString());
    }
  }
  return addr.range() !== "unicast";
}

export function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost") return true;
  if (isIP(normalized) !== 0) return isBlockedAddress(normalized);
  return false;
}

export async function isPublicHostname(hostname: string): Promise<boolean> {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isPrivateHost(normalized)) return false;
  if (isIP(normalized) !== 0) return true;
  try {
    const addresses = await lookupHostnames(normalized);
    return addresses.every(({ address }) => !isBlockedAddress(address));
  } catch {
    return false;
  }
}

export function lookupHostnames(
  hostname: string,
): Promise<readonly { address: string }[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("DNS lookup timed out"));
    }, DNS_TIMEOUT_MS);
    timer.unref();
    void lookup(hostname, { all: true, verbatim: true }).then(
      (addresses) => {
        clearTimeout(timer);
        resolve(addresses);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

type SsrfCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | dns.LookupAddress[],
  family?: number,
) => void;

type SsrfLookup = (
  hostname: string,
  options: dns.LookupOptions,
  callback: SsrfCallback,
) => void;

const ssrfLookup: SsrfLookup = (hostname, options, callback) => {
  const timer = setTimeout(() => {
    callback(new Error(`SSRF: DNS lookup for ${hostname} timed out`));
  }, DNS_TIMEOUT_MS);
  timer.unref();
  void lookup(hostname, { all: true, verbatim: true }).then(
    (addresses) => {
      clearTimeout(timer);
      if (addresses.some(({ address }) => isBlockedAddress(address))) {
        callback(new Error(`SSRF: ${hostname} resolved to a blocked address`));
        return;
      }
      if (options.all) {
        callback(null, addresses);
        return;
      }
      const first = addresses[0];
      if (first === undefined) {
        callback(new Error(`SSRF: ${hostname} resolved to no addresses`));
        return;
      }
      callback(null, first.address, first.family);
    },
    (error) => {
      clearTimeout(timer);
      callback(error instanceof Error ? error : new Error(String(error)));
    },
  );
};

const ssrfAgent = new Agent({
  connect: { lookup: ssrfLookup as unknown as never },
});

export const safeFetch: typeof fetch = (input, init): Promise<Response> => {
  return undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    init === undefined
      ? { dispatcher: ssrfAgent, redirect: "manual" }
      : { ...init, dispatcher: ssrfAgent, redirect: init.redirect ?? "manual" },
  );
};
