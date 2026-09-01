// A furnishing as the document stores it: everything a plan is fitted out
// with, drawn to the size it is built or bought at.
//
// A furnishing is not a symbol, for the same reason a stair is not. A symbol is
// one fixed picture wherever it is placed -- a socket is a socket -- but a
// kastje is 400, 600 or 800 wide depending on what fits the run, a bath is
// 1700 or 1800 long, and a table is whatever the room takes. So the dimensions
// are stored and the drawing follows from them: the carcass and its front, the
// appliance outline and its mark, the bowl inside a basin, the pillows on a bed.
//
// One object with optional fields read only when the form matches, rather than
// a parallel object per kind -- the pattern model/route.ts already uses for its
// per-discipline vocabularies. `form` says which drawing and which of those
// fields apply; FURNISHING_PRESETS names the ordinary combinations.
import type { Id } from "./doc";
import type { ServicePort } from "./service";

/**
 * Which thing this is, and so which mark is drawn and which optional fields
 * below are read. Grouped by what the object is, not by which room it lands in:
 * the same cabinet form is an onderkast, a garderobekast and a kantoorkast.
 */
export type FurnishingForm =
  // Cabinetry.
  | "cabinet"
  // Kitchen: a fixed appliance in the standard's "toestel" outline, and the
  // worktop run with its bowl.
  | "appliance" | "counter"
  // Sanitary fixtures.
  | "toilet" | "urinal" | "urinal-trough" | "bidet"
  | "basin" | "basin-trough" | "bath" | "shower" | "shower-head"
  // Loose furniture, and the open shelving a bedrijfsruimte is fitted with.
  | "bed" | "seat" | "table" | "table-round" | "desk" | "rack";

export const FURNISHING_FORMS: readonly FurnishingForm[] = [
  "cabinet", "appliance", "counter",
  "toilet", "urinal", "urinal-trough", "bidet",
  "basin", "basin-trough", "bath", "shower", "shower-head",
  "bed", "seat", "table", "table-round", "desk", "rack",
];

/**
 * Which forms stand against a wall. A wall-mounted furnishing is anchored to
 * the edge that meets the wall with +y into the room -- the symbol library's
 * convention, shared so one hit-test, one placement gesture and one wall snap
 * serve everything -- and takes the wall snap while it is placed. A
 * free-standing one is anchored at the middle of its footprint and lands where
 * the cursor is.
 */
const WALL_MOUNTED: ReadonlySet<FurnishingForm> = new Set<FurnishingForm>([
  "cabinet", "appliance", "counter",
  "toilet", "urinal", "urinal-trough", "bidet",
  "basin", "basin-trough", "bath", "shower", "shower-head", "rack",
]);

export const furnishingWallMounted = (form: FurnishingForm): boolean => WALL_MOUNTED.has(form);

/**
 * What trade the piece belongs to. The plan draws every furnishing the same
 * way, but an export that groups by trade does not: a DXF reader expects
 * sanitair on its own layer, and IFC has a distinct entity for a fixture, an
 * appliance and a piece of furniture. One classification, so a layer name and
 * an IFC class cannot disagree about what a spoelbak is.
 */
export type FurnishingClass = "cabinetry" | "appliance" | "sanitary" | "furniture";

const CLASS_OF: Record<FurnishingForm, FurnishingClass> = {
  cabinet: "cabinetry",
  appliance: "appliance",
  // The aanrecht is drawn with the kitchen but plumbed like a fixture, and the
  // bowl is what an export is being asked about.
  counter: "sanitary",
  toilet: "sanitary",
  urinal: "sanitary",
  "urinal-trough": "sanitary",
  bidet: "sanitary",
  basin: "sanitary",
  "basin-trough": "sanitary",
  bath: "sanitary",
  shower: "sanitary",
  "shower-head": "sanitary",
  bed: "furniture",
  seat: "furniture",
  table: "furniture",
  "table-round": "furniture",
  desk: "furniture",
  rack: "furniture",
};

export const furnishingClass = (form: FurnishingForm): FurnishingClass => CLASS_OF[form];

