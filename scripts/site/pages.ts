// The four content pages, generated from the app's own code.
//
// The symbol and opening pages draw by *replaying the editor's drawing calls* —
// `recordSymbol` and `openingMarks`, the same functions the SVG and DXF
// exporters use — rather than by keeping a second, hand-drawn copy of 77 symbols
// and 27 opening marks. A hand-kept copy would be wrong within a release, and
// wrong in the worst way: a page that authoritatively shows the wrong mark.
import { SYMBOLS, CATEGORIES, type SymbolDef, type SymbolCategory } from "../../src/render/symbols";
import { recordSymbol, type Prim } from "../../src/io/record";
import { primSvg } from "../../src/io/svg";
import { resolveFloor } from "../../src/core/resolve";
import { openingMarks } from "../../src/io/marks";
import {
  WINDOW_KINDS, DOOR_KINDS, type Sash, type Floor, type OpeningKind,
} from "../../src/model/doc";
import { COLORS } from "../../src/render/draw";
import { changeLanguage, t, type Lang } from "../../src/i18n";
import { DOCS, SITE, type DocId } from "./meta";
import { shell, esc, editorHref, type SiteCtx } from "./html";

/** Stroke weights, mm, matching the SVG exporter so a page and an export agree. */
const W_SYMBOL = 16;
const W_WALL = 12;

/** The sample wall every opening mark is drawn in, and how far above and below
 *  its centerline the frame reaches. Wide enough for an 1800 mm double door with
 *  both leaves swung open. */
const SAMPLE_SPAN = 3200;
const SAMPLE_REACH = 1100;

const num = (v: number): string => (Math.round(v * 100) / 100).toString();

interface Box { minX: number; minY: number; maxX: number; maxY: number }

const EMPTY: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

function grow(b: Box, x: number, y: number): Box {
  return {
    minX: Math.min(b.minX, x), minY: Math.min(b.minY, y),
    maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y),
  };
}

/**
 * Bounds of recorded geometry. Arcs are bounded by their whole circle rather
 * than by the swept part — a tighter box would mean solving for the extrema on
 * a signed sweep, and the cost of being generous is a few millimetres of white
 * space on a thumbnail.
 */
function boundsOf(prims: Prim[]): Box {
  let b = EMPTY;
  for (const p of prims) {
    if (p.kind === "line") { b = grow(b, p.a.x, p.a.y); b = grow(b, p.b.x, p.b.y); }
    else if (p.kind === "poly") for (const pt of p.pts) b = grow(b, pt.x, pt.y);
    else if (p.kind === "arc") { b = grow(b, p.c.x - p.r, p.c.y - p.r); b = grow(b, p.c.x + p.r, p.c.y + p.r); }
    else b = grow(b, p.at.x - p.size, p.at.y - p.size), b = grow(b, p.at.x + p.size, p.at.y + p.size);
  }
  return b;
}

/** A viewBox with room for the stroke, plus the display size to lay it out at. */
function frame(b: Box, pad: number, maxH: number, maxW: number): string {
  if (!Number.isFinite(b.minX)) return `viewBox="-50 -50 100 100" width="${maxH}" height="${maxH}"`;
  const x = b.minX - pad, y = b.minY - pad;
  const w = Math.max(1, b.maxX - b.minX + pad * 2), h = Math.max(1, b.maxY - b.minY + pad * 2);
  const scale = Math.min(maxH / h, maxW / w);
  return `viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}"` +
    ` width="${Math.round(w * scale)}" height="${Math.round(h * scale)}"`;
}

/** One symbol, drawn exactly as the editor draws it, at rest. */
function symbolSvg(def: SymbolDef, label: string): string {
  const prims = recordSymbol(def, 0, 0, 0, false);
  // Union with the declared footprint: a symbol may draw inside its box (a
  // wall-mounted socket is a mark, not an outline), and the footprint is what
  // the plan actually reserves.
  let b = boundsOf(prims);
  const halfW = def.width / 2;
  b = grow(b, -halfW, def.wallMounted ? 0 : -def.depth / 2);
  b = grow(b, halfW, def.wallMounted ? def.depth : def.depth / 2);
  return `<svg ${frame(b, W_SYMBOL, 72, 150)} fill="none" stroke="currentColor"` +
    ` stroke-width="${W_SYMBOL}" stroke-linecap="round" stroke-linejoin="round"` +
    ` role="img" aria-label="${esc(label)}">${prims.map(primSvg).join("")}</svg>`;
}

/**
 * One opening type as a plan mark: a short stretch of wall with the opening in
 * it, resolved and drawn through the real pipeline. Building an actual one-wall
 * document is the only way to get the jambs, the gap in the masonry and the
 * swing to agree with what the editor would show.
 */
