// Where a device connects to a service, and which services it cannot do
// without.
//
// A placed device has an anchor — where it is — and that is not the same thing
// as where a run reaches it. A wandcontactdoos is the case where the two
// coincide, which is why the anchor served as both for so long: the standard's
// own mark puts the supply stub at the anchor. A bad has taps at one end and a
// waste in the middle of it, and a run drawn to its anchor ends at the wall
// behind the bath rather than at anything.
//
// So a device declares PORTS: one per service it takes, positioned in its own
// footprint. That a fixture has several is not a complication to be flattened —
// a douche genuinely needs koud, warm and afvoer, and saying so is what lets a
// plan report the one nobody drew.
import type { Discipline, RouteKind, RouteVent, RouteWater } from "./route";

/**
 * What a port takes, or what a run carries.
 *
 * A bare discipline is the wildcard: a port keyed "vent" is satisfied by
 * toevoer or afvoer, which is what a ventiel that could be either actually is.
 * A port keyed "water:afvoer" takes drainage and nothing else.
 */
export type ServiceKey =
  | "electrical" | "gas" | "water" | "vent"
  | "electrical:power" | "electrical:utp" | "electrical:coax"
  | "water:koud" | "water:warm" | "water:afvoer"
  | "vent:toevoer" | "vent:afvoer";

export const SERVICE_KEYS: readonly ServiceKey[] = [
  "electrical", "electrical:power", "electrical:utp", "electrical:coax",
  "gas", "water", "water:koud", "water:warm", "water:afvoer",
  "vent", "vent:toevoer", "vent:afvoer",
];

/** What a run carries, beyond its discipline. */
export interface ServiceKinds {
  water?: RouteWater;
  vent?: RouteVent;
  /** Electrical only: power, utp or coax. */
  power?: RouteKind;
}

/**
 * The key a run carries. Always specific -- every discipline that HAS kinds
 * names one, electrical included: a coax drop and a lighting circuit are not
 * interchangeable, and a TV outlet fed from a power circuit is not connected.
 * The bare-discipline keys exist for PORTS, which may be indifferent; a run
 * never is.
 */
export function serviceKeyOf(discipline: Discipline, kinds: ServiceKinds = {}): ServiceKey {
  if (discipline === "water") return `water:${kinds.water ?? "koud"}` as ServiceKey;
  if (discipline === "vent") return `vent:${kinds.vent ?? "toevoer"}` as ServiceKey;
  if (discipline === "electrical") return `electrical:${kinds.power ?? "power"}` as ServiceKey;
  return discipline;
}

/** The discipline half of a key. */
export const serviceDiscipline = (key: ServiceKey): Discipline =>
  key.split(":")[0] as Discipline;

/**
 * Whether a run carrying `run` may terminate at a port declared `port`. Exact
 * match, or the port's bare-discipline wildcard.
 */
export function serviceMatches(port: ServiceKey, run: ServiceKey): boolean {
  return port === run || port === serviceDiscipline(run);
}

/**
 * One place a run reaches a device.
 *
 * `u`/`v` are FRACTIONS of the device's own footprint, not millimetres: a bath
 * is built to a size, so its waste sits a third of the way along whatever
 * length was drawn rather than at a fixed offset. `u` runs across the width
 * (0 left, 1 right) and `v` through the depth — 0 at the wall-touching edge for
 * a wall-standing piece, 0 at the back for a free-standing one, 1 at the front
 * in both. Absent means the anchor itself, which is right for every device
 * whose mark already puts its connection there.
 */
export interface ServicePort {
  key: ServiceKey;
  u?: number;
  v?: number;
  /**
   * The device does not work without it. What "require complete circuits"
   * reports, so it is a statement about the FIXTURE, never about the drawing:
   * a douche needs warm water whether or not anyone has drawn it yet.
   */
  required?: boolean;
  /**
   * Ports sharing a tag are alternatives — connecting any one of them
   * satisfies all of them. A kookplaat is fed by gas OR by power, and a plan
   * that demanded both would be wrong about every kitchen.
   */
  alt?: string;
}

/** The port a run of `key` attaches to, or undefined when the device has none. */
export function portFor(ports: readonly ServicePort[], key: ServiceKey): ServicePort | undefined {
  return ports.find(p => serviceMatches(p.key, key));
}

/**
 * Which of a device's required services are not connected, given the keys that
 * ARE. An alternative group counts as satisfied as soon as one of its members
 * is, and is reported once — under its first member — rather than once per way
 * it could have been fed.
 */
export function unmetPorts(
  ports: readonly ServicePort[], connected: readonly ServiceKey[],
): ServicePort[] {
  const met = (port: ServicePort): boolean => connected.some(key => serviceMatches(port.key, key));
  const satisfiedAlts = new Set(ports.filter(p => p.alt && met(p)).map(p => p.alt));
  const seenAlts = new Set<string>();
  const out: ServicePort[] = [];
  for (const port of ports) {
    if (!port.required || met(port)) continue;
    if (port.alt) {
      if (satisfiedAlts.has(port.alt) || seenAlts.has(port.alt)) continue;
      seenAlts.add(port.alt);
    }
    out.push(port);
  }
  return out;
}
