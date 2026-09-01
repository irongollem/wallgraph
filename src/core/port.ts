// Where a run reaches a device, and which of the device's services nobody has
// drawn yet.
//
// One answer to "where does this run attach to this thing", read by everything
// that has to agree about it: the derivation that places an anchored waypoint,
// the snap that decides a click anchors, the match that connects a device being
// placed, and the export that states the segment's end. A second copy would let
// a run be drawn to a point it does not resolve to.
//
// Deliberately a leaf: this knows about devices and service keys, not about
// routes as graphs, so core/route.ts can call it without a cycle.
import { Floor, Id, SymbolInstance, furnishingsOf, routesOf } from "../model/doc";
import { Furnishing, furnishingPorts, furnishingWallMounted } from "../model/furnishing";
import { routeServiceKey } from "../model/route";
import { ServiceKey, ServicePort, portFor, unmetPorts } from "../model/service";
import { getSymbol } from "../render/symbols";
import { worldPoint } from "./placed";
import { groupById } from "./board";
import { Vec, v } from "../geometry/vec";

/** Anything a run may terminate at: a placed symbol or a piece of fit-out. */
export type Device = SymbolInstance | Furnishing;

const isFurnishing = (d: Device): d is Furnishing => "form" in d;

/** The device with this id on the floor, symbol or fit-out. */
export function deviceById(floor: Floor, id: Id): Device | undefined {
  return floor.symbols.find(s => s.id === id) ?? furnishingsOf(floor).find(f => f.id === id);
}

/** Footprint the port fractions are measured in. */
function footprint(device: Device): { wallMounted: boolean; width: number; depth: number } | null {
  if (isFurnishing(device)) {
    return { wallMounted: furnishingWallMounted(device.form), width: device.width, depth: device.depth };
  }
  const def = getSymbol(device.type);
  return def ? { wallMounted: def.wallMounted, width: def.width, depth: def.depth } : null;
}

/** What this device takes. Empty when it declares nothing. */
export function devicePorts(device: Device): readonly ServicePort[] {
  if (isFurnishing(device)) return furnishingPorts(device);
  return getSymbol(device.type)?.ports ?? [];
}

/**
 * Where a run carrying `key` reaches this device, world mm.
 *
 * The declared port when there is one, the anchor otherwise — which is the
 * right answer for everything whose own mark puts its connection at the anchor,
 * and is what every device did before ports existed.
 */
export function connectionPoint(device: Device, key: ServiceKey): Vec {
  const port = portFor(devicePorts(device), key);
  const box = port && footprint(device);
  if (!port || !box || (port.u === undefined && port.v === undefined)) {
    return v(device.x, device.y);
  }
  const u = port.u ?? 0.5, p = port.v ?? (box.wallMounted ? 0 : 0.5);
  return worldPoint(device, {
    x: (u - 0.5) * box.width,
    y: box.wallMounted ? p * box.depth : (p - 0.5) * box.depth,
  });
}

/**
 * Where a run carrying `key` attaches to whatever `id` names — a symbol, a
 * piece of fit-out, or one groep of a groepenkast — or null when nothing on
 * the floor answers to it.
 *
 * The one lookup every anchored waypoint goes through. A groep is not a device
 * and has no ports of its own: it IS a connection point, so it resolves
 * directly (core/board.ts).
 */
export function anchorPoint(floor: Floor, id: Id, key: ServiceKey): Vec | null {
  const device = deviceById(floor, id);
  if (device) return connectionPoint(device, key);
  return groupById(floor, id)?.at ?? null;
}

/** Every place a run could reach this device — the ports, or just the anchor. */
export function connectionPoints(device: Device): Vec[] {
  const ports = devicePorts(device);
  if (ports.length === 0) return [v(device.x, device.y)];
  return ports.map(port => connectionPoint(device, port.key));
}

/** The service keys of the runs currently anchored to this device. */
export function connectedKeys(floor: Floor, deviceId: Id): ServiceKey[] {
  const keys: ServiceKey[] = [];
  for (const route of routesOf(floor)) {
    if (route.points.some(p => p.anchor === deviceId)) keys.push(routeServiceKey(route));
  }
  return keys;
}

/**
 * The services this device needs and nobody has connected. Empty for a device
 * that declares none — which is most of the fabric, and is not a claim that it
 * is complete, only that nothing here knows otherwise.
 *
 * A statement about the FIXTURE, not about the drawing's stage: a douche needs
 * warm water whether or not the water layer has been started. Which is why it
 * is reported behind a toggle rather than drawn on every plan.
 */
export function deviceServiceGaps(floor: Floor, device: Device): ServicePort[] {
  return unmetPorts(devicePorts(device), connectedKeys(floor, device.id));
}

/** Every device on the floor with a service nobody has connected. */
export function incompleteDevices(floor: Floor): Map<Id, ServicePort[]> {
  const out = new Map<Id, ServicePort[]>();
  const consider = (device: Device): void => {
    const gaps = deviceServiceGaps(floor, device);
    if (gaps.length > 0) out.set(device.id, gaps);
  };
  for (const s of floor.symbols) consider(s);
  for (const f of furnishingsOf(floor)) consider(f);
  return out;
}

/**
 * Where each missing connection would land, per device -- the ports, not the
 * anchors. A bath waiting for its taps is marked AT the taps, so the mark says
 * where to draw to rather than only that something is wrong somewhere on a
 * fixture that may be two metres long.
 */
export function incompleteMarks(floor: Floor): Map<Id, Vec[]> {
  const out = new Map<Id, Vec[]>();
  for (const [id, gaps] of incompleteDevices(floor)) {
    const device = deviceById(floor, id);
    if (!device) continue;
    // One mark per PLACE, not per service: a mengkraan missing both legs is
    // one thing to fix, drawn once.
    const seen = new Set<string>();
    const at: Vec[] = [];
    for (const gap of gaps) {
      const point = connectionPoint(device, gap.key);
      const key = `${Math.round(point.x)}|${Math.round(point.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      at.push(point);
    }
    out.set(id, at);
  }
  return out;
}
