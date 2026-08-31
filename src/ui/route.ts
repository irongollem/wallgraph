// The route pane: the discipline the next run is drawn in, and the
// properties of a placed one. The manual-routing core (issue #25) kept this
// deliberately minimal; the electrical (issue #26), water (issue #27) and
// ventilation (issue #28) vocabularies sit over that same core -- one Route
// type, richer optional fields read only when discipline matches, not a
// parallel system per discipline.
import { Store } from "../model/store";
import { Tools } from "../input/tools";
import { Floor, Id, routesOf } from "../model/doc";
import {
  continuationAt, continuationsOf, continueRoutePorts, type ContinueRouteInput, type RoutePort,
} from "../model/continuation";
import {
  Route, Discipline, DISCIPLINES, RouteKind, ROUTE_KINDS, ROUTE_VEINS_DEFAULT,
  routeKind, routeVeins, clampRouteVeins,
  RouteWater, ROUTE_WATERS, routeWater, routeDiameter, routeDiameterLadder,
  clampRouteDiameter, defaultRouteDiameter,
  RouteVent, ROUTE_VENTS, routeVent, VENT_DIAMETERS, VENT_DIAMETER_DEFAULT,
  routeDuctDiameter, clampDuctDiameter, routeFlow, clampRouteFlow,
  RouteInstallation, ROUTE_INSTALLATIONS, routeInstallation,
} from "../model/route";
import {
  resolveRoutePoints, routeLength, routeGroupSummaries, routeKindSummaries, routeWaterSummaries, routeGasSummaries,
} from "../core/route";
import { serviceNetworkLength } from "../core/continuation";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";

export type RouteRows = PaneRows;

// Computed per call, not hoisted: t() follows the language the visitor has
// live, and a module-scope constant would freeze it at the first import.
function disciplineOptions(): Array<[string, string]> {
  return DISCIPLINES.map(d => [d, t("panel.discipline" + d[0]!.toUpperCase() + d.slice(1))]);
}

function kindOptions(): Array<[string, string]> {
  return ROUTE_KINDS.map(k => [k, t("panel.routeKind" + k[0]!.toUpperCase() + k.slice(1))]);
}

function waterOptions(): Array<[string, string]> {
  return ROUTE_WATERS.map(w => [w, t("panel.routeWater" + w[0]!.toUpperCase() + w.slice(1))]);
}

function ventOptions(): Array<[string, string]> {
  return ROUTE_VENTS.map(v => [v, t("panel.routeVent" + v[0]!.toUpperCase() + v.slice(1))]);
}

function installationOptions(): Array<[string, string]> {
  return ROUTE_INSTALLATIONS.map(value => [value,
    t("panel.routeInstallation" + value[0]!.toUpperCase() + value.slice(1))]);
}

interface IdentityFields {
  tag: string;
  name: string;
  board: string;
  installation: RouteInstallation;
  height: number;
}

function identityRows(
  rows: RouteRows, discipline: Discipline, fields: IdentityFields,
  commit: (patch: Partial<IdentityFields>) => void,
): void {
  rows.textRow(t("panel.routeTag"), fields.tag, tag => commit({ tag: tag.trim() }));
  rows.textRow(t("panel.routeName"), fields.name, name => commit({ name: name.trim() }));
  if (discipline === "electrical")
    rows.textRow(t("panel.routeBoard"), fields.board, board => commit({ board: board.trim() }));
  rows.selRow(t("panel.routeInstallation"), fields.installation, installationOptions(),
    value => commit({ installation: value as RouteInstallation }));
  rows.numRow(t("panel.routeHeight"), fields.height, height => commit({ height: Math.max(0, Math.round(height)) }), 50);
}

/** The chip row's ordinary options; a typed value reaches further (see
 *  Tools.setRouteVeins / the schema's own maximum). */
const VEINS_CHIPS: readonly number[] = [2, 3, 4, 5];

/**
 * Distinct groep values already used on the floor's electrical runs, most
 * recently placed first, capped at six -- wiring one circuit is repeated
 * clicks on the same groep, not repeated typing of it.
 */
function recentGroups(floor: Floor): string[] {
  const routes = routesOf(floor);
  const seen: string[] = [];
  for (let i = routes.length - 1; i >= 0 && seen.length < 6; i--) {
    const g = routes[i]!.group;
    if (g && !seen.includes(g)) seen.push(g);
  }
  return seen;
}

interface ElectricalFields {
  kind: RouteKind;
  veins: number;
  group: string;
  spec: string;
}

