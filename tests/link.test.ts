// The plan-in-a-URL channel. It is the one way into the editor that a person
// can hand over in a chat message and an agent can construct without a browser,
// so a round-trip that loses a field, or an unreadable payload that throws
// instead of returning null, breaks the channel rather than degrading it.
import { encodePlan, decodePlan, planFromHash, planLink } from "../src/io/link";
import { seedDoc } from "../src/seed";
import type { PlanDoc } from "../src/model/doc";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) { fail++; console.error("FAIL " + n + " " + d); } else console.log("ok   " + n); };

const doc = seedDoc();
const payload = encodePlan(doc);

ck("payload is base64url", /^[A-Za-z0-9_-]+$/.test(payload), payload.slice(0, 40));
ck("round-trips exactly", JSON.stringify(decodePlan(payload)) === JSON.stringify(doc));

// Non-ASCII survives: floor names are user text and Dutch plans are full of them.
const accented: PlanDoc = { ...doc, floors: [{ ...doc.floors[0]!, name: "Zolder — 2ᵉ étage ☺" }] };
ck("round-trips non-ASCII", decodePlan(encodePlan(accented))?.floors[0]?.name === "Zolder — 2ᵉ étage ☺");

// A big document: the encoder chunks its way through the byte array, and the
// naive spread it replaced blew the argument limit somewhere around here.
const big: PlanDoc = {
  ...doc,
  floors: [{
    ...doc.floors[0]!,
    nodes: Array.from({ length: 20000 }, (_, i) => ({ id: "n" + i, x: i * 10, y: i })),
  }],
};
ck("handles a large document", decodePlan(encodePlan(big))?.floors[0]?.nodes.length === 20000);

ck("rejects garbage", decodePlan("!!!not base64!!!") === null);
ck("rejects valid base64 that is not JSON", decodePlan(encodePlanRaw("hello")) === null);
ck("rejects JSON that is not a plan", decodePlan(encodePlanRaw('{"version":2}')) === null);
ck("rejects a plan with no floors", decodePlan(encodePlanRaw('{"version":1,"floors":[]}')) === null);

function encodePlanRaw(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

// The fragment is read as a query string, so order does not matter and a
// language can travel alongside the plan.
ck("reads plan from a hash", planFromHash(`#plan=${payload}`) !== null);
ck("reads plan beside other keys", planFromHash(`#lang=en&plan=${payload}`) !== null);
ck("no plan key is not an error", planFromHash("#lang=en") === null);
ck("empty hash is not an error", planFromHash("") === null);
ck("truncated payload returns null", planFromHash(`#plan=${payload.slice(0, 40)}`) === null);

const link = planLink(doc, "https://plattegrond.crocode.nl/#plan=stale");
ck("planLink replaces an existing fragment", link.split("#").length === 2, link.slice(0, 60));
ck("planLink round-trips", JSON.stringify(planFromHash("#" + link.split("#")[1]!)) === JSON.stringify(doc));

console.log(`payload for the demo plan: ${(payload.length / 1024).toFixed(1)} kB of URL`);
console.log(fail === 0 ? "ALL LINK TESTS PASSED" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
