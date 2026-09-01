// Mounting heights: how high a placed device sits above its storey's finished
// floor, what that costs a run that reaches it, and how the plan writes it.
//
// The three facts under test are the ones that decide whether a takeoff can be
// trusted: an unset height reads the type's convention rather than zero, a
// ceiling device follows the storey rather than a constant, and a device with
// no convention at all is reported as excluded instead of guessed at.
import { emptyDoc, floorHeight, mountMarksOn, type SymbolInstance } from "../src/model/doc";
import {
  symbolMountHeight, defaultMountHeight, clampMountHeight, mountMarkOf,
} from "../src/core/mount";
import { routePlaneHeight, defaultRouteHeight, routeDrops, routeTakeoffLength, routeLength } from "../src/core/route";
import { getSymbol, SYMBOLS } from "../src/render/symbols";
import type { Route } from "../src/model/route";
import { toSvg } from "../src/io/svg";
import { toDxf } from "../src/io/dxf";
import { planSchema, validate } from "../scripts/site/schema";
import { resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const sym = (over: Partial<SymbolInstance> & { type: string }): SymbolInstance =>
  ({ id: "s1", x: 0, y: 0, rotation: 0, ...over });

/* ── the registry's own conventions ── */

{
  check("a wandcontactdoos states the ordinary 300",
    getSymbol("socket-single")?.mountHeight === 300);
  check("every socket in the family carries the same height",
    ["socket-single", "socket-earthed", "socket-double", "socket-double-earthed",
     "socket-triple", "socket-triple-earthed"].every(t => getSymbol(t)?.mountHeight === 300));
  check("a schakelaar states 1050", getSymbol("switch-single")?.mountHeight === 1050);
  check("a light point is fixed to the ceiling rather than to a figure",
    getSymbol("light-point")?.mountHeight === "ceiling");
  check("a floor socket sits at the floor", getSymbol("socket-floor")?.mountHeight === 0);
  // A convention is stated only where one genuinely exists: a tappunt follows
  // the fixture it serves, so the type says nothing rather than inventing one.
  check("a water point states no convention", getSymbol("water-point")?.mountHeight === undefined);
  const stated = SYMBOLS.filter(d => d.mountHeight !== undefined);
  check("only some types carry a convention",
    stated.length > 0 && stated.length < SYMBOLS.length, `${stated.length}/${SYMBOLS.length}`);
  check("every stated numeric convention is a whole, non-negative mm figure",
    stated.every(d => d.mountHeight === "ceiling"
      || (Number.isInteger(d.mountHeight) && (d.mountHeight as number) >= 0)));
}

/* ── symbolMountHeight: instance, then type, then nothing ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;

  check("an unset height reads the type's convention",
    symbolMountHeight(f, sym({ type: "socket-single" })) === 300);
  check("a stated height wins over the convention",
    symbolMountHeight(f, sym({ type: "socket-single", height: 1150 })) === 1150);
  // Zero is a height, not an absence: a socket deliberately set at floor level
  // must not fall back to 300.
  check("a stated zero is a height, not an absent one",
    symbolMountHeight(f, sym({ type: "socket-single", height: 0 })) === 0);
  check("a type with no convention has no height",
    symbolMountHeight(f, sym({ type: "water-point" })) === undefined);
  check("an unknown type has no height",
    symbolMountHeight(f, sym({ type: "not-a-symbol" })) === undefined);

  check("a ceiling device follows the storey height",
    symbolMountHeight(f, sym({ type: "light-point" })) === floorHeight(f));
  f.height = 3600;
  check("lowering or raising the storey moves the ceiling device with it",
    symbolMountHeight(f, sym({ type: "light-point" })) === 3600
    && defaultMountHeight(f, "light-point") === 3600);
  check("a wall device is unmoved by the storey height",
    symbolMountHeight(f, sym({ type: "switch-single" })) === 1050);

  check("a height is clamped into the storey it stands in",
    clampMountHeight(f, -50) === 0 && clampMountHeight(f, 99999) === 3600
    && clampMountHeight(f, 1050.4) === 1050);
}

/* ── routePlaneHeight: the installation supplies the default ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const at = (over: Partial<Route>): Route =>
    ({ id: "rt", discipline: "electrical", points: [], segments: [], ...over });

  check("a concealed run sits at the floor by default",
    routePlaneHeight(f, at({})) === 0);
  // The point of the fix: "in / boven plafond" at zero would put a duct on the
  // floor of the room it crosses above.
  check("a ceiling run sits at the storey height by default",
    routePlaneHeight(f, at({ installation: "ceiling" })) === floorHeight(f));
  check("a floor run sits at the floor by default",
    routePlaneHeight(f, at({ installation: "floor" })) === 0);
  check("an authored height wins on a ceiling run",
    routePlaneHeight(f, at({ installation: "ceiling", height: 2600 })) === 2600);
  check("an authored height wins on a floor run",
    routePlaneHeight(f, at({ installation: "floor", height: 60 })) === 60);
  check("defaultRouteHeight agrees with what the plane resolves to",
    defaultRouteHeight(f, "ceiling") === floorHeight(f) && defaultRouteHeight(f, "surface") === 0);
}

/* ── routeDrops: the vertical cable a plan does not draw ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.symbols.push(sym({ id: "sock", type: "socket-single", x: 1000, y: 0 }));
  f.symbols.push(sym({ id: "sw", type: "switch-single", x: 2000, y: 0 }));
  f.symbols.push(sym({ id: "tap", type: "water-point", x: 3000, y: 0 }));
  const rt: Route = {
    id: "rt", discipline: "electrical",
    points: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 1000, y: 0, anchor: "sock" },
      { id: "c", x: 2000, y: 0, anchor: "sw" },
      { id: "d", x: 3000, y: 0, anchor: "tap" },
    ],
    segments: [
      { id: "s0", a: "a", b: "b" }, { id: "s1", a: "b", b: "c" }, { id: "s2", a: "c", b: "d" },
    ],
  };
  f.routes = [rt];

  const drops = routeDrops(f, rt);
  check("a socket at 300 and a switch at 1050 cost their own drops",
    drops.lengthMm === 300 + 1050, String(drops.lengthMm));
  check("both devices with a height are counted", drops.counted === 2, String(drops.counted));
  // The honesty requirement: a tappunt has no conventional height, so the run
  // reports it as excluded rather than treating it as sitting in the plane.
  check("a device with no height at all is reported, not assumed",
    drops.unstated === 1, String(drops.unstated));
  check("an unanchored point contributes no drop", routeDrops(f, {
    ...rt, points: rt.points.map(p => ({ ...p, anchor: undefined })),
  }).lengthMm === 0);

  check("the drawn length still measures only what is on the plan",
    routeLength(f, rt) === 3000, String(routeLength(f, rt)));
  check("the takeoff length is the drawn run plus its drops",
    routeTakeoffLength(f, rt) === 3000 + 1350, String(routeTakeoffLength(f, rt)));

  // A run in the ceiling plane drops DOWN to the same devices, and the figures
  // follow the storey rather than staying keyed to zero.
  const overhead: Route = { ...rt, installation: "ceiling" };
  f.routes = [overhead];
  const ceilingDrops = routeDrops(f, overhead);
  check("a ceiling run drops down to the devices it feeds",
    ceilingDrops.lengthMm === (floorHeight(f) - 300) + (floorHeight(f) - 1050),
    String(ceilingDrops.lengthMm));
}

/* ── the plan mark ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const socket = sym({ id: "sock", type: "socket-single", x: 1000, y: 2000 });
  f.symbols.push(socket);

  const mark = mountMarkOf(f, socket);
  // Millimetres, like every other figure this editor writes on a plan -- not
  // the centimetres a paper installatietekening conventionally uses.
  check("the mark states the height in mm, above-floor", mark?.text === "+300", mark?.text ?? "none");
  check("the mark is written beside the symbol, not on its anchor",
    mark !== null && (mark.at.x !== socket.x || mark.at.y !== socket.y));
  check("a device with no height gets no mark",
    mountMarkOf(f, sym({ id: "t", type: "water-point" })) === null);
  check("a stated height is what the mark says",
    mountMarkOf(f, sym({ id: "s2", type: "socket-single", height: 1150 }))?.text === "+1150");

  // The annotation is a drawing convention on the document, so every export
  // agrees with the screen rather than each deciding for itself.
  check("a plan states no heights until it says so", !mountMarksOn(doc));
  check("the SVG carries no height mark while the convention is off",
    !(toSvg(doc) ?? "").includes("+300"));
  check("the DXF carries no height mark while the convention is off",
    !(toDxf(doc) ?? "").includes("+300"));
  doc.mountMarks = true;
  check("turning it on writes the mark into the SVG", (toSvg(doc) ?? "").includes("+300"));
  check("turning it on writes the mark into the DXF", (toDxf(doc) ?? "").includes("+300"));
}

/* ── what the document may store ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.symbols.push(sym({ id: "s1", type: "socket-single", height: 1150 }));
  doc.mountMarks = true;
  const schema = planSchema("");
  check("a stated mounting height validates", validate(schema, doc).length === 0,
    JSON.stringify(validate(schema, doc)));
  check("the height survives a JSON round-trip",
    JSON.parse(JSON.stringify(doc)).floors[0].symbols[0].height === 1150);

  const negative = JSON.parse(JSON.stringify(doc));
  negative.floors[0].symbols[0].height = -1;
  check("a height below the floor is rejected", validate(schema, negative).length > 0);
  const fractional = JSON.parse(JSON.stringify(doc));
  fractional.floors[0].symbols[0].height = 1150.5;
  check("a fractional height is rejected", validate(schema, fractional).length > 0);
}

/* ── both languages name what the panel shows ── */

{
  const keys = ["symbolOwnHeight", "symbolHeight", "symbolHeightNone", "symbolHeightStandard",
    "showHeights", "routeDropLength", "routeTotalLength", "routeDropUnstated"];
  for (const lang of ["nl", "en"] as const) {
    const panel = resources[lang].translation.panel as Record<string, string>;
    check(`${lang} names every mounting-height field`,
      keys.every(k => typeof panel[k] === "string" && panel[k]!.length > 0),
      keys.filter(k => !panel[k]).join(","));
  }
}

console.log(failures === 0 ? "ALL MOUNT TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