/**
 * Height class of a cabinet. It decides the default depth, the default carcass
 * height and -- the part that matters on a plattegrond -- how the unit meets
 * the cut plane. A plan is a horizontal section at about 1200 mm:
 *
 *   base  under the plane; seen from above, drawn solid
 *   tall  cut by the plane, drawn solid
 *   wall  entirely above the plane, so drawn dashed like anything overhead
 */
export type CabinetKind = "base" | "wall" | "tall";

export const CABINET_KINDS: readonly CabinetKind[] = ["base", "wall", "tall"];

/** What closes a cabinet front. `open` is a set of shelves with no front at all. */
export type CabinetFront = "door" | "double" | "drawers" | "open" | "slide";

export const CABINET_FRONTS: readonly CabinetFront[] = [
  "door", "double", "drawers", "open", "slide",
];

/**
 * Which side a cabinet door is hung, as seen by someone in the room facing the
 * unit.
 *
 * That viewer looks along -y in the furnishing's own frame (the anchor's +y
 * runs into the room), so their left hand is at local -x and their right at +x.
 * Storing the side the way it is spoken rather than as a local axis is what
 * keeps it right after a mirror: `localPoint()` negates x for a mirrored
 * object, so the drawn hinge follows the handedness without a second field.
 */
export type CabinetHinge = "left" | "right";

/**
 * The mark inside an appliance outline -- what names the toestel. NEN draws the
 * appliance as a footprint box with a connection stub and puts the mark in it;
 * without the mark the box is the generic "toestel, vast".
 *
 * "hood" is the exception that carries no stub: an afzuigkap is not connected
 * at the floor and hangs above the section plane, so it draws dashed.
 */
export type ApplianceMark =
  | "none" | "cooktop" | "oven" | "microwave" | "fridge" | "freezer" | "hood";

export const APPLIANCE_MARKS: readonly ApplianceMark[] = [
  "none", "cooktop", "oven", "microwave", "fridge", "freezer", "hood",
];

/**
 * Where a toilet's cistern sits. "concealed" is the ingebouwde stortbak in a
 * duct, which reads as a shallower band the full width of the duct.
 */
export type ToiletCistern = "exposed" | "concealed";

export const TOILET_CISTERNS: readonly ToiletCistern[] = ["exposed", "concealed"];

/** What a shower stands in: the bare wet area, a tray, or a tray drained by a goot. */
export type ShowerTray = "none" | "tray" | "linear";

export const SHOWER_TRAYS: readonly ShowerTray[] = ["none", "tray", "linear"];

export interface Furnishing {
  id: Id;
  form: FurnishingForm;
  /**
   * Anchor in world mm. Wall-mounted forms put it at the middle of the
   * wall-touching edge with +y into the room; free-standing forms at the middle
   * of the footprint. See furnishingWallMounted().
   */
  x: number;
  y: number;
  /** Radians, clockwise on screen. */
  rotation: number;
  /** Handedness. Flips a cabinet's hinge side, a corner unit's diagonal and a
   *  worktop's drainer. */
  mirrored?: boolean;
  /** mm along the wall, or across the footprint. */
  width: number;
  /** mm into the room. */
  depth: number;
  /**
   * Height in mm. Nothing in plan draws it: it is here because a schedule needs
   * it, and because the wall graph already extrudes. Absent means the form's
   * usual figure -- read through furnishingHeight().
   */
  height?: number;

  /* ── cabinet ── */
  /** Height class. Only read when form is "cabinet". Absent reads as "base". */
  kind?: CabinetKind;
  /** Only read when form is "cabinet". Absent reads as "door". */
  front?: CabinetFront;
  /** Only read when form is "cabinet". Absent reads as "left". */
  hinge?: CabinetHinge;
  /** How many drawers the front is divided into. Only read when front is "drawers". */
  drawers?: number;
  /**
   * Diagonal-front corner unit. Only read when form is "cabinet". The carcass
   * fills the corner and the front runs across the two open edges, so a corner
   * unit is square in practice -- the derived geometry uses the smaller of
   * width and depth for the return.
   */
  corner?: boolean;
  /** Blad over the carcass, drawn as an overhang line along the front. */
  worktop?: boolean;

  /* ── appliance ── */
  /** Which toestel this is. Only read when form is "appliance". Absent is "none". */
  mark?: ApplianceMark;

