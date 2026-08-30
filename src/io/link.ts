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

/** A document as a base64url payload, without the `plan=` key. */
export function encodePlan(doc: PlanDoc): string {
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  return btoa(toBinary(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A payload back to a document, or null if it is not one. */
export function decodePlan(payload: string): PlanDoc | null {
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
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
export function planFromHash(hash: string): PlanDoc | null {
  const payload = new URLSearchParams(hash.replace(/^#/, "")).get(PLAN_PARAM);
  return payload ? decodePlan(payload) : null;
}

/** A shareable link to `base` (default: this page) carrying `doc`. */
export function planLink(doc: PlanDoc, base: string): string {
  return `${base.split("#")[0]}#${PLAN_PARAM}=${encodePlan(doc)}`;
}