function openingSvg(kind: OpeningKind, sashes: Sash[], width: number, label: string): string {
  const floor: Floor = {
    id: "f", name: "sample",
    nodes: [{ id: "n0", x: 0, y: 0 }, { id: "n1", x: SAMPLE_SPAN, y: 0 }],
    walls: [{
      id: "w", a: "n0", b: "n1", thickness: 100, bulge: 0,
      openings: [{ id: "o", kind, t: SAMPLE_SPAN / 2, width, sashes }],
    }],
    symbols: [],
  };
  const resolved = resolveFloor(floor);
  const rw = [...resolved.walls.values()][0]!;
  const marks = openingMarks(rw);
  const solids: Prim[] = rw.pieces.map(p => ({ kind: "poly", pts: p.poly, closed: true }));
  // One frame for every type rather than a tight box per mark. Fitting each one
  // individually drew a vast raam — which has no swing at all — at three times
  // the scale of a schuifpui, so the wall came out thicker on the type with the
  // least happening in it. A shared frame makes the row comparable, which is the
  // only reason to put them side by side. The real bounds still widen it when a
  // mark needs the room, and y stays symmetric so the wall line never moves.
  const b = boundsOf([...solids, ...marks]);
  const reach = Math.max(SAMPLE_REACH, Math.abs(b.minY), Math.abs(b.maxY));
  const box: Box = {
    minX: Math.min(0, b.minX), maxX: Math.max(SAMPLE_SPAN, b.maxX),
    minY: -reach, maxY: reach,
  };
  return `<svg ${frame(box, W_WALL, 132, 300)} role="img" aria-label="${esc(label)}">` +
    `<g fill="${COLORS.wallFill}" stroke="${COLORS.wallStroke}" stroke-width="${W_WALL}">` +
    solids.map(primSvg).join("") + `</g>` +
    `<g fill="none" stroke="currentColor" stroke-width="${W_WALL}" stroke-linecap="round">` +
    marks.map(primSvg).join("") + `</g></svg>`;
}

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

/* ── the pages ──────────────────────────────────────────────────────────── */

function symbolsBody(lang: Lang): string {
  const dims = lang === "nl" ? "breedte × diepte" : "width × depth";
  const wall = lang === "nl" ? "wandmontage" : "wall-mounted";
  const free = lang === "nl" ? "vrijstaand" : "free-standing";
  const out: string[] = [];
  for (const [cat] of CATEGORIES) {
    const list = SYMBOLS.filter(s => s.category === (cat as SymbolCategory));
    if (list.length === 0) continue;
    out.push(`<h2 id="${cat}">${esc(t("category." + cat))} <small>(${list.length})</small></h2>`);
    out.push(`<ul class="grid">`);
    for (const def of list) {
      const name = t("symbol." + def.type);
      out.push(
        `<li class="tile"><figure>${symbolSvg(def, name)}</figure>` +
        `<b>${esc(name)}</b>` +
        `<small><code>${esc(def.type)}</code><br>${def.width}×${def.depth} mm ${dims}<br>` +
        `${def.wallMounted ? wall : free}</small></li>`,
      );
    }
    out.push(`</ul>`);
  }
  const note = lang === "nl"
    ? `<p>De <code>type</code>-waarde onder elk symbool is wat er in het documentbestand komt te staan — ` +
      `zie het <a href="/formaat/">documentformaat</a> als je een plattegrond programmatisch schrijft.</p>`
    : `<p>The <code>type</code> under each symbol is what goes in the document file — ` +
      `see the <a href="/en/format/">document format</a> if you are writing a plan programmatically.</p>`;
  out.push(`<h2>${lang === "nl" ? "Symbolen gebruiken" : "Using the symbols"}</h2>`, note);
  return out.join("\n");
}

function openingsBody(lang: Lang): string {
  const out: string[] = [];
  const planNote = t("panel.planNote");

  out.push(`<h2 id="ramen">${lang === "nl" ? "Raamtypen" : "Window types"} <small>(${WINDOW_KINDS.length})</small></h2>`);
  out.push(`<ul class="grid wide">`);
  for (const k of WINDOW_KINDS) {
    const name = t("panel.win" + cap(k.id));
    const sashes: Sash[] = k.expandsTo ?? [{ action: k.action, hinge: k.hinge, outward: k.outward }];
    const invisible = k.hinge === "head" || k.hinge === "sill" || k.action === "tumble";
    out.push(
      `<li class="tile"><figure>${openingSvg("window", sashes, 1200, name)}</figure>` +
      `<b>${esc(name)}</b><small><code>${esc(k.action)}</code>` +
      (invisible ? `<br>${esc(planNote)}` : "") + `</small></li>`,
    );
  }
  out.push(`</ul>`);

  out.push(`<h2 id="deuren">${lang === "nl" ? "Deurtypen" : "Door types"} <small>(${DOOR_KINDS.length})</small></h2>`);
  out.push(`<ul class="grid wide">`);
  for (const k of DOOR_KINDS) {
    const name = t("panel.dr" + cap(k.id));
    const leaves = k.sashes.length;
    const width = leaves > 1 ? 1800 : 900;
    out.push(
      `<li class="tile"><figure>${openingSvg("door", k.sashes, width, name)}</figure>` +
      `<b>${esc(name)}</b><small>${leaves} ${lang === "nl" ? (leaves === 1 ? "vleugel" : "vleugels") : (leaves === 1 ? "leaf" : "leaves")}` +
      `<br><code>${k.sashes.map(s => esc(s.action)).join(" + ")}</code></small></li>`,
    );
  }
  out.push(`</ul>`);

  out.push(`<h2>${lang === "nl" ? "Wat een marker vertelt" : "What a mark says"}</h2>`);
  out.push(lang === "nl"
    ? `<ul>
<li>Een <b>doorgetrokken</b> vleugellijn is naar buiten draaiend, een <b>gestreepte</b> naar binnen — zo staat het op de NEN-bladen.</li>
<li>De scharnierzijde heet <code>a</code> of <code>b</code> naar de richting van de muur zelf, dus hij blijft kloppen als je de muur opnieuw tekent.</li>
<li>Horizontale scharnieren (bovendorpel, onderdorpel) bestaan in het document maar zijn in plattegrond niet te zien; een valraam en een uitzetraam tekenen daar hetzelfde.</li>
<li>Een <b>pui</b> is één kozijn met vast glas naast bewegende delen — één gat in de muur, verdeeld door stijlen, geen twee openingen met een verzonnen penant ertussen.</li>
</ul>`
    : `<ul>
<li>A <b>solid</b> leaf line opens outward, a <b>dashed</b> one inward — that is how the NEN sheets encode direction.</li>
<li>The hinge side is named <code>a</code> or <code>b</code> after the wall's own direction, so it survives the wall being redrawn.</li>
<li>Horizontal hinges (head, sill) exist in the document but cannot be seen in plan; a valraam and an uitzetraam draw identically there.</li>
<li>A <b>pui</b> is one frame holding fixed glazing beside opening parts — one hole divided by mullions, not two openings with a pier invented between them.</li>
</ul>`);
  return out.join("\n");
}