  /* ── sanitary ── */
  /** Only read when form is "toilet". Absent reads as "exposed". */
  cistern?: ToiletCistern;
  /** Grab rails either side. Only read when form is "toilet". */
  rails?: boolean;
  /** How many bowls in the run. Only read when form is "basin" or "counter". */
  basins?: number;
  /** Only read when form is "shower". Absent reads as "none". */
  tray?: ShowerTray;

  /** What the piece is called on the drawing. Absent means no annotation. */
  label?: string;
  /** Pen colour "#rrggbb"; absent means the plan's default ink. */
  color?: string;
}

/**
 * The fields a preset or the tool carries -- a furnishing minus its identity
 * and its place. Every field is present here even where the form does not read
 * it, so one set of rows edits any furnishing; writeSpec() drops the ones the
 * form has no use for on the way into the document.
 */
export interface FurnishingSpec {
  form: FurnishingForm;
  width: number;
  depth: number;
  height: number;
  kind: CabinetKind;
  front: CabinetFront;
  hinge: CabinetHinge;
  drawers: number;
  corner: boolean;
  worktop: boolean;
  mark: ApplianceMark;
  cistern: ToiletCistern;
  rails: boolean;
  basins: number;
  tray: ShowerTray;
}

/**
 * Module widths. Cabinetry is ordered in these steps rather than measured,
 * which is the whole point of offering them: a run is assembled from stock
 * widths and a filler, not drawn to whatever the wall happens to be. The list
 * is the ordinary Dutch/European kitchen module ladder, and the small sizes are
 * what a filler or an apothekerskast uses.
 */
export const CABINET_WIDTHS: readonly number[] = [
  150, 200, 300, 400, 450, 500, 600, 800, 900, 1000, 1200,
];

/**
 * The sizes each form is ordinarily built to, offered as chips beside the
 * typed figure. Not a constraint -- a bath is 1700 or 1800 in almost every
 * bathroom, but the one that is 1750 still has to be drawable. A form with no
 * ladder here is measured rather than ordered.
 */
export const FORM_WIDTHS: Partial<Record<FurnishingForm, readonly number[]>> = {
  cabinet: CABINET_WIDTHS,
  appliance: [450, 550, 600, 800, 900],
  counter: [600, 800, 1000, 1200, 1600, 2000],
  basin: [400, 500, 600, 800, 1200],
  bath: [1600, 1700, 1800],
  shower: [800, 900, 1000, 1200],
  bed: [900, 1200, 1400, 1600, 1800],
  table: [1200, 1400, 1600, 1800, 2200],
  "table-round": [900, 1100, 1200, 1400],
  desk: [1200, 1400, 1600, 1800],
  rack: [1000, 2000, 2700, 3600],
};

/** Depths that go with each cabinet height class. Offered, not enforced. */
export const CABINET_DEPTHS: Record<CabinetKind, readonly number[]> = {
  base: [400, 460, 500, 600, 700],
  wall: [300, 330, 350, 400],
  tall: [400, 500, 600, 700],
};

/**
 * Where each cabinet height class starts. A base unit is the 720 carcass that
 * stands on a 150 plinth and carries a 40 blad, which is the 910 worktop height
 * every Dutch kitchen is set out to; a wall unit hangs at 700; a tall unit runs
 * to the top of the run.
 */
const KIND_DEFAULTS: Record<CabinetKind, { depth: number; height: number }> = {
  base: { depth: 600, height: 720 },
  wall: { depth: 350, height: 700 },
  tall: { depth: 600, height: 2000 },
};

/**
 * What each form is built to when nothing else is said: the size it is placed
 * at and the height it stands. Ordinary Dutch figures -- a 600 appliance slot,
 * a 1700 bath, a 750 table.
 */
