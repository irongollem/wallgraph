// Service ports: where a run reaches a device, and which of its services
// nobody has drawn (the connectAt work, and "require complete circuits").
//
// The fact under test throughout is that a device's ANCHOR and its CONNECTION
// are two different things for anything bigger than a socket. A run drawn to a
// bath's anchor ends at the wall behind the bath; a run drawn to its waste ends
// at the waste. Everything that has to agree about which of those it is --
// the derivation, the snap, the placement match -- reads one function.
import { emptyDoc, routesOf, type SymbolInstance } from "../src/model/doc";
import type { Furnishing } from "../src/model/furnishing";
import { furnishingPorts } from "../src/model/furnishing";
import {
  serviceKeyOf, serviceMatches, unmetPorts, type ServicePort,
} from "../src/model/service";
import type { Route } from "../src/model/route";
import {
  connectionPoint, connectedKeys, deviceServiceGaps, incompleteDevices,
} from "../src/core/port";
import { resolveRoutePoints } from "../src/core/route";
import { routeEndsUnder, routeTakesSymbol, connectDevice } from "../src/core/attach";
import { getSymbol, SYMBOLS } from "../src/render/symbols";
import { resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const sym = (over: Partial<SymbolInstance> & { type: string }): SymbolInstance =>
  ({ id: "s1", x: 0, y: 0, rotation: 0, ...over });

const bath = (over: Partial<Furnishing> = {}): Furnishing => ({
  id: "bath", form: "bath", x: 0, y: 0, rotation: 0, width: 1700, depth: 700, ...over,
} as Furnishing);

/* ── the key vocabulary ── */

{
  check("a run's key names its discipline and kind",
    serviceKeyOf("water", { water: "afvoer" }) === "water:afvoer"
    && serviceKeyOf("vent", { vent: "afvoer" }) === "vent:afvoer"
    && serviceKeyOf("gas") === "gas");
  // Electrical has kinds too: a coax drop and a lighting circuit are not
  // interchangeable, so the key says which.
  check("an electrical run names what it carries",
    serviceKeyOf("electrical") === "electrical:power"
    && serviceKeyOf("electrical", { power: "coax" }) === "electrical:coax"
    && serviceKeyOf("electrical", { power: "utp" }) === "electrical:utp");
  check("a bare electrical port takes any of them",
    serviceMatches("electrical", "electrical:coax")
    && serviceMatches("electrical", "electrical:power"));
  check("but a coax outlet is not fed by a power circuit",
    !serviceMatches("electrical:coax", "electrical:power"));
  // A ventiel that could be supply or extract declares the bare discipline.
  check("a bare-discipline port takes either kind",
    serviceMatches("vent", "vent:toevoer") && serviceMatches("vent", "vent:afvoer"));
  check("but a specific port takes only its own",
    serviceMatches("water:afvoer", "water:afvoer")
    && !serviceMatches("water:afvoer", "water:koud"));
  check("and disciplines never cross",
    !serviceMatches("water", "electrical") && !serviceMatches("electrical", "gas"));
}

/* ── what the registry declares ── */

{
  check("a wandcontactdoos needs power",
    getSymbol("socket-single")?.ports?.[0]?.key === "electrical:power"
    && getSymbol("socket-single")?.ports?.[0]?.required === true);
  check("a TV outlet needs coax, not power",
    getSymbol("outlet-tv")?.ports?.[0]?.key === "electrical:coax");
  check("and a data outlet needs UTP",
    getSymbol("outlet-data")?.ports?.[0]?.key === "electrical:utp");
  check("a koudwaterpunt needs cold water",
    getSymbol("water-point")?.ports?.[0]?.key === "water:koud");
  check("a mengkraan needs both legs",
    getSymbol("mixer-tap")?.ports?.length === 2);
  check("an afvoerpunt needs drainage",
    getSymbol("waste-point")?.ports?.[0]?.key === "water:afvoer");
  // A groepenkast is where power comes FROM; it must not report itself as
  // waiting for a supply.
  check("a verdeelkast declares no required supply",
    (getSymbol("dist-board")?.ports ?? []).length === 0);
  // Only where the answer is knowable: a rookmelder may be wired or on a
  // battery, and the drawing cannot tell.
  check("a smoke detector declares nothing",
    (getSymbol("smoke-detector")?.ports ?? []).length === 0);
  check("every declared port names a service the model has",
    SYMBOLS.flatMap(d => d.ports ?? []).every(p => typeof p.key === "string" && p.key.length > 0));
}

{
  check("a bad takes hot, cold and a waste", furnishingPorts(bath()).length === 3);
  check("a douche's waste is separate from its taps",
    furnishingPorts({ ...bath(), form: "shower" } as Furnishing)
      .filter(p => p.key === "water:afvoer").length === 1);
  // A kookplaat is fed by one of two services, and a plan demanding both would
  // be wrong about every kitchen.
  const hob = furnishingPorts({ ...bath(), form: "appliance", mark: "cooktop" } as Furnishing);
  check("a kookplaat offers gas or power as alternatives",
    hob.length === 2 && hob.every(p => p.alt === "hob"));
  check("an afzuigkap needs power and an extract",
    furnishingPorts({ ...bath(), form: "appliance", mark: "hood" } as Furnishing)
      .map(p => p.key).sort().join() === "electrical:power,vent:afvoer");
  // A worktop is plumbed for the bowl it holds; without one nothing is missing.
  check("an aanrecht without a bowl needs nothing",
    furnishingPorts({ ...bath(), form: "counter", basins: 0 } as Furnishing).length === 0);
  check("with a bowl it needs supply and waste",
    furnishingPorts({ ...bath(), form: "counter", basins: 1 } as Furnishing).length === 3);
  check("a bed needs nothing",
    furnishingPorts({ ...bath(), form: "bed" } as Furnishing).length === 0);
}

/* ── where a run actually reaches the device ── */

{
  // A socket's mark puts its stub at the anchor, so the two coincide -- which
  // is why the anchor served as both for so long.
  const socket = sym({ type: "socket-single", x: 1000, y: 500 });
  const at = connectionPoint(socket, "electrical:power");
  check("a socket connects at its own anchor", at.x === 1000 && at.y === 500);
  check("a device with no port for the service falls back to the anchor",
    connectionPoint(socket, "water:koud").x === 1000);
}

{
  // 1700 x 700 bath at the origin, wall-standing: the footprint runs
  // x in [-850, 850] and y in [0, 700] from the wall edge.
  const piece = bath();
  const taps = connectionPoint(piece, "water:warm");
  const waste = connectionPoint(piece, "water:afvoer");
  check("the taps sit at the head end, near the wall",
    Math.round(taps.x) === -595 && Math.round(taps.y) === 105,
    `${taps.x},${taps.y}`);
  check("the waste is forward of them, in the tub",
    Math.round(waste.x) === -595 && Math.round(waste.y) === 350,
    `${waste.x},${waste.y}`);
  check("neither is the anchor the bath is placed by",
    taps.x !== piece.x && waste.y !== piece.y);
}

{
  // Fractions of the footprint, not millimetres: a bath is built to a size.
  const small = connectionPoint(bath({ width: 1700 }), "water:afvoer");
  const large = connectionPoint(bath({ width: 1900 }), "water:afvoer");
  check("the waste moves with the length the bath was drawn to",
    small.x !== large.x, `${small.x} vs ${large.x}`);
}

{
  // The port turns with the piece, because it is stated in the piece's frame.
  const turned = bath({ rotation: Math.PI / 2 });
  const waste = connectionPoint(turned, "water:afvoer");
  const flat = connectionPoint(bath(), "water:afvoer");
  check("turning the bath turns its waste with it",
    Math.abs(waste.x - flat.x) > 1 || Math.abs(waste.y - flat.y) > 1,
    `${waste.x},${waste.y} vs ${flat.x},${flat.y}`);
}

/* ── the derivation follows the port for its own service ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.furnishings = [bath()];
  const drain: Route = {
    id: "d", discipline: "water", water: "afvoer",
    points: [{ id: "a", x: -3000, y: 350 }, { id: "b", x: 0, y: 0, anchor: "bath" }],
    segments: [{ id: "s", a: "a", b: "b" }],
  };
  const hot: Route = { ...drain, id: "h", water: "warm" };
  f.routes = [drain, hot];

  const drainEnd = resolveRoutePoints(f, drain)[1]!;
  const hotEnd = resolveRoutePoints(f, hot)[1]!;
  check("the afvoer run ends at the waste",
    Math.round(drainEnd.y) === 350, String(drainEnd.y));
  check("the warm run ends at the taps",
    Math.round(hotEnd.y) === 105, String(hotEnd.y));
  check("so two runs to the same fixture do not land on the same point",
    drainEnd.y !== hotEnd.y);
  check("and neither lands on the fixture's anchor",
    drainEnd.y !== 0 && hotEnd.y !== 0);
}

/* ── connecting matches at the port, not the anchor ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  // A drain drawn to where a bath's waste will be. The anchor is 350 mm away,
  // which under the old anchor-only rule was too far to match on its own.
  f.routes = [{
    id: "d", discipline: "water", water: "afvoer",
    points: [{ id: "a", x: -3000, y: 350 }, { id: "b", x: -595, y: 350 }],
    segments: [{ id: "s", a: "a", b: "b" }],
  }];
  const piece = bath();
  f.furnishings = [piece];
  check("a run ending at the waste connects to the fixture",
    connectDevice(f, piece, d => d === "water") === 1);
  check("and the anchored end is the drain's own end",
    routesOf(f)[0]!.points[1]!.anchor === "bath");
}

/* ── what is still to connect ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const piece = bath();
  f.furnishings = [piece];
  check("an unplumbed bath is missing all three services",
    deviceServiceGaps(f, piece).length === 3, JSON.stringify(deviceServiceGaps(f, piece).map(p => p.key)));

  f.routes = [{
    id: "d", discipline: "water", water: "afvoer",
    points: [{ id: "a", x: -3000, y: 350 }, { id: "b", x: 0, y: 0, anchor: "bath" }],
    segments: [{ id: "s", a: "a", b: "b" }],
  }];
  check("drawing the waste leaves the two supply legs",
    deviceServiceGaps(f, piece).map(p => p.key).sort().join() === "water:koud,water:warm");
  check("and the connected key is read off the run",
    connectedKeys(f, "bath").join() === "water:afvoer");
}

{
  // An alternative group is satisfied by either member, and reported once.
  const hob: ServicePort[] = [
    { key: "electrical", required: true, alt: "hob" },
    { key: "gas", required: true, alt: "hob" },
  ];
  check("an unfed hob is reported once, not twice", unmetPorts(hob, []).length === 1);
  check("power satisfies it", unmetPorts(hob, ["electrical"]).length === 0);
  check("and so does gas", unmetPorts(hob, ["gas"]).length === 0);
  // A non-required port is an option, never a gap.
  check("an optional port is never missing",
    unmetPorts([{ key: "water:warm" }], []).length === 0);
}

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.symbols.push(sym({ id: "sock", type: "socket-single", x: 0, y: 0 }));
  f.symbols.push(sym({ id: "det", type: "smoke-detector", x: 1000, y: 0 }));
  f.furnishings = [bath()];
  const incomplete = incompleteDevices(f);
  check("an unwired socket is incomplete", incomplete.has("sock"));
  check("so is an unplumbed bath", incomplete.has("bath"));
  // Declaring nothing is not a claim of completeness, but it is not a gap.
  check("a device that declares nothing is not reported", !incomplete.has("det"));

  f.routes = [{
    id: "e", discipline: "electrical",
    points: [{ id: "a", x: -2000, y: 0 }, { id: "b", x: 0, y: 0, anchor: "sock" }],
    segments: [{ id: "s", a: "a", b: "b" }],
  }];
  check("wiring the socket takes it off the list", !incompleteDevices(f).has("sock"));
  check("the bath is still on it", incompleteDevices(f).has("bath"));
}

/* ── the snap follows the port too ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const socket = sym({ id: "sock", type: "socket-single", x: 0, y: 0 });
  f.symbols.push(socket);
  f.routes = [{
    id: "e", discipline: "electrical",
    points: [{ id: "a", x: -2000, y: 0 }, { id: "b", x: -100, y: 0 }],
    segments: [{ id: "s", a: "a", b: "b" }],
  }];
  check("a loose end near a socket's own port is found",
    routeEndsUnder(f, socket, d => routeTakesSymbol(d, socket.type)).length === 1);
}

/* ── both languages name what the panel shows ── */

{
  const keys = ["deviceIncomplete", "requireComplete", "requireCompleteOpen", "requireCompleteDone"];
  for (const lang of ["nl", "en"] as const) {
    const panel = resources[lang].translation.panel as Record<string, string>;
    check(`${lang} names every completeness field`,
      keys.every(k => typeof panel[k] === "string" && panel[k]!.length > 0),
      keys.filter(k => !panel[k]).join(","));
  }
}

console.log(failures === 0 ? "ALL PORT TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
