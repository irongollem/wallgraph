// The plan-in-a-URL channel: a whole document carried in the fragment.
//
// This is the one way into the editor that needs no clicking, no clipboard and
// no file picker — paste a link, get that plan — which is what makes the editor
// drivable by an agent, a script, or a chat message. The fragment is deliberate:
// everything after `#` stays in the browser and is never sent to the server, so
// a plan handed over this way is no more public than the link itself.
//
// It also has to be self-contained. The site's CSP is `connect-src 'self'`, so
// a `?plan=https://…` that fetched the document would simply be blocked — and
// rightly, since it would turn every link into a request the visitor did not
// make. The document travels in the link or not at all.
//
// base64url (RFC 4648 §5) rather than plain base64: `+` and `/` survive a
// fragment but not every chat client's link detector, and `=` padding is noise.
import { PlanDoc } from "../model/doc";
import { parseDoc } from "./json";

/** The fragment key. A full link is `<page>#plan=<payload>`. */
export const PLAN_PARAM = "plan";

// btoa works on binary strings, so the UTF-8 bytes are walked in chunks —
// `String.fromCharCode(...bytes)` on a whole document overflows the argument
// limit somewhere around a hundred thousand characters.
const CHUNK = 0x2000;

function toBinary(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/**
 * Marks a DEFLATE-compressed payload. `.` is outside the base64url alphabet, so
 * a payload carrying it cannot be a plain one.
 */
const DEFLATED = "z.";

/** Above this, an inflating payload is abandoned rather than read to the end. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

function toBase64Url(bytes: Uint8Array): string {
  return btoa(toBinary(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Runs `bytes` through a (de)compression stream, stopping past `limit` bytes. */
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream,
  limit = Infinity): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new RangeError("payload too large"); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * A document as a payload, without the `plan=` key: raw DEFLATE (RFC 1951) of
 * the JSON, base64url-encoded behind the `z.` marker, about a quarter of the
 * plain base64url length for the demo plan.
 *
 * Every floor's `underlay` is stripped first: it is a tracing aid carrying a
 * downscaled but still multi-hundred-KB data URL, and the fragment is the one
 * channel with a real size limit -- browsers and chat clients alike start
 * truncating or rejecting a URL well under a megabyte. A share link carries
 * the drawing, not the scan; JSON export/import keeps it (see io/json.ts).
 */
export async function encodePlan(doc: PlanDoc): Promise<string> {
  const stripped: PlanDoc = doc.floors.some(f => f.underlay)
    ? { ...doc, floors: doc.floors.map(f => {
        if (!f.underlay) return f;
        const { underlay: _drop, ...rest } = f;
        return rest;
      }) }
    : doc;
  const json = new TextEncoder().encode(JSON.stringify(stripped));
  return DEFLATED + toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

/**
 * A payload back to a document, or null if it is not one. Reads both the
 * compressed form `encodePlan()` writes and plain base64url JSON, which is what
 * an agent or a script composes without a compressor.
 */
export async function decodePlan(payload: string): Promise<PlanDoc | null> {
  try {
    const bytes = payload.startsWith(DEFLATED)
      ? await pipe(fromBase64Url(payload.slice(DEFLATED.length)),
          new DecompressionStream("deflate-raw"), MAX_INFLATED_BYTES)
      : fromBase64Url(payload);
    return parseDoc(new TextDecoder().decode(bytes));
  } catch { return null; }
}

/**
 * The fragment with the plan taken out, `#` and all when nothing else is left.
 *
 * A link's plan replaces whatever the visitor had, so it must land once and not
 * again: left in the address bar it would replay on every refresh and take an
 * afternoon's drawing with it. Other keys — `lang` — are what the visitor chose
 * to arrive with and stay.
 */
export function hashWithoutPlan(hash: string): string {
  const rest = new URLSearchParams(hash.replace(/^#/, ""));
  rest.delete(PLAN_PARAM);
  const tail = rest.toString();
  return tail ? "#" + tail : "";
}

/**
 * The document a URL fragment carries, or null when it carries none.
 *
 * Reads the fragment as a query string so `#plan=…&lang=nl` works and the order
 * does not matter. A malformed payload returns null rather than throwing: a link
 * someone truncated should open the editor, not break the page.
 */
export async function planFromHash(hash: string): Promise<PlanDoc | null> {
  const payload = new URLSearchParams(hash.replace(/^#/, "")).get(PLAN_PARAM);
  return payload ? decodePlan(payload) : null;
}

/** A shareable link to `base` (default: this page) carrying `doc`. */
export async function planLink(doc: PlanDoc, base: string): Promise<string> {
  return `${base.split("#")[0]}#${PLAN_PARAM}=${await encodePlan(doc)}`;
}

export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

/**
 * Hands a plan link to the system share sheet where the browser offers one, and
 * to the clipboard otherwise. A dismissed sheet is `"cancelled"`, not a reason
 * to copy: the visitor chose not to share.
 */
export async function sharePlan(doc: PlanDoc, base: string): Promise<ShareResult> {
  const url = await planLink(doc, base);
  if (typeof navigator.share === "function") {
    try { await navigator.share({ url }); return "shared"; }
    catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // NotAllowedError in a sandboxed frame or without permission: fall through.
    }
  }
  try { await navigator.clipboard.writeText(url); return "copied"; }
  catch { return "failed"; }
}