function manualBody(lang: Lang): string {
  const editor = editorHref(lang);
  if (lang === "nl") {
    return `<h2 id="muren">Muren tekenen</h2>
<p>Druk op <kbd>W</kbd>, klik het beginpunt en klik verder om een keten te tekenen. Terwijl je
tekent kun je een lengte <b>typen</b> in millimeters: de cijfers verschijnen in een invoervakje en
<kbd>Enter</kbd> legt het segment precies op die lengte in de richting waar je staat. Dat is wat de
editor in de praktijk millimeternauwkeurig maakt, niet alleen in de opslag. <kbd>Esc</kbd> sluit de keten af.</p>
<ul>
<li><kbd>O</kbd> zet hoeksnapping (90°/45°) aan en uit.</li>
<li><kbd>G</kbd> zet rastersnapping aan en uit. Uit blijft nog steeds op hele millimeters afronden.</li>
<li>Teken je tegen een bestaande muur aan, dan splitst die muur zichzelf en ontstaat er een T-knoop.</li>
</ul>

<h2 id="selecteren">Selecteren, verplaatsen, krommen</h2>
<p>Met <kbd>V</kbd> sleep je knopen, muren en symbolen. Een geselecteerde muur krijgt een ruit­vormige
greep op het midden; die slepen buigt de muur tot een cirkelboog. De exacte pijlhoogte in millimeters
staat daarna in het paneel, net als de dikte en de lengte. Lengte aanpassen verschuift het verre
uiteinde langs de muurrichting.</p>

<h2 id="openingen">Deuren, ramen en doorgangen</h2>
<p><kbd>D</kbd>, <kbd>N</kbd> en <kbd>P</kbd> plaatsen een deur, een raam en een doorgang. Klik op een
muur; terwijl je schuift lees je live de afstand tot beide muuruiteinden, zodat &ldquo;150 mm uit de
hoek&rdquo; iets is waar je naartoe schuift in plaats van uitrekent. Richting, breedte en type stel je
daarna in het paneel in — alle typen staan op <a href="/kozijnen/">deur- en raamtypen</a>.</p>
<p>Een opening zit vast aan zijn muur, niet aan de tekening: verplaats je de muur, dan gaat de deur mee.</p>

<h2 id="symbolen">Symbolen</h2>
<p><kbd>S</kbd> opent het symboolgereedschap; zoeken in de palet werkt in beide talen tegelijk, dus
&ldquo;socket&rdquo; vindt de wandcontactdoos ook als de interface Nederlands staat. Symbolen die aan
een muur horen klikken vlak tegen het muurvlak en draaien mee. <kbd>R</kbd> roteert, <kbd>M</kbd>
spiegelt. Kleur is betekenis, geen opmaak: zwart is bestaand, rood is nieuw, geel verdwijnt.
Alle 77 staan op <a href="/symbolen/">plattegrondsymbolen</a>.</p>

<h2 id="ruimtes">Ruimtes en maten</h2>
<p>Gesloten muurlussen worden automatisch als ruimte herkend, met oppervlakte erbij. De maat is
standaard <b>netto</b> (binnenwerks, NEN 2580); de legenda op het canvas zegt welke conventie geldt en
in het Plan-paneel wissel je naar hart-op-hart. <kbd>L</kbd> zet maatlijnen op alle muren aan en uit;
klik een maat-pil om de lengte te typen.</p>

<h2 id="exporteren">Opslaan en exporteren</h2>
<ul>
<li><b>PNG</b> — de plattegrond als afbeelding, op de tekening bijgesneden, zonder raster, met schaalbalk.</li>
<li><b>SVG</b> — vectorwerk op ware schaal: 1 mm in het document is 1 mm op papier bij 100% afdrukken.</li>
<li><b>DXF</b> — muren, draaicirkels, symbolen en oppervlaktes op aparte lagen, in millimeters, voor CAD.</li>
<li><b>JSON</b> — het document zelf; zie <a href="/formaat/">documentformaat</a>.</li>
</ul>
<p>Je werk staat automatisch in je eigen browser opgeslagen. Er is geen account en er gaat niets naar
een server: sluit je het tabblad, dan staat de plattegrond er de volgende keer weer.</p>

<h2 id="sneltoetsen">Sneltoetsen</h2>
<table><thead><tr><th>Toets</th><th>Doet</th></tr></thead><tbody>
<tr><td><kbd>V</kbd></td><td>selecteren en verplaatsen</td></tr>
<tr><td><kbd>W</kbd></td><td>muren tekenen</td></tr>
<tr><td><kbd>D</kbd> <kbd>N</kbd> <kbd>P</kbd></td><td>deur, raam, doorgang</td></tr>
<tr><td><kbd>S</kbd></td><td>symbool plaatsen</td></tr>
<tr><td><kbd>O</kbd></td><td>hoeksnapping aan/uit</td></tr>
<tr><td><kbd>G</kbd></td><td>rastersnapping aan/uit</td></tr>
<tr><td><kbd>L</kbd></td><td>maatlijnen aan/uit</td></tr>
<tr><td><kbd>R</kbd> <kbd>M</kbd></td><td>roteren, spiegelen</td></tr>
<tr><td><kbd>Del</kbd></td><td>selectie verwijderen</td></tr>
<tr><td><kbd>Esc</kbd></td><td>afbreken / keten afsluiten</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd></td><td>ongedaan maken</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td><td>opnieuw</td></tr>
<tr><td>scrollen</td><td>zoomen naar de cursor</td></tr>
<tr><td>rechts slepen</td><td>verschuiven</td></tr>
</tbody></table>
<p class="note"><a href="${editor}">Open de editor</a> en probeer het — er valt niets stuk te maken,
en <kbd>Ctrl</kbd>+<kbd>Z</kbd> gaat altijd terug.</p>`;
  }
  return `<h2 id="walls">Drawing walls</h2>
<p>Press <kbd>W</kbd>, click a start point, and keep clicking to chain segments. While you draw you can
<b>type</b> a length in millimetres: the digits appear in an input box and <kbd>Enter</kbd> commits the
segment at exactly that length in the direction you are pointing. That is what makes the editor
mm-exact in practice rather than only in storage. <kbd>Esc</kbd> ends the chain.</p>
<ul>
<li><kbd>O</kbd> toggles angle snapping (90°/45°).</li>
<li><kbd>G</kbd> toggles grid snapping. Off still rounds to whole millimetres.</li>
<li>Draw into an existing wall and it splits itself, giving you a T-junction.</li>
</ul>

<h2 id="select">Selecting, moving, curving</h2>
<p><kbd>V</kbd> drags nodes, walls and symbols. A selected wall grows a diamond handle at its midpoint;
dragging it bows the wall into a circular arc. The exact sagitta in millimetres is then editable in the
panel, alongside thickness and length. Editing the length moves the far node along the wall direction.</p>

<h2 id="openings">Doors, windows and passages</h2>
<p><kbd>D</kbd>, <kbd>N</kbd> and <kbd>P</kbd> place a door, a window and a passage. Click on a wall;
as you slide it, live dimensions to both wall ends are shown, so &ldquo;150 mm from the corner&rdquo; is
something you slide to rather than calculate. Direction, width and type follow in the panel — every
type is on <a href="/en/openings/">door and window types</a>.</p>
<p>An opening belongs to its wall, not to the drawing: move the wall and the door goes with it.</p>

<h2 id="symbols">Symbols</h2>
<p><kbd>S</kbd> opens the symbol tool; the palette search matches both languages at once, so
&ldquo;wandcontactdoos&rdquo; finds the socket even with the interface in English. Wall-mounted symbols
snap flush to the wall face and orient themselves. <kbd>R</kbd> rotates, <kbd>M</kbd> mirrors. Colour is
meaning rather than decoration: black is existing, red is new work, yellow is going. All 77 are on
<a href="/en/symbols/">floorplan symbols</a>.</p>

<h2 id="rooms">Rooms and dimensions</h2>
<p>Closed wall loops are detected as rooms and labelled with their area. That area is <b>net</b> by
default (inner faces, NEN 2580); the canvas legend states which convention is in force, and the Plan
panel switches to centerline. <kbd>L</kbd> toggles dimension lines on every wall; click a dimension pill
to type the length.</p>

<h2 id="export">Saving and exporting</h2>
<ul>
<li><b>PNG</b> — the plan as an image, cropped to the drawing, no grid, with a scale bar.</li>
<li><b>SVG</b> — vector artwork at true scale: 1 mm in the document is 1 mm on paper printed at 100%.</li>
<li><b>DXF</b> — walls, swings, symbols and areas on separate layers, in millimetres, for CAD.</li>
<li><b>JSON</b> — the document itself; see <a href="/en/format/">document format</a>.</li>
</ul>
<p>Your work is saved in your own browser automatically. There is no account and nothing goes to a
server: close the tab and the plan is there next time.</p>

<h2 id="shortcuts">Keyboard shortcuts</h2>
<table><thead><tr><th>Key</th><th>Does</th></tr></thead><tbody>
<tr><td><kbd>V</kbd></td><td>select and move</td></tr>
<tr><td><kbd>W</kbd></td><td>draw walls</td></tr>
<tr><td><kbd>D</kbd> <kbd>N</kbd> <kbd>P</kbd></td><td>door, window, passage</td></tr>
<tr><td><kbd>S</kbd></td><td>place a symbol</td></tr>
<tr><td><kbd>O</kbd></td><td>angle snap on/off</td></tr>
<tr><td><kbd>G</kbd></td><td>grid snap on/off</td></tr>
<tr><td><kbd>L</kbd></td><td>dimension lines on/off</td></tr>
<tr><td><kbd>R</kbd> <kbd>M</kbd></td><td>rotate, mirror</td></tr>
<tr><td><kbd>Del</kbd></td><td>delete the selection</td></tr>
<tr><td><kbd>Esc</kbd></td><td>cancel / end the chain</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd></td><td>undo</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td><td>redo</td></tr>
<tr><td>scroll</td><td>zoom to the cursor</td></tr>
<tr><td>right-drag</td><td>pan</td></tr>
</tbody></table>
<p class="note"><a href="${editor}">Open the editor</a> and try it — nothing here can be broken, and
<kbd>Ctrl</kbd>+<kbd>Z</kbd> always goes back.</p>`;
}