const FORM_DEFAULTS: Record<FurnishingForm, { width: number; depth: number; height: number }> = {
  cabinet: { width: 600, depth: 600, height: 720 },
  appliance: { width: 600, depth: 600, height: 850 },
  counter: { width: 800, depth: 600, height: 910 },
  toilet: { width: 400, depth: 650, height: 400 },
  urinal: { width: 380, depth: 340, height: 600 },
  "urinal-trough": { width: 1200, depth: 400, height: 600 },
  bidet: { width: 380, depth: 600, height: 400 },
  basin: { width: 600, depth: 450, height: 850 },
  "basin-trough": { width: 1800, depth: 500, height: 850 },
  bath: { width: 1700, depth: 750, height: 600 },
  shower: { width: 900, depth: 900, height: 100 },
  "shower-head": { width: 400, depth: 400, height: 2100 },
  bed: { width: 900, depth: 2000, height: 500 },
  seat: { width: 2000, depth: 900, height: 800 },
  table: { width: 1600, depth: 900, height: 750 },
  "table-round": { width: 1200, depth: 1200, height: 750 },
  desk: { width: 1400, depth: 700, height: 750 },
  rack: { width: 1000, depth: 500, height: 2000 },
};

export function furnishingDefaults(form: FurnishingForm): FurnishingSpec {
  const d = FORM_DEFAULTS[form];
  return {
    form, width: d.width, depth: d.depth, height: d.height,
    kind: "base", front: "door", hinge: "left", drawers: 3, corner: false,
    // A base unit carries the worktop; a wall or tall unit does not.
    worktop: form === "cabinet",
    mark: "none", cistern: "exposed", rails: false, basins: 1, tray: "none",
  };
}

/** The same, for a cabinet of a stated height class. */
export function cabinetDefaults(kind: CabinetKind): FurnishingSpec {
  const d = KIND_DEFAULTS[kind];
  return {
    ...furnishingDefaults("cabinet"),
    kind, depth: d.depth, height: d.height, worktop: kind === "base",
  };
}

/**
 * Which group of the picker a preset is listed under. Rooms rather than forms,
 * because that is how a plan is fitted out: a kitchen is drawn in one pass.
 */
export type FurnishingGroup = "keuken" | "sanitair" | "kasten" | "meubels";

export const FURNISHING_GROUPS: readonly FurnishingGroup[] = [
  "keuken", "sanitair", "kasten", "meubels",
];

/**
 * Named pieces. The object underneath is generic, but nobody orders a "base
 * cabinet, 600, drawers": they order a ladenkast. These write the fields, in
 * the order the palette lists them.
 *
 * The ids are translation keys (`furnishing.<id>`), so adding one needs its
 * name in both languages or the i18n test fails.
 */
export interface FurnishingPreset extends FurnishingSpec {
  id: string;
  group: FurnishingGroup;
}

const preset = (
  id: string, group: FurnishingGroup, form: FurnishingForm, over: Partial<FurnishingSpec> = {},
): FurnishingPreset => ({ id, group, ...furnishingDefaults(form), ...over });

const cab = (
  id: string, group: FurnishingGroup, kind: CabinetKind, over: Partial<FurnishingSpec> = {},
): FurnishingPreset => ({ id, group, ...cabinetDefaults(kind), ...over });

