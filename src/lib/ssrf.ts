import { lookup } from "node:dns/promises";

const DNS_TIMEOUT_MS = 5_000;

export function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost") return true;
  if (normalized.includes(":")) return isPrivateIpv6(normalized);
  return isPrivateIpv4(normalized);
}

export async function isPublicHostname(hostname: string): Promise<boolean> {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isPrivateHost(normalized)) return false;
  if (normalized.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(normalized)) {
    return true;
  }
  try {
    const addresses = await lookupHostnames(normalized);
    return addresses.every(({ address }) => !isPrivateHost(address));
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

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [a, b] = octets;
  if (a === undefined || b === undefined) return false;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (octets[2] === 0 || octets[2] === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && octets[2] === 100) return true;
  if (a === 203 && b === 0 && octets[2] === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1" || lower === "0:0:0:0:0:0:0:1") {
    return true;
  }
  if (
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  ) {
    return true;
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("ff")) return true;
  if (lower.startsWith("2001:db8")) return true;
  if (lower.startsWith("64:ff9b")) return true;
  if (lower.startsWith("::ffff:")) {
    return isPrivateEmbeddedIpv4(lower.slice("::ffff:".length));
  }
  if (lower.startsWith("0:0:0:0:0:ffff:")) {
    return isPrivateEmbeddedIpv4(lower.slice("0:0:0:0:0:ffff:".length));
  }
  if (lower.startsWith("::")) {
    return isPrivateEmbeddedIpv4(lower.slice(2));
  }
  return false;
}

function isPrivateEmbeddedIpv4(embedded: string): boolean {
  if (embedded.includes(".")) return isPrivateIpv4(embedded);
  const hex = embedded.replace(/:/g, "");
  if (!/^[0-9a-f]{8}$/.test(hex)) return true;
  return isPrivateIpv4(
    [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      Number.parseInt(hex.slice(6, 8), 16),
    ].join("."),
  );
}