/**
 * The electrical-only rows, shared by the tool pane (arming the next run) and
 * the property pane (editing a placed one): kind, then either veins + groep
 * for a power run or a cable spec for a data run. `commit` receives only the
 * field that changed.
 */
function electricalRows(
  rows: RouteRows, floor: Floor, fields: ElectricalFields,
  commit: (patch: Partial<ElectricalFields>) => void,
): void {
  rows.selRow(t("panel.routeKind"), fields.kind, kindOptions(), v => commit({ kind: v as RouteKind }));
  if (fields.kind === "power") {
    rows.numRow(t("panel.routeVeins"), fields.veins, n => commit({ veins: n }), 1);
    rows.chipRow(t("panel.routeVeins"), VEINS_CHIPS, fields.veins, n => commit({ veins: n }));
    rows.textRow(t("panel.routeGroup"), fields.group, s => commit({ group: s.trim() }));
    const recent = recentGroups(floor);
    if (recent.length > 0) {
      rows.chipRow(t("panel.routeGroup"), recent, fields.group, g => commit({ group: g }));
    }
  } else {
    rows.textRow(t("panel.routeSpec"), fields.spec, s => commit({ spec: s.trim() }));
  }
}

interface WaterFields {
  water: RouteWater;
  diameter: number;
}

/**
 * The water-only rows, shared by the tool pane and the property pane: the
 * koud/warm/afvoer kind, then a diameter typed field beside a chip row over
 * that kind's own ladder -- the supply sizes for koud/warm, the drain sizes
 * for afvoer. Nothing here writes the diameter back when the kind changes:
 * an unset diameter reads its default through routeDiameter() (model/route.ts),
 * which is keyed on the CURRENT kind, so the displayed value already follows
 * the new kind's default on its own; an explicitly typed diameter is left
 * exactly as the user set it.
 */
function waterRows(
  rows: RouteRows, fields: WaterFields,
  commit: (patch: Partial<WaterFields>) => void,
): void {
  rows.selRow(t("panel.routeKind"), fields.water, waterOptions(), v => commit({ water: v as RouteWater }));
  rows.numRow(t("panel.routeDiameter"), fields.diameter, n => commit({ diameter: n }), 1);
  rows.chipRow(t("panel.routeDiameter"), routeDiameterLadder(fields.water), fields.diameter, n => commit({ diameter: n }));
}

function gasRows(rows: RouteRows, diameter: number, commit: (diameter: number) => void): void {
  rows.numRow(t("panel.routeDiameter"), diameter, commit, 1);
  rows.chipRow(t("panel.routeDiameter"), routeDiameterLadder("koud"), diameter, commit);
}

interface VentFields {
  vent: RouteVent;
  ductDiameter: number;
  /** Undefined means not stated -- see routeFlow() in model/route.ts. */
  flow: number | undefined;
}

/**
 * The vent-only rows, shared by the tool pane and the property pane:
 * toevoer/afvoer, then the duct diameter (typed field beside a chip row over
 * VENT_DIAMETERS, the same shape as the water diameter row) and the run's
 * design flow.
 *
 * Flow gets a plain numRow rather than a checkRow+numRow pair: 0 is not a
 * flow any run is actually designed to, so typing it reads the same way it
 * would on a paper schedule -- "nothing stated here" -- and doubles as the
 * field's own clear gesture. A checkRow would make an unstated flow look
 * like a yes/no toggle over a number that is always "really" there, which
 * flow is not: it is a fact someone measured or designed to, not a value
 * with an ordinary default the way ductDiameter or routeDiameter have one.
 */
function ventRows(
  rows: RouteRows, fields: VentFields,
  commit: (patch: Partial<VentFields>) => void,
): void {
  rows.selRow(t("panel.routeKind"), fields.vent, ventOptions(), v => commit({ vent: v as RouteVent }));
  rows.numRow(t("panel.routeDiameter"), fields.ductDiameter, n => commit({ ductDiameter: n }), 5);
  rows.chipRow(t("panel.routeDiameter"), VENT_DIAMETERS, fields.ductDiameter, n => commit({ ductDiameter: n }));
  rows.numRow(t("panel.routeFlow"), fields.flow ?? 0, n => commit({ flow: n <= 0 ? undefined : n }), 15);
}

/**
 * The floor's electrical runs, reported as a materials list: total length and
 * anchored-device count per groep, total cable length per kind (and, for
 * power, per aders count). Purely a read-out of what is drawn -- never
 * validated against what the meterkast actually carries. Renders nothing
 * when the floor has no electrical routes.
 */