export const FURNISHING_PRESETS: readonly FurnishingPreset[] = [
  // ── Keuken: cabinetry, then the toestellen that sit in the run ──
  cab("onderkast", "keuken", "base"),
  cab("ladenkast", "keuken", "base", { front: "drawers", drawers: 3 }),
  cab("spoelkast", "keuken", "base", { front: "double" }),
  cab("hoekkast-onder", "keuken", "base", { corner: true, width: 900, depth: 900 }),
  cab("vulpaneel", "keuken", "base", { width: 150, front: "open" }),
  cab("bovenkast", "keuken", "wall"),
  cab("bovenkast-open", "keuken", "wall", { front: "open" }),
  cab("hoekkast-boven", "keuken", "wall", { corner: true, width: 600, depth: 600 }),
  cab("hoge-kast", "keuken", "tall", { front: "double" }),
  cab("apparatenkast", "keuken", "tall", { front: "open" }),
  cab("koelkast-ombouw", "keuken", "tall"),
  preset("aanrecht", "keuken", "counter", { width: 800, depth: 500 }),
  preset("aanrecht-dubbel", "keuken", "counter", { width: 1200, depth: 600, basins: 2 }),
  preset("fornuis", "keuken", "appliance", { mark: "cooktop" }),
  preset("oven", "keuken", "appliance", { mark: "oven" }),
  preset("magnetron", "keuken", "appliance", { mark: "microwave", width: 550, depth: 400 }),
  preset("koelkast", "keuken", "appliance", { mark: "fridge" }),
  preset("vriezer", "keuken", "appliance", { mark: "freezer" }),
  preset("afzuigkap", "keuken", "appliance", { mark: "hood", width: 600, depth: 500 }),
  preset("toestel", "keuken", "appliance"),

  // ── Sanitair ──
  preset("toilet", "sanitair", "toilet"),
  preset("toilet-inbouw", "sanitair", "toilet", { cistern: "concealed", width: 500, depth: 620 }),
  preset("invalidentoilet", "sanitair", "toilet",
    { cistern: "concealed", rails: true, width: 880, depth: 750 }),
  preset("wandurinoir", "sanitair", "urinal"),
  preset("standurinoir", "sanitair", "urinal-trough"),
  preset("bidet", "sanitair", "bidet"),
  preset("wastafel", "sanitair", "basin"),
  preset("wastafel-dubbel", "sanitair", "basin", { width: 1200, basins: 2 }),
  preset("fonteintje", "sanitair", "basin", { width: 400, depth: 300 }),
  preset("trogwastafel", "sanitair", "basin-trough"),
  preset("bad", "sanitair", "bath"),
  preset("douchehoek", "sanitair", "shower"),
  preset("douchebak", "sanitair", "shower", { tray: "tray" }),
  preset("douchebak-goot", "sanitair", "shower", { tray: "linear" }),
  preset("douche", "sanitair", "shower-head"),
  cab("badkamermeubel", "sanitair", "base",
    { width: 800, depth: 460, front: "drawers", drawers: 2 }),

  // ── Kasten buiten de keuken. Same object, other rooms -- which is why the
  //    model is cabinetry rather than a kitchen library. ──
  cab("garderobekast", "kasten", "tall", { width: 1000, front: "double" }),
  cab("kantoorkast", "kasten", "tall", { width: 800, depth: 400, front: "double" }),
  cab("wandschap", "kasten", "wall", { width: 800, depth: 300, front: "open" }),
  preset("stellage", "kasten", "rack"),
  preset("palletstelling", "kasten", "rack", { width: 2700, depth: 1100, height: 4000 }),

  // ── Meubels ──
  preset("eenpersoonsbed", "meubels", "bed"),
  preset("tweepersoonsbed", "meubels", "bed", { width: 1600 }),
  preset("bank", "meubels", "seat"),
  preset("fauteuil", "meubels", "seat", { width: 900, depth: 850 }),
  preset("tafel", "meubels", "table"),
  preset("ronde-tafel", "meubels", "table-round"),
  preset("bureau", "meubels", "desk"),
];

export function furnishingPreset(id: string): FurnishingPreset | undefined {
  return FURNISHING_PRESETS.find(p => p.id === id);
}

/**
 * Which named piece a furnishing currently matches, or null once it has been
 * tuned into something the list does not name. Matched on what the piece IS --
 * form, size and the options that change what it is -- and not on hinge side or
 * drawer count, which are tunings: a ladenkast with four drawers hung the other
 * way is still a ladenkast, the way doorKindOf() ignores which jamb a leaf
 * hangs on.
 */
export function furnishingPresetOf(f: Furnishing): FurnishingPreset | null {
  return FURNISHING_PRESETS.find(p =>
    p.form === f.form
    && p.width === f.width
    && p.depth === f.depth
    && (p.form !== "cabinet" || (p.kind === furnishingKind(f) && p.front === furnishingFront(f)))
    && p.corner === !!f.corner
    && p.worktop === !!f.worktop
    && p.mark === applianceMark(f)
    && p.cistern === toiletCistern(f)
    && p.rails === !!f.rails
    && p.basins === furnishingBasins(f)
    && p.tray === showerTray(f)) ?? null;
}

/* ── defaulted reads. Never touch the optional field directly: an absent one
   has a meaning, and reading it raw spreads that default over the codebase. ── */

export const furnishingKind = (f: Furnishing): CabinetKind => f.kind ?? "base";
export const furnishingFront = (f: Furnishing): CabinetFront => f.front ?? "door";
export const furnishingHinge = (f: Furnishing): CabinetHinge => f.hinge ?? "left";
export const applianceMark = (f: Furnishing): ApplianceMark => f.mark ?? "none";