/** A minimal but complete document: one room, one door, one socket. */
const EXAMPLE = JSON.stringify({
  version: 1,
  unit: "mm",
  gridMm: 100,
  areaMode: "net",
  floors: [{
    id: "f1",
    name: "Begane grond",
    nodes: [
      { id: "n1", x: 0, y: 0 }, { id: "n2", x: 4000, y: 0 },
      { id: "n3", x: 4000, y: 3000 }, { id: "n4", x: 0, y: 3000 },
    ],
    walls: [
      { id: "w1", a: "n1", b: "n2", thickness: 300, bulge: 0, openings: [] },
      { id: "w2", a: "n2", b: "n3", thickness: 300, bulge: 0, openings: [
        { id: "o1", kind: "window", t: 1500, width: 1200, sashes: [{ action: "turn", hinge: "a" }] },
      ] },
      { id: "w3", a: "n3", b: "n4", thickness: 300, bulge: 0, openings: [
        { id: "o2", kind: "door", t: 2000, width: 900, sashes: [{ action: "turn", hinge: "a" }] },
      ] },
      { id: "w4", a: "n4", b: "n1", thickness: 300, bulge: 0, openings: [] },
    ],
    symbols: [
      { id: "s1", type: "socket", x: 800, y: 150, rotation: Math.PI, wallId: "w1" },
    ],
  }],
}, null, 2);