function materialsRows(rows: RouteRows, floor: Floor): void {
  const groups = routeGroupSummaries(floor);
  const kinds = routeKindSummaries(floor);
  const waters = routeWaterSummaries(floor);
  const gases = routeGasSummaries(floor);
  if (groups.length === 0 && kinds.length === 0 && waters.length === 0 && gases.length === 0) return;
  rows.noteRow(t("panel.routeMaterialsNote"));
  for (const g of groups) {
    rows.infoRow(t("panel.routeMaterialsGroup", { group: g.group }),
      t("panel.routeMaterialsGroupValue", { length: Math.round(g.lengthMm), n: g.devices }));
  }
  for (const k of kinds) {
    const kindLabel = t("panel.routeKind" + k.kind[0]!.toUpperCase() + k.kind.slice(1));
    const label = k.veins !== undefined
      ? t("panel.routeMaterialsKindVeins", { kind: kindLabel, veins: k.veins })
      : kindLabel;
    rows.infoRow(label, `${Math.round(k.lengthMm)} mm`);
  }
  for (const w of waters) {
    const waterLabel = t("panel.routeWater" + w.water[0]!.toUpperCase() + w.water.slice(1));
    rows.infoRow(t("panel.routeMaterialsWater", { water: waterLabel, diameter: w.diameter }),
      `${Math.round(w.lengthMm)} mm`);
  }
  for (const gas of gases)
    rows.infoRow(t("panel.routeMaterialsGas", { diameter: gas.diameter }), `${Math.round(gas.lengthMm)} mm`);
}

function endpointDegree(route: Route, pointId: Id): number {
  return route.segments.reduce((n, segment) =>
    n + (segment.a === pointId ? 1 : 0) + (segment.b === pointId ? 1 : 0), 0);
}

function portOf(store: Store, route: Route, pointId: Id): RoutePort {
  return { floorId: store.floor.id, routeId: route.id, pointId };
}

function continueInputs(store: Store, entries: Array<{ route: Route; pointId: Id }>, delta: -1 | 1): void {
  const target = store.activeFloor + delta;
  if (!store.doc.floors[target]) return;
  const inputs: ContinueRouteInput[] = entries.flatMap(({ route, pointId }) => {
    const index = route.points.findIndex(p => p.id === pointId);
    const at = resolveRoutePoints(store.floor, route)[index];
    return at ? [{ routeId: route.id, pointId, x: at.x, y: at.y }] : [];
  });
  let routeIds: Id[] = [];
  store.mutate(doc => { routeIds = continueRoutePorts(doc, store.activeFloor, target, inputs).routeIds; });
  if (routeIds.length === 0) return;
  store.setActiveFloor(target);
  store.selectMany("route", routeIds);
}

function jumpToPort(store: Store, port: RoutePort): void {
  const floorIndex = store.doc.floors.findIndex(f => f.id === port.floorId);
  if (floorIndex < 0) return;
  store.setActiveFloor(floorIndex);
  store.select({ kind: "route", id: port.routeId });
}

function endpointRows(rows: RouteRows, store: Store, route: Route): void {
  const degree = new Map<string, number>();
  for (const segment of route.segments) {
    degree.set(segment.a, (degree.get(segment.a) ?? 0) + 1);
    degree.set(segment.b, (degree.get(segment.b) ?? 0) + 1);
  }
  const loose = route.points.filter(point => (degree.get(point.id) ?? 0) <= 1 && !point.anchor);
  for (let index = 0; index < loose.length; index++) {
    const point = loose[index]!;
    const port = portOf(store, route, point.id);
    const continuation = continuationAt(store.doc, port);
    if (continuation) {
      const destinations = continuation.ports.filter(p => p.floorId !== store.floor.id)
        .map(p => store.doc.floors.find(f => f.id === p.floorId)?.name).filter((name): name is string => !!name);
      rows.infoRow(t("panel.routeEndpoint", { n: index + 1 }),
        t("panel.routeContinuationValue", { floors: destinations.join(", ") }));
      rows.textRow(t("panel.routeRiserTag"), continuation.tag ?? "", value => store.mutate(doc => {
        const link = continuationsOf(doc).find(item => item.id === continuation.id);
        if (!link) return;
        const tag = value.trim();
        if (tag) link.tag = tag; else delete link.tag;
      }));
      for (const other of continuation.ports.filter(p => p.floorId !== store.floor.id)) {
        const destination = store.doc.floors.find(f => f.id === other.floorId)?.name;
        if (destination) rows.btnRow(t("panel.routeJumpTo", { floor: destination }), () => jumpToPort(store, other));
      }
      continue;
    }
    rows.selRow(t("panel.routeEndpoint", { n: index + 1 }), point.terminal ?? "open", [
      ["open", t("panel.routeEndpointOpen")],
      ["source", t("panel.routeEndpointSource")],
      ["capped", t("panel.routeEndpointCapped")],
    ], value => store.mutate(doc => {
      const current = routesOf(store.floorOf(doc)).find(r => r.id === route.id)?.points.find(p => p.id === point.id);
      if (!current) return;
      if (value === "open") delete current.terminal;
      else current.terminal = value as "source" | "capped";
    }));
    if (store.activeFloor + 1 < store.doc.floors.length)
      rows.btnRow(t("panel.routeContinueAbove"), () => continueInputs(store, [{ route, pointId: point.id }], 1));
    if (store.activeFloor > 0)
      rows.btnRow(t("panel.routeContinueBelow"), () => continueInputs(store, [{ route, pointId: point.id }], -1));
  }
}