/**
 * Which services a piece of fit-out takes, and where a run reaches it. See
 * model/service.ts for the coordinate convention (fractions of the footprint,
 * because a bath is built to a size) and for what `required` claims.
 *
 * The positions are the ordinary layout of the fixture, not a measurement of
 * any particular one: a bath's taps at the head end, a douche's waste in the
 * middle of the tray, a closet's supply high at the wall and its afvoer at the
 * trap. Read as a convention like SymbolDef.mountHeight — right for the usual
 * case, and moved by dragging the waypoint when it is not.
 *
 * Computed rather than tabled, because two of the answers depend on the piece:
 * an aanrecht needs water only once it has a bowl in it, and an appliance's
 * services follow its mark.
 */
export function furnishingPorts(f: Furnishing): ServicePort[] {
  const supply = (v: number): ServicePort[] => [
    { key: "water:koud", required: true, v },
    { key: "water:warm", required: true, v },
  ];
  switch (f.form) {
    case "bath":
      // Taps and waste at the head end, which is the end a bath is plumbed at.
      return [...supply(0.15).map(p => ({ ...p, u: 0.15 })),
        { key: "water:afvoer", required: true, u: 0.15, v: 0.5 }];
    case "shower":
      return [...supply(0.08), { key: "water:afvoer", required: true, v: 0.5 }];
    case "shower-head":
      return supply(0.1);
    case "basin":
    case "basin-trough":
      return [...supply(0.1), { key: "water:afvoer", required: true, v: 0.3 }];
    case "bidet":
      return [...supply(0.2), { key: "water:afvoer", required: true, v: 0.4 }];
    case "toilet":
      // Cistern feed high at the wall; the trap is forward of it.
      return [{ key: "water:koud", required: true, v: 0.05 },
        { key: "water:afvoer", required: true, v: 0.4 }];
    case "urinal":
    case "urinal-trough":
      return [{ key: "water:koud", required: true, v: 0.05 },
        { key: "water:afvoer", required: true, v: 0.4 }];
    case "counter":
      // An aanrecht is plumbed for the bowl it holds. Without one it is a
      // worktop, and nothing is missing from it.
      return (f.basins ?? 0) > 0
        ? [...supply(0.5), { key: "water:afvoer", required: true, v: 0.5 }]
        : [];
    case "appliance":
      return appliancePorts(applianceMark(f));
    default:
      return [];
  }
}

function appliancePorts(mark: ApplianceMark): ServicePort[] {
  switch (mark) {
    // Gas OR power, never both — see ServicePort.alt.
    case "cooktop":
      return [{ key: "electrical:power", required: true, alt: "hob" },
        { key: "gas", required: true, alt: "hob" }];
    case "hood":
      return [{ key: "electrical:power", required: true },
        { key: "vent:afvoer", required: true, v: 0 }];
    case "oven":
    case "microwave":
    case "fridge":
    case "freezer":
      return [{ key: "electrical:power", required: true }];
    default:
      // An unmarked toestel: connectable, since the standard's own outline
      // carries a supply stub, but nothing here knows what it needs.
      return [{ key: "electrical:power" }];
  }
}
export const toiletCistern = (f: Furnishing): ToiletCistern => f.cistern ?? "exposed";
export const showerTray = (f: Furnishing): ShowerTray => f.tray ?? "none";

/** Height, defaulted from the form -- and, for a cabinet, its height class. */
export const furnishingHeight = (f: Furnishing): number =>
  f.height ?? (f.form === "cabinet"
    ? KIND_DEFAULTS[furnishingKind(f)].height
    : FORM_DEFAULTS[f.form].height);

/** Drawer count, defaulted and bounded to what is drawable at plan scale. */
export const furnishingDrawers = (f: Furnishing): number =>
  Math.max(1, Math.min(8, Math.round(f.drawers ?? 3)));

/** Bowl count in a basin run or a worktop. */
export const furnishingBasins = (f: Furnishing): number =>
  Math.max(1, Math.min(2, Math.round(f.basins ?? 1)));

/**
 * How many people the bed is made up for, from its width. A bed is not stored
 * with a place count because the width already says it: 900 and 1200 are
 * eenpersoons, 1400 upward is tweepersoons, and a bed resized across that line
 * should gain its second pillow rather than keep a stale field.
 */