function formatBody(lang: Lang, ctx: SiteCtx): string {
  const schemaUrl = ctx.siteUrl ? `${ctx.siteUrl}/wallgraph.schema.json` : "/wallgraph.schema.json";
  const origin = ctx.siteUrl || "https://plattegrond.crocode.nl";
  const example = esc(EXAMPLE);
  const api = `<pre><code>// Load a plan into the running editor. Returns false if it is not a plan.
window.wallgraph.load(doc)

// The current plan, as a deep copy.
const doc = window.wallgraph.save()

// A shareable link to this page carrying the current plan.
window.wallgraph.link()

// Read or switch the interface language ("nl" | "en").
window.wallgraph.language("en")

// Which build is running, and where the schema for the document lives.
window.wallgraph.version
window.wallgraph.schema</code></pre>`;

  if (lang === "nl") {
    return `<h2 id="model">Het model</h2>
<p>Een plattegrond is een <b>vlakke graaf van muurhartlijnen</b>. Opgeslagen worden knopen, muren
(hartlijnen met een dikte en eventueel een boog), openingen die op hun muur geparametriseerd zijn, en
geplaatste symbolen. <b>Niets afgeleids staat in het bestand</b>: muurvlakken, verstekken,
ruimtepolygonen, oppervlaktes en maatlijnen worden bij het tekenen opnieuw berekend.</p>
<p>Dat is waarom een deur zijn muur gratis doorsnijdt en waarom het bestand klein en leesbaar blijft.
Voor wie er een genereert betekent het vooral: schrijf de graaf, niet de tekening.</p>
<ul>
<li>Alle coördinaten en maten zijn <b>hele millimeters</b>. Geen komma's, geen meters.</li>
<li><b>y wijst naar beneden</b>, net als op het canvas.</li>
<li><code>bulge</code> is de DXF-conventie <code>tan(θ/4)</code>: <code>0</code> is recht. Hij is
verplicht — weglaten betekent niet &ldquo;recht&rdquo;, het betekent dat de boogberekening NaN ziet.</li>
<li>Een opening zit op <code>t</code> millimeter vanaf knoop <code>a</code>, gemeten over de hartlijn.</li>
</ul>

<h2 id="schema">JSON Schema</h2>
<p>Het formaat staat als JSON Schema (draft 2020-12) op
<a href="${schemaUrl}"><code>/wallgraph.schema.json</code></a>. Elk veld is beschreven en onbekende
velden worden afgekeurd — een sleutel die stilzwijgend genegeerd wordt is precies de fout die je niet
ziet: de plattegrond laadt, het stopcontact ontbreekt, en niets zei waarom.</p>

<h2 id="voorbeeld">Een compleet voorbeeld</h2>
<p>Eén kamer van 4 × 3 meter met een deur, een draairaam en een stopcontact. Dit is een geldig bestand;
plak het in de editor via het menu, of laad het via een link.</p>
<pre><code>${example}</code></pre>

<h2 id="agents">Voor AI-agents</h2>
<p>De editor is bedoeld om ook door een agent bediend te worden, niet alleen door een muis. Er zijn twee
ingangen, en geen van beide vraagt om een account of een API-sleutel.</p>
<h3>1. Een plattegrond in een link</h3>
<p>Zet het document als JSON in een <code>base64url</code>-string achter <code>#plan=</code>. Alles achter
de <code>#</code> blijft in de browser en gaat nooit naar de server, dus een plattegrond die zo gedeeld
wordt is niet openbaarder dan de link zelf.</p>
<pre><code>${origin}/#plan=&lt;base64url van het JSON-document&gt;

# en optioneel de taal erbij:
${origin}/#plan=&lt;…&gt;&amp;lang=en</code></pre>
<p>De plattegrond vervangt wat er stond, maar wél als ongedaan-te-maken stap: <kbd>Ctrl</kbd>+<kbd>Z</kbd>
geeft de bezoeker zijn eigen tekening terug.</p>
<h3>2. <code>window.wallgraph</code></h3>
<p>Op de gehoste pagina staat een kleine automatiseringslaag op <code>window</code>. Een agent die
<code>page.evaluate</code> kan draaien heeft hier genoeg aan om een plattegrond in te laden, te laten
tekenen en er weer uit te halen.</p>
${api}
<h3>3. De code zelf</h3>
<p>Wallgraph is vrije software (AGPL-3.0) en heeft <b>nul runtime-afhankelijkheden</b>. Een agent die
liever offline werkt haalt de repository op, draait <code>npm run build</code> en houdt één
<code>dist/index.html</code> over die zichzelf compleet is — geen netwerk nodig, ook niet bij het openen.
Zie <a href="${SITE.repo}">de broncode</a> en <a href="/llms.txt">llms.txt</a>.</p>
<div class="note"><p><b>Grenzen, eerlijk gezegd:</b> de editor is een canvas-applicatie, dus een agent die
alleen HTML leest kan er niets in aanwijzen. Werk via het document, niet via de muis. En er is geen
server-API: alles gebeurt in de browser van degene die de pagina open heeft.</p></div>`;
  }
  return `<h2 id="model">The model</h2>
<p>A plan is a <b>planar graph of wall centerlines</b>. What is stored: nodes, walls (centerlines with a
thickness and an optional arc), openings parameterised along their wall, and placed symbols.
<b>Nothing derived is in the file</b>: wall faces, mitred corners, room polygons, areas and dimension
labels are all recomputed when the plan is drawn.</p>
<p>That is why a door cuts its wall for free, and why the file stays small and readable. For anyone
generating one it mostly means: write the graph, not the drawing.</p>
<ul>
<li>Every coordinate and length is a <b>whole number of millimetres</b>. No decimals, no metres.</li>
<li><b>y points down</b>, matching the canvas.</li>
<li><code>bulge</code> is the DXF convention <code>tan(θ/4)</code>: <code>0</code> is straight. It is
required — omitting it does not mean &ldquo;straight&rdquo;, it means the arc maths sees NaN.</li>
<li>An opening sits at <code>t</code> millimetres from node <code>a</code>, measured along the centerline.</li>
</ul>

<h2 id="schema">JSON Schema</h2>
<p>The format is published as JSON Schema (draft 2020-12) at
<a href="${schemaUrl}"><code>/wallgraph.schema.json</code></a>. Every field is described and unknown
fields are rejected — a silently ignored key is exactly the failure you cannot see: the plan loads, the
socket is missing, and nothing said why.</p>

<h2 id="example">A complete example</h2>
<p>One 4 × 3 metre room with a door, a side-hung window and a socket. This is a valid file; paste it into
the editor from the menu, or hand it over in a link.</p>
<pre><code>${example}</code></pre>

<h2 id="agents">For AI agents</h2>
<p>The editor is meant to be driven by an agent as well as by a mouse. There are two ways in, and neither
needs an account or an API key.</p>
<h3>1. A plan in a link</h3>
<p>Put the document's JSON in a <code>base64url</code> string after <code>#plan=</code>. Everything after
the <code>#</code> stays in the browser and never reaches the server, so a plan shared this way is no
more public than the link itself.</p>
<pre><code>${origin}/#plan=&lt;base64url of the JSON document&gt;

# optionally with the language:
${origin}/#plan=&lt;…&gt;&amp;lang=en</code></pre>
<p>The plan replaces what was there, but as an undoable step: <kbd>Ctrl</kbd>+<kbd>Z</kbd> gives the
visitor their own drawing back.</p>
<h3>2. <code>window.wallgraph</code></h3>
<p>The hosted page carries a small automation surface on <code>window</code>. An agent that can run
<code>page.evaluate</code> needs nothing more to load a plan, have it drawn, and read it back.</p>
${api}
<h3>3. The code itself</h3>
<p>Wallgraph is free software (AGPL-3.0) with <b>zero runtime dependencies</b>. An agent that would
rather work offline can clone the repository, run <code>npm run build</code>, and be left with a single
<code>dist/index.html</code> that is complete in itself — no network needed, not even to open it. See
<a href="${SITE.repo}">the source</a> and <a href="/llms.txt">llms.txt</a>.</p>
<div class="note"><p><b>Limits, honestly:</b> the editor is a canvas application, so an agent that only
reads HTML has nothing to point at inside it. Work through the document, not through the mouse. And
there is no server API: everything happens in the browser of whoever has the page open.</p></div>`;
}