function bulkContinuationRows(rows: RouteRows, store: Store, routes: Route[]): void {
  const entries = routes.flatMap(route => {
    const eligible = route.points.filter(point => endpointDegree(route, point.id) <= 1 && !point.anchor
      && !continuationAt(store.doc, portOf(store, route, point.id)));
    return eligible.length === 1 ? [{ route, pointId: eligible[0]!.id }] : [];
  });
  if (entries.length !== routes.length) return;
  if (store.activeFloor + 1 < store.doc.floors.length)
    rows.btnRow(t("panel.routeContinueManyAbove", { n: routes.length }), () => continueInputs(store, entries, 1));
  if (store.activeFloor > 0)
    rows.btnRow(t("panel.routeContinueManyBelow", { n: routes.length }), () => continueInputs(store, entries, -1));
}

/** The discipline the next run will be drawn in, plus its armed properties. */
export function renderRouteTool(store: Store, tools: Tools, rows: RouteRows): void {
  rows.secHead(t("panel.newRoute"));
  rows.selRow(t("panel.routeDiscipline"), tools.routeDiscipline, disciplineOptions(),
    d => tools.setRouteDiscipline(d as Discipline));
  identityRows(rows, tools.routeDiscipline, {
    tag: tools.routeTag, name: tools.routeName, board: tools.routeBoard,
    installation: tools.routeInstallation, height: tools.routeHeight,
  }, patch => {
    if (patch.tag !== undefined) tools.setRouteTag(patch.tag);
    if (patch.name !== undefined) tools.setRouteName(patch.name);
    if (patch.board !== undefined) tools.setRouteBoard(patch.board);
    if (patch.installation !== undefined) tools.setRouteInstallation(patch.installation);
    if (patch.height !== undefined) tools.setRouteHeight(patch.height);
  });
  if (tools.routeDiscipline === "electrical") {
    electricalRows(rows, store.floor, {
      kind: tools.routeKind, veins: tools.routeVeins, group: tools.routeGroup, spec: tools.routeSpec,
    }, patch => {
      if (patch.kind !== undefined) tools.setRouteKind(patch.kind);
      if (patch.veins !== undefined) tools.setRouteVeins(patch.veins);
      if (patch.group !== undefined) tools.setRouteGroup(patch.group);
      if (patch.spec !== undefined) tools.setRouteSpec(patch.spec);
    });
  } else if (tools.routeDiscipline === "water") {
    waterRows(rows, { water: tools.routeWater, diameter: tools.routeDiameter }, patch => {
      if (patch.water !== undefined) tools.setRouteWater(patch.water);
      if (patch.diameter !== undefined) tools.setRouteDiameter(patch.diameter);
    });
  } else if (tools.routeDiscipline === "vent") {
    ventRows(rows, { vent: tools.routeVent, ductDiameter: tools.routeDuctDiameter, flow: tools.routeFlow }, patch => {
      if (patch.vent !== undefined) tools.setRouteVent(patch.vent);
      if (patch.ductDiameter !== undefined) tools.setRouteDuctDiameter(patch.ductDiameter);
      if ("flow" in patch) tools.setRouteFlow(patch.flow);
    });
  } else if (tools.routeDiscipline === "gas") {
    gasRows(rows, tools.routeGasDiameter, diameter => tools.setRouteGasDiameter(diameter));
  }
  rows.noteRow(t("panel.routeNote"));
  materialsRows(rows, store.floor);
}