export const bedPlaces = (f: Furnishing): number => (f.width >= 1300 ? 2 : 1);

/** The nominal bay of open shelving, mm -- see rackBays(). */
const RACK_BAY_MM = 1000;

/**
 * How many bays a rack is divided into, from its width. Like bedPlaces(), the
 * count is read off the size rather than stored: a stellage is assembled from
 * bays of about a metre between uprights, so a run widened to three metres has
 * three bays whether or not anyone said so.
 */
export const rackBays = (f: Furnishing): number =>
  Math.max(1, Math.min(12, Math.round(f.width / RACK_BAY_MM)));

/**
 * Whether the piece sits entirely above the plan's section plane, and so is
 * drawn dashed: a wall cabinet, and an afzuigkap over the fornuis.
 */
export const furnishingOverhead = (f: Furnishing): boolean =>
  (f.form === "cabinet" && furnishingKind(f) === "wall")
  || (f.form === "appliance" && applianceMark(f) === "hood");

/** Whole millimetres, and within what a furnishing can be built to. */
export function clampFurnishing(s: FurnishingSpec): FurnishingSpec {
  return {
    ...s,
    width: clampInt(s.width, 100, 6000),
    depth: clampInt(s.depth, 100, 3000),
    height: clampInt(s.height, 50, 6000),
    drawers: clampInt(s.drawers, 1, 8),
    basins: clampInt(s.basins, 1, 2),
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(isFinite(n) ? n : lo)));
}

/** A placed furnishing's fields as the editable specification. */
export function furnishingSpecOf(f: Furnishing): FurnishingSpec {
  return {
    form: f.form, width: f.width, depth: f.depth, height: furnishingHeight(f),
    kind: furnishingKind(f), front: furnishingFront(f), hinge: furnishingHinge(f),
    drawers: furnishingDrawers(f), corner: !!f.corner, worktop: !!f.worktop,
    mark: applianceMark(f), cistern: toiletCistern(f), rails: !!f.rails,
    basins: furnishingBasins(f), tray: showerTray(f),
  };
}

/**
 * Write a specification onto a furnishing, dropping every field the form does
 * not read. A bed carrying a hinge side would survive undo, reach the export
 * and mean nothing; leaving the field out is what keeps the stored document
 * saying only what the form actually uses.
 */
export function writeSpec(f: Furnishing, s: FurnishingSpec): void {
  f.form = s.form;
  f.width = s.width;
  f.depth = s.depth;
  f.height = s.height;

  optional(f, "kind", s.form === "cabinet" ? s.kind : undefined, "base");
  optional(f, "front", s.form === "cabinet" ? s.front : undefined, "door");
  optional(f, "hinge", s.form === "cabinet" && s.front === "door" ? s.hinge : undefined, "left");
  optional(f, "drawers", s.form === "cabinet" && s.front === "drawers" ? s.drawers : undefined, 3);
  flag(f, "corner", s.form === "cabinet" && s.corner);
  flag(f, "worktop", (s.form === "cabinet" || s.form === "counter") && s.worktop);
  optional(f, "mark", s.form === "appliance" ? s.mark : undefined, "none");
  optional(f, "cistern", s.form === "toilet" ? s.cistern : undefined, "exposed");
  flag(f, "rails", s.form === "toilet" && s.rails);
  optional(f, "basins", s.form === "basin" || s.form === "counter" ? s.basins : undefined, 1);
  optional(f, "tray", s.form === "shower" ? s.tray : undefined, "none");
}

/** Set an optional field, or delete it when it is absent or at its default. */
function optional<K extends keyof Furnishing>(
  f: Furnishing, key: K, value: Furnishing[K] | undefined, fallback: Furnishing[K],
): void {
  if (value === undefined || value === fallback) delete f[key];
  else f[key] = value;
}

function flag(f: Furnishing, key: "corner" | "worktop" | "rails", on: boolean): void {
  if (on) f[key] = true; else delete f[key];
}

/** The nearest module width at or below `mm`, for snapping a dragged width. */
export function nearestModule(mm: number): number {
  let best = CABINET_WIDTHS[0]!;
  for (const w of CABINET_WIDTHS) if (Math.abs(w - mm) < Math.abs(best - mm)) best = w;
  return best;
}
