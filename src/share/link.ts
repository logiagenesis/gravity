/**
 * Share links.
 *
 * A scenario is compressed and encoded into the URL **fragment**, not the query
 * string. That is deliberate: fragments are never sent to the server, so
 * sharing a scenario leaks nothing to the host, any CDN, or any proxy in
 * between. It also means sharing needs no backend at all.
 *
 * Encoding uses the platform CompressionStream where available and falls back
 * to plain base64url otherwise, so an older browser still produces a working
 * (longer) link rather than failing.
 */
import { migrateAndParse } from "../schema/migrations";
import type { Scenario } from "../schema/scenario";

const PREFIX_COMPRESSED = "z:";
const PREFIX_PLAIN = "p:";

/**
 * Links longer than this are refused. Browsers and chat clients truncate very
 * long URLs, and a silently truncated link that fails on the recipient's
 * machine is worse than an upfront refusal.
 */
export const MAX_SHARE_LENGTH = 8000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function supportsCompression(): boolean {
  return typeof CompressionStream !== "undefined";
}

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

export class ShareLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareLinkError";
  }
}

/** Encode a scenario as a fragment payload. */
export async function encodeScenario(scenario: Scenario): Promise<string> {
  const json = JSON.stringify(scenario);

  let payload: string;
  if (supportsCompression()) {
    payload = PREFIX_COMPRESSED + bytesToBase64Url(await deflate(json));
  } else {
    payload = PREFIX_PLAIN + bytesToBase64Url(new TextEncoder().encode(json));
  }

  if (payload.length > MAX_SHARE_LENGTH) {
    throw new ShareLinkError(
      `This scenario is too large to share as a link (${payload.length} characters, ` +
        `limit ${MAX_SHARE_LENGTH}). Export it as a file instead.`,
    );
  }
  return payload;
}

/** Decode and VALIDATE a fragment payload. Never returns unvalidated data. */
export async function decodeScenario(payload: string): Promise<Scenario> {
  let json: string;

  try {
    if (payload.startsWith(PREFIX_COMPRESSED)) {
      const bytes = base64UrlToBytes(payload.slice(PREFIX_COMPRESSED.length));
      json = await inflate(bytes);
    } else if (payload.startsWith(PREFIX_PLAIN)) {
      json = new TextDecoder().decode(
        base64UrlToBytes(payload.slice(PREFIX_PLAIN.length)),
      );
    } else {
      throw new ShareLinkError(
        "This link is not in a format this version understands.",
      );
    }
  } catch (error) {
    if (error instanceof ShareLinkError) throw error;
    throw new ShareLinkError(
      "This share link is damaged and could not be read. It may have been truncated when it was copied.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ShareLinkError("This share link does not contain a readable scenario.");
  }

  // Full schema validation. A share link is untrusted input from a third party.
  return migrateAndParse(parsed);
}

/** Build a full shareable URL for a scenario. */
export async function buildShareUrl(
  scenario: Scenario,
  baseUrl: string,
): Promise<string> {
  const payload = await encodeScenario(scenario);
  const url = new URL(baseUrl);
  url.hash = `#/shared/${payload}`;
  return url.toString();
}

/** Extract a share payload from a location hash, if present. */
export function sharePayloadFromHash(hash: string): string | null {
  const match = /^#\/shared\/(.+)$/.exec(hash);
  return match ? match[1] : null;
}

/** Serialise a scenario for file export. */
export function exportScenarioFile(scenario: Scenario): Blob {
  return new Blob([`${JSON.stringify(scenario, null, 2)}\n`], {
    type: "application/json",
  });
}

/** Read and VALIDATE an imported file. */
export async function importScenarioFile(file: File): Promise<Scenario> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ShareLinkError(`"${file.name}" is not valid JSON.`);
  }
  return migrateAndParse(parsed);
}