/** Properties of the selected route. */
export function renderRouteProps(store: Store, tools: Tools, rows: RouteRows, id: string): void {
  const route = routesOf(store.floor).find(x => x.id === id);
  if (!route) return;

  const mut = (fn: (r: Route) => void): void => {
    store.mutate(d => {
      const r2 = routesOf(store.floorOf(d)).find(x => x.id === id);
      if (r2) fn(r2);
    });
  };

  rows.secHead(t("panel.route"), { sel: true });
  rows.selRow(t("panel.routeDiscipline"), route.discipline, disciplineOptions(),
    d => mut(r => {
      r.discipline = d as Discipline;
      // The electrical/water/vent vocabularies mean nothing outside their own
      // discipline -- dropped on the way out, the way a furnishing preset swap
      // rewrites every field the old preset wrote.
      if (r.discipline !== "electrical") { delete r.kind; delete r.veins; delete r.group; delete r.spec; }
      if (r.discipline !== "water") delete r.water;
      if (r.discipline !== "water" && r.discipline !== "gas") delete r.diameter;
      if (r.discipline !== "vent") { delete r.vent; delete r.ductDiameter; delete r.flow; }
    }));
  identityRows(rows, route.discipline, {
    tag: route.tag ?? "", name: route.name ?? "", board: route.board ?? "",
    installation: routeInstallation(route), height: route.height ?? 0,
  }, patch => mut(r => {
    if (patch.tag !== undefined) { if (patch.tag) r.tag = patch.tag; else delete r.tag; }
    if (patch.name !== undefined) { if (patch.name) r.name = patch.name; else delete r.name; }
    if (patch.board !== undefined) { if (patch.board) r.board = patch.board; else delete r.board; }
    if (patch.installation !== undefined) {
      if (patch.installation === "concealed") delete r.installation; else r.installation = patch.installation;
    }
    if (patch.height !== undefined) { if (patch.height > 0) r.height = patch.height; else delete r.height; }
  }));
  if (route.discipline === "electrical") {
    electricalRows(rows, store.floor, {
      kind: routeKind(route), veins: routeVeins(route), group: route.group ?? "", spec: route.spec ?? "",
    }, patch => mut(r => {
      if (patch.kind !== undefined) {
        if (patch.kind === "power") delete r.kind; else r.kind = patch.kind;
      }
      if (patch.veins !== undefined) {
        const v = clampRouteVeins(patch.veins);
        if (v === ROUTE_VEINS_DEFAULT) delete r.veins; else r.veins = v;
      }
      if (patch.group !== undefined) {
        if (patch.group) r.group = patch.group; else delete r.group;
      }
      if (patch.spec !== undefined) {
        if (patch.spec) r.spec = patch.spec; else delete r.spec;
      }
    }));
  } else if (route.discipline === "water") {
    waterRows(rows, { water: routeWater(route), diameter: routeDiameter(route) }, patch => mut(r => {
      if (patch.water !== undefined) {
        if (patch.water === "koud") delete r.water; else r.water = patch.water;
      }
      if (patch.diameter !== undefined) {
        // Left untouched by the water-kind row above -- an absent diameter
        // already reads the new kind's own default through routeDiameter(),
        // so there is nothing to reset here. Only writes when the typed/chip
        // value differs from that default; matches the default exactly and
        // it is dropped back to absent.
        const d = clampRouteDiameter(patch.diameter);
        if (d === defaultRouteDiameter(routeWater(r))) delete r.diameter; else r.diameter = d;
      }
    }));
  } else if (route.discipline === "vent") {
    ventRows(rows, {
      vent: routeVent(route), ductDiameter: routeDuctDiameter(route), flow: routeFlow(route),
    }, patch => mut(r => {
      if (patch.vent !== undefined) {
        if (patch.vent === "toevoer") delete r.vent; else r.vent = patch.vent;
      }
      if (patch.ductDiameter !== undefined) {
        const d = clampDuctDiameter(patch.ductDiameter);
        if (d === VENT_DIAMETER_DEFAULT) delete r.ductDiameter; else r.ductDiameter = d;
      }
      // "flow" in patch, not patch.flow !== undefined: clearing the field IS
      // patch.flow === undefined, and has to be told apart from the row not
      // having fired at all.
      if ("flow" in patch) {
        if (patch.flow === undefined) delete r.flow; else r.flow = clampRouteFlow(patch.flow);
      }
    }));
  } else if (route.discipline === "gas") {
    gasRows(rows, route.diameter ?? 15, diameter => mut(r => {
      const d = clampRouteDiameter(diameter);
      if (d === 15) delete r.diameter; else r.diameter = d;
    }));
  }
  rows.infoRow(t("panel.routeLength"), `${Math.round(routeLength(store.floor, route))} mm`);
  const networkLength = serviceNetworkLength(store.doc, { floorId: store.floor.id, routeId: route.id });
  if (networkLength.routes > 1) {
    rows.infoRow(t("panel.routeNetworkLength"), `${Math.round(networkLength.totalLengthMm)} mm`);
    rows.infoRow(t("panel.routeVerticalLength"), `${Math.round(networkLength.verticalLengthMm)} mm`);
  }
  rows.noteRow(t("panel.routePoints", { n: route.points.length }));
  endpointRows(rows, store, route);
  materialsRows(rows, store.floor);
  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}