/**
 * The liability page.
 *
 * Written plainly on purpose. The AGPL's sections 15 and 16 already disclaim
 * warranty and liability in the usual capitals, and they are what actually
 * carries; this page is so that someone who never opens a licence file still
 * understands what they are holding. The specific claims matter more than the
 * general ones: Wallgraph says "NEN 2580" on its own canvas and draws marks off
 * the NEN sheets, so it has to say out loud where those stop being a claim.
 */
function disclaimerBody(lang: Lang): string {
  const license = `<a href="${SITE.license}">AGPL-3.0</a>`;
  if (lang === "nl") {
    return `<h2 id="geen-garantie">Geen garantie</h2>
<p>Wallgraph wordt geleverd <b>zoals hij is</b> (&ldquo;as is&rdquo;), gratis en zonder enige garantie.
De ${license} waaronder Wallgraph is uitgegeven sluit in de artikelen 15 en 16 uitdrukkelijk elke
garantie en elke aansprakelijkheid uit, en die uitsluiting geldt onverkort. Het hele risico van de
kwaliteit en de werking van het programma ligt bij jou.</p>
<p>Er is geen enkele toezegging dat Wallgraph juist rekent, juist tekent, of blijft werken. Er is
geen ondersteuning, geen serviceniveau en geen garantie dat een fout wordt hersteld.</p>

<h2 id="niet-gecertificeerd">Niet gecertificeerd</h2>
<p>Wallgraph is geen gecertificeerde software. De maker is geen architect, geen constructeur en geen
gecertificeerd meetdeskundige, en treedt in geen enkele vorm op als adviseur.</p>
<p>Een tekening die uit Wallgraph komt is dan ook <b>geen</b>:</p>
<ul>
<li>bouwkundige tekening of bestektekening;</li>
<li>constructieberekening of constructietekening;</li>
<li>meetrapport volgens NEN 2580 — dat mag alleen worden opgesteld door een daartoe gecertificeerd
meetdeskundige, en een oppervlakte die Wallgraph berekent is er geen vervanging van;</li>
<li>installatietekening waarop een installateur mag afgaan;</li>
<li>brandveiligheidsdocument of vluchtplan;</li>
<li>officiële weergave van welke NEN-norm dan ook.</li>
</ul>

<h2 id="wat-de-cijfers-zijn">Wat de getallen wel en niet zijn</h2>
<ul>
<li><b>Oppervlaktes</b> worden berekend <i>volgens de conventie</i> van NEN 2580 (netto, binnenwerks)
of hart-op-hart, en de legenda zegt welke van de twee geldt. Het is een berekening op jouw tekening,
niet op het gebouw. Klopt de tekening niet, dan klopt de oppervlakte niet.</li>
<li><b>Maten</b> zijn exact in de zin dat het document hele millimeters bewaart. Dat zegt iets over
de rekenkunde en niets over de werkelijkheid: een ingetekende muur is precies zo juist als de maat
die jij hebt ingevoerd.</li>
<li><b>Symbolen en kozijnmarkeringen</b> zijn onze interpretatie van de Nederlandse
NEN-tekenconventies. Ze zijn met zorg gemaakt, hebben geen officiële status, en kunnen afwijken van
de actuele norm. De normbladen zelf zijn leidend.</li>
<li><b>Ruimteherkenning</b> werkt op gesloten muurlussen. Een tekening met een gaatje erin levert
een andere ruimte-indeling op dan bedoeld, zonder waarschuwing.</li>
</ul>

<h2 id="controleer-zelf">Controleer het zelf</h2>
<p>Meet elke maat die ertoe doet zelf na, ter plaatse, voordat je erop handelt. Gebruik een
Wallgraph-tekening <b>niet als enige basis</b> voor:</p>
<ul>
<li>een omgevingsvergunning, bouwaanvraag of melding;</li>
<li>een constructieve beslissing of een berekening waar veiligheid aan hangt;</li>
<li>het bestellen, zagen of laten maken van materiaal;</li>
<li>een koop-, huur- of taxatiebeslissing, of een advertentie met een woonoppervlakte erin;</li>
<li>een verzekerings- of schadedossier.</li>
</ul>
<p>Geldende regelgeving — het Besluit bouwwerken leefomgeving, het bestemmingsplan, de van toepassing
zijnde NEN-normen — is altijd leidend. Wallgraph toetst daar niet aan en kent je project niet.</p>

<h2 id="aansprakelijkheid">Aansprakelijkheid</h2>
<p>Voor zover de wet dat toestaat aanvaardt de maker <b>geen enkele aansprakelijkheid</b> voor schade
die voortvloeit uit het gebruik van Wallgraph of uit het gebruik van tekeningen, bestanden,
oppervlaktes of maten die ermee zijn gemaakt. Dat geldt voor directe en indirecte schade, gevolgschade,
gemiste besparingen, bouwkosten, herstelkosten en verlies van gegevens, ook als op de mogelijkheid van
die schade was gewezen.</p>
<p>Gebruik je Wallgraph beroepsmatig, dan blijft je eigen beroepsaansprakelijkheid en je eigen
zorgplicht onverminderd op jou rusten. Een tekengereedschap neemt die niet over.</p>

<h2 id="gegevens">Je tekeningen</h2>
<p>Wallgraph draait volledig in je eigen browser. Er is geen account, er is geen server die je
plattegrond ontvangt, en er wordt niets over je gebruik verzameld of gemeten. Je werk staat in de
opslag van je eigen browser en verdwijnt als je die opslag wist — er is <b>geen back-up</b> en niemand
kan een verloren tekening terughalen. Exporteer wat je niet kwijt wilt.</p>
<p>Deel je een plattegrond via een link, dan zit het document ín de link, achter de <code>#</code>.
Dat deel gaat niet naar de server, maar iedereen die de link heeft, heeft de tekening.</p>

<h2 id="commercieel">Als dit niet volstaat</h2>
<p>Wallgraph is dubbel gelicentieerd: naast de ${license} zijn commerciële voorwaarden mogelijk. Wil
je Wallgraph inzetten in een context waarin je wél afspraken over garantie, ondersteuning of
aansprakelijkheid nodig hebt, mail dan <a href="mailto:${SITE.email}">${SITE.email}</a>. Zulke
afspraken bestaan alleen als ze schriftelijk zijn gemaakt; deze pagina schept ze niet, en een
antwoord op een mail evenmin.</p>`;
  }
  return `<h2 id="no-warranty">No warranty</h2>
<p>Wallgraph is provided <b>as is</b>, free of charge and without any warranty. The ${license} it is
released under disclaims all warranty and all liability in sections 15 and 16, and that disclaimer
applies in full. The entire risk as to the quality and performance of the program is with you.</p>
<p>Nothing here promises that Wallgraph computes correctly, draws correctly, or keeps working. There
is no support, no service level, and no undertaking that a defect will be fixed.</p>

<h2 id="not-certified">Not certified</h2>
<p>Wallgraph is not certified software. Its author is not an architect, a structural engineer or a
certified surveyor, and acts as an adviser in no capacity whatsoever.</p>
<p>A drawing produced by Wallgraph is therefore <b>not</b>:</p>
<ul>
<li>an architectural or tender drawing;</li>
<li>a structural calculation or structural drawing;</li>
<li>a NEN 2580 measurement report — only a certified surveyor may issue one, and an area Wallgraph
computes is no substitute for it;</li>
<li>an installation drawing a fitter may rely on;</li>
<li>a fire-safety document or evacuation plan;</li>
<li>an official rendering of any standard.</li>
</ul>

<h2 id="what-the-numbers-are">What the numbers are and are not</h2>
<ul>
<li><b>Areas</b> are computed <i>following the convention</i> of NEN 2580 (net, inner faces) or
centerline, and the legend states which is in force. It is a calculation on your drawing, not on the
building. If the drawing is wrong, the area is wrong.</li>
<li><b>Dimensions</b> are exact in the sense that the document stores whole millimetres. That is a
statement about the arithmetic and not about reality: a drawn wall is exactly as correct as the
number you typed.</li>
<li><b>Symbols and opening marks</b> are our reading of the Dutch NEN drawing conventions. They are
made with care, they carry no official status, and they may differ from the current standard. The
standard's own sheets govern.</li>
<li><b>Room detection</b> works on closed loops of walls. A drawing with a gap in it yields a
different set of rooms than you intended, with no warning.</li>
</ul>

<h2 id="check-it-yourself">Check it yourself</h2>
<p>Measure every dimension that matters yourself, on site, before acting on it. Do <b>not</b> use a
Wallgraph drawing as the sole basis for:</p>
<ul>
<li>a planning application, building permit or notification;</li>
<li>a structural decision, or any calculation on which safety depends;</li>
<li>ordering, cutting or commissioning material;</li>
<li>a purchase, tenancy or valuation decision, or a listing quoting a floor area;</li>
<li>an insurance or damage claim.</li>
</ul>
<p>Applicable regulation always governs — in the Netherlands the Besluit bouwwerken leefomgeving, the
zoning plan and the relevant NEN standards. Wallgraph checks against none of it and knows nothing
about your project.</p>

<h2 id="liability">Liability</h2>
<p>To the fullest extent permitted by law the author accepts <b>no liability</b> for any damage
arising from the use of Wallgraph, or from the use of drawings, files, areas or dimensions produced
with it. That covers direct and indirect damage, consequential loss, lost savings, construction
costs, remediation costs and loss of data, even where the possibility of such damage was pointed
out.</p>
<p>If you use Wallgraph professionally, your own professional liability and your own duty of care
remain entirely yours. A drawing tool does not assume them.</p>

<h2 id="your-drawings">Your drawings</h2>
<p>Wallgraph runs entirely in your own browser. There is no account, no server receives your plan,
and nothing about your use is collected or measured. Your work lives in your own browser's storage
and disappears when that storage is cleared — there is <b>no backup</b> and nobody can recover a lost
drawing. Export anything you would mind losing.</p>
<p>If you share a plan as a link, the document is <i>in</i> the link, after the <code>#</code>. That
part never reaches the server, but anyone holding the link holds the drawing.</p>

<h2 id="commercial">If this is not enough</h2>
<p>Wallgraph is dual-licensed: alongside the ${license}, commercial terms are available. If you need
to use it in a setting where you do require undertakings about warranty, support or liability, write
to <a href="mailto:${SITE.email}">${SITE.email}</a>. Such undertakings exist only where they have been
made in writing; this page creates none, and neither does a reply to an email.</p>`;
}

const BODIES: Record<DocId, (lang: Lang, ctx: SiteCtx) => string> = {
  symbols: symbolsBody,
  openings: openingsBody,
  manual: manualBody,
  format: formatBody,
  disclaimer: disclaimerBody,
};

/** Every docs page, as `path -> html`. Paths are site-root-relative. */
export function docPages(ctx: SiteCtx): Map<string, string> {
  const out = new Map<string, string>();
  for (const lang of ["nl", "en"] as Lang[]) {
    // The generator reads symbol and opening names through the app's own `t`,
    // so the language has to actually be switched rather than passed around.
    changeLanguage(lang);
    for (const id of Object.keys(BODIES) as DocId[]) {
      const page = DOCS[id][lang];
      out.set(page.path, shell(ctx, lang, page, BODIES[id](lang, ctx)));
    }
  }
  return out;
}