/**
 * Properties of every selected route at once: the same discipline-specific
 * rows renderRouteProps shows for one, driven by the PRIMARY route's
 * discipline (the pane states one run's numbers, the one clicked last, the
 * way the fit-out pane does for a group) and committed to every selected
 * member in one mutation -- re-groeping ten power runs, or re-sizing ten
 * water branches, in a single edit. A selected group is same-kind ("route")
 * but not necessarily same-discipline; writing an electrical patch field to
 * a water run in the group is harmless (an unused stored field) rather than
 * validated against, which is the deliberate simplification here -- no
 * mixed-value indication per field, unlike the other kinds' bulk panes.
 */
export function renderRouteBulk(store: Store, tools: Tools, rows: RouteRows, ids: readonly Id[]): void {
  const floor = store.floor;
  const routes = routesOf(floor).filter(r => ids.includes(r.id));
  const primary = routes[0];
  if (!primary) return;

  const mutAll = (fn: (r: Route) => void): void => {
    store.mutate(d => {
      for (const r of routesOf(store.floorOf(d))) if (ids.includes(r.id)) fn(r);
    });
  };

  rows.secHead(t("panel.selectionHeader", { n: routes.length, label: t("panel.route") }), { sel: true, mode: true });
  if (primary.discipline === "electrical") {
    electricalRows(rows, floor, {
      kind: routeKind(primary), veins: routeVeins(primary), group: primary.group ?? "", spec: primary.spec ?? "",
    }, patch => mutAll(r => {
      if (patch.kind !== undefined) { if (patch.kind === "power") delete r.kind; else r.kind = patch.kind; }
      if (patch.veins !== undefined) {
        const v = clampRouteVeins(patch.veins);
        if (v === ROUTE_VEINS_DEFAULT) delete r.veins; else r.veins = v;
      }
      if (patch.group !== undefined) { if (patch.group) r.group = patch.group; else delete r.group; }
      if (patch.spec !== undefined) { if (patch.spec) r.spec = patch.spec; else delete r.spec; }
    }));
  } else if (primary.discipline === "water") {
    waterRows(rows, { water: routeWater(primary), diameter: routeDiameter(primary) }, patch => mutAll(r => {
      if (patch.water !== undefined) { if (patch.water === "koud") delete r.water; else r.water = patch.water; }
      if (patch.diameter !== undefined) {
        const d = clampRouteDiameter(patch.diameter);
        if (d === defaultRouteDiameter(routeWater(r))) delete r.diameter; else r.diameter = d;
      }
    }));
  } else if (primary.discipline === "vent") {
    ventRows(rows, {
      vent: routeVent(primary), ductDiameter: routeDuctDiameter(primary), flow: routeFlow(primary),
    }, patch => mutAll(r => {
      if (patch.vent !== undefined) { if (patch.vent === "toevoer") delete r.vent; else r.vent = patch.vent; }
      if (patch.ductDiameter !== undefined) {
        const d = clampDuctDiameter(patch.ductDiameter);
        if (d === VENT_DIAMETER_DEFAULT) delete r.ductDiameter; else r.ductDiameter = d;
      }
      if ("flow" in patch) {
        if (patch.flow === undefined) delete r.flow; else r.flow = clampRouteFlow(patch.flow);
      }
    }));
  }
  bulkContinuationRows(rows, store, routes);
  materialsRows(rows, floor);
  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}
