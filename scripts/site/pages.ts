// Generated documentation pages. Symbol and opening illustrations use the same
// drawing functions as the editor and exporters.
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

/** Stroke weights in mm, matching the SVG exporter. */
const W_SYMBOL = 16;
const W_WALL = 12;

/** Shared sample wall and minimum vertical extent for opening illustrations. */
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

/** Bounds recorded geometry; arc bounds use the full circle. */
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

/** Render one untransformed symbol with its declared footprint. */
function symbolSvg(def: SymbolDef, label: string): string {
  const prims = recordSymbol(def, 0, 0, 0, false);
  // Include the declared footprint because some marks do not fill their bounds.
  let b = boundsOf(prims);
  const halfW = def.width / 2;
  b = grow(b, -halfW, def.wallMounted ? 0 : -def.depth / 2);
  b = grow(b, halfW, def.wallMounted ? def.depth : def.depth / 2);
  return `<svg ${frame(b, W_SYMBOL, 72, 150)} fill="none" stroke="currentColor"` +
    ` stroke-width="${W_SYMBOL}" stroke-linecap="round" stroke-linejoin="round"` +
    ` role="img" aria-label="${esc(label)}">${prims.map(primSvg).join("")}</svg>`;
}

/** Render an opening through the production resolution and marking pipeline. */
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
  // Use a shared frame for comparable scale, widened when a mark exceeds it.
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

/* Page bodies. */

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
      `het <a href="/formaat/">documentformaat</a> beschrijft programmatische invoer.</p>`
    : `<p>The <code>type</code> under each symbol is what goes in the document file — ` +
      `the <a href="/en/format/">document format</a> describes programmatic input.</p>`;
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
<li>De scharnierzijde heet <code>a</code> of <code>b</code> op basis van de muurrichting en blijft geldig wanneer de muur opnieuw wordt getekend.</li>
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
<p><kbd>W</kbd> activeert het muurgereedschap. Een klik plaatst het beginpunt; volgende klikken vormen
een keten. Tijdens het tekenen kan een lengte in millimeters worden getypt. <kbd>Enter</kbd> legt het
segment op die lengte vast in de gekozen richting. <kbd>Esc</kbd> sluit de keten af.</p>
<ul>
<li><kbd>O</kbd> zet hoeksnapping (90°/45°) aan en uit.</li>
<li><kbd>G</kbd> zet rastersnapping aan en uit. Uit blijft nog steeds op hele millimeters afronden.</li>
<li>Aansluiting op een bestaande muur splitst die muur en vormt een T-knoop.</li>
</ul>

<h2 id="selecteren">Selecteren, verplaatsen, krommen</h2>
<p><kbd>V</kbd> activeert het selectiegereedschap voor knopen, muren en symbolen. Een geselecteerde muur
krijgt een ruitvormige greep op het midden; verslepen buigt de muur tot een cirkelboog. De pijlhoogte in millimeters
staat daarna in het paneel, net als de dikte en de lengte. Lengte aanpassen verschuift het verre
uiteinde langs de muurrichting.</p>

<h2 id="openingen">Deuren, ramen en doorgangen</h2>
<p><kbd>D</kbd>, <kbd>N</kbd> en <kbd>P</kbd> plaatsen respectievelijk een deur, raam en doorgang op een
muur. Tijdens het plaatsen worden de afstanden tot beide muuruiteinden weergegeven. Richting, breedte
en type zijn vervolgens instelbaar in het paneel; alle typen staan op
<a href="/kozijnen/">deur- en raamtypen</a>.</p>
<p>Een opening blijft aan de bijbehorende muur gekoppeld en verplaatst met die muur mee.</p>

<h2 id="symbolen">Symbolen</h2>
<p><kbd>S</kbd> opent het symboolgereedschap. Zoeken in het palet werkt in beide talen; de zoekterm
&ldquo;socket&rdquo; vindt bijvoorbeeld de wandcontactdoos in de Nederlandse interface. Symbolen die aan
een muur horen klikken vlak tegen het muurvlak en draaien mee. <kbd>R</kbd> roteert, <kbd>M</kbd>
spiegelt. Kleur is betekenis, geen opmaak: zwart is bestaand, rood is nieuw, geel verdwijnt.
Alle 77 staan op <a href="/symbolen/">plattegrondsymbolen</a>.</p>

<h2 id="trappen">Trappen</h2>
<p><kbd>T</kbd> opent het trapgereedschap met de vijftien traptypen van het symbolenblad: steektrap,
bordestrap, trappen met onder- of bovenkwart, spiltrap, wenteltrap, roltrap, vlizotrap, klimijzers en
hellingbaan. Een trap is geen symbool: breedte, aantrede en het aantal treden staan in het document,
zodat dezelfde steektrap in een woning 900 mm breed is en in een bedrijfsunit 1200 mm. Het
hoogteverschil komt van de verdieping: een trap volgt de verdiepingshoogte uit het Plan-paneel tenzij
er een eigen hoogte is ingevuld, wat een trap naar een entresol naast een vide nodig heeft. Een trap
van 15 treden heeft 16 optreden, dus 2800 mm geeft een optrede van 175 en een loopvergelijking van 570.
De treden, de looplijn, de pijl en de plaats van de breuklijn volgen daaruit. Het paneel zet de uitkomst
naast de invoer en meldt in rood waar een maat buiten het gebruikelijke valt; Wallgraph toetst geen
regelgeving. <kbd>R</kbd> draait een kwartslag en <kbd>M</kbd> spiegelt,
ook vóór het plaatsen. De pijl wijst altijd van beneden naar boven; een trap die naar beneden gaat is
dezelfde trap, omgedraaid.</p>

<h2 id="ruimtes">Ruimtes en maten</h2>
<p>Gesloten muurlussen worden automatisch als ruimte herkend en van een oppervlakte voorzien. De maat is
standaard <b>netto</b> (binnenwerks, NEN 2580); de legenda op het canvas zegt welke conventie geldt en
in het Plan-paneel kan hart-op-hart worden gekozen. <kbd>L</kbd> zet maatlijnen op alle muren aan en uit;
selectie van een maatlabel maakt invoer van de lengte mogelijk.</p>

<h2 id="exporteren">Opslaan en exporteren</h2>
<ul>
<li><b>PNG</b> — de plattegrond als afbeelding, op de tekening bijgesneden, zonder raster, met schaalbalk.</li>
<li><b>SVG</b> — vectorwerk op ware schaal: 1 mm in het document is 1 mm op papier bij 100% afdrukken.</li>
<li><b>DXF</b> — muren, draaicirkels, symbolen, trappen en oppervlaktes op aparte lagen, in millimeters, voor CAD.</li>
<li><b>JSON</b> — het document zelf; zie <a href="/formaat/">documentformaat</a>.</li>
</ul>
<p>De plattegrond wordt automatisch in de lokale browseropslag bewaard. Hiervoor is geen account of
applicatieserver vereist. De plattegrond blijft na het sluiten van het tabblad beschikbaar.</p>

<h2 id="sneltoetsen">Sneltoetsen</h2>
<table><thead><tr><th>Toets</th><th>Doet</th></tr></thead><tbody>
<tr><td><kbd>V</kbd></td><td>selecteren en verplaatsen</td></tr>
<tr><td><kbd>W</kbd></td><td>muren tekenen</td></tr>
<tr><td><kbd>D</kbd> <kbd>N</kbd> <kbd>P</kbd></td><td>deur, raam, doorgang</td></tr>
<tr><td><kbd>S</kbd></td><td>symbool plaatsen</td></tr>
<tr><td><kbd>T</kbd></td><td>trap plaatsen</td></tr>
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
<p class="note"><a href="${editor}">Editor openen</a>. <kbd>Ctrl</kbd>+<kbd>Z</kbd> maakt de laatste
documentwijziging ongedaan.</p>`;
  }
  return `<h2 id="walls">Drawing walls</h2>
<p><kbd>W</kbd> activates the wall tool. The first click places a start point; subsequent clicks form a
chain. A length in millimetres can be typed while drawing. <kbd>Enter</kbd> commits the segment at that
length in the selected direction. <kbd>Esc</kbd> ends the chain.</p>
<ul>
<li><kbd>O</kbd> toggles angle snapping (90°/45°).</li>
<li><kbd>G</kbd> toggles grid snapping. Off still rounds to whole millimetres.</li>
<li>Connecting to an existing wall splits that wall and creates a T-junction.</li>
</ul>

<h2 id="select">Selecting, moving, curving</h2>
<p><kbd>V</kbd> activates selection and dragging for nodes, walls and symbols. A selected wall displays
a diamond handle at its midpoint; dragging it forms a circular arc. The sagitta in millimetres is editable in the
panel, alongside thickness and length. Editing the length moves the far node along the wall direction.</p>

<h2 id="openings">Doors, windows and passages</h2>
<p><kbd>D</kbd>, <kbd>N</kbd> and <kbd>P</kbd> place a door, window and passage respectively on a wall.
During placement, dimensions to both wall ends are displayed. Direction, width and type are then
configured in the panel; all options appear on <a href="/en/openings/">door and window types</a>.</p>
<p>An opening remains associated with its wall and moves when that wall moves.</p>

<h2 id="symbols">Symbols</h2>
<p><kbd>S</kbd> opens the symbol tool. Palette search matches both languages; for example,
&ldquo;wandcontactdoos&rdquo; finds the socket in the English interface. Wall-mounted symbols
snap to the wall face and align with it. <kbd>R</kbd> rotates and <kbd>M</kbd> mirrors. Colour indicates
status: black is existing, red is new work and yellow is to be removed. All 77 are listed under
<a href="/en/symbols/">floorplan symbols</a>.</p>

<h2 id="stairs">Stairs</h2>
<p><kbd>T</kbd> opens the stair tool with the fifteen types from the plan-symbol sheet: straight
flight, stair with a landing, quarter turns at the foot or the top, spiral and helical stairs, an
escalator, a loft ladder, climbing irons and a ramp. A stair is not a symbol: its width, going and
tread count are stored in the document, so the same flight is 900 mm wide in a house and 1200 in a
unit. The rise comes from the storey: a stair follows the storey height set in the Plan panel unless it
states one of its own, which a flight up to a mezzanine beside a void needs. A flight of 15 treads has
16 risers, so a 2800 mm storey gives a 175 riser and a walking rule of 570. The treads, the walking
line, the arrow and where the break line falls all follow from that. The panel puts the results beside
the inputs and states in red where a figure falls outside the ordinary; Wallgraph does not check
regulations. <kbd>R</kbd> turns a
quarter and <kbd>M</kbd> mirrors, before placing as well as after. The arrow always points from the
bottom of the flight to the top; a stair going down is the same stair, turned around.</p>

<h2 id="rooms">Rooms and dimensions</h2>
<p>Closed wall loops are detected as rooms and labelled with their area. That area is <b>net</b> by
default (inner faces, NEN 2580); the canvas legend states which convention is in force, and the
Plan panel can select centerline measurement. <kbd>L</kbd> toggles dimension lines on every wall;
selecting a dimension label enables length input.</p>

<h2 id="export">Saving and exporting</h2>
<ul>
<li><b>PNG</b> — the plan as an image, cropped to the drawing, no grid, with a scale bar.</li>
<li><b>SVG</b> — vector artwork at true scale: 1 mm in the document is 1 mm on paper printed at 100%.</li>
<li><b>DXF</b> — walls, swings, symbols, stairs and areas on separate layers, in millimetres, for CAD.</li>
<li><b>JSON</b> — the document itself; see <a href="/en/format/">document format</a>.</li>
</ul>
<p>The plan is saved automatically in local browser storage. This requires no account or application
server. The plan remains available after the tab is closed.</p>

<h2 id="shortcuts">Keyboard shortcuts</h2>
<table><thead><tr><th>Key</th><th>Does</th></tr></thead><tbody>
<tr><td><kbd>V</kbd></td><td>select and move</td></tr>
<tr><td><kbd>W</kbd></td><td>draw walls</td></tr>
<tr><td><kbd>D</kbd> <kbd>N</kbd> <kbd>P</kbd></td><td>door, window, passage</td></tr>
<tr><td><kbd>S</kbd></td><td>place a symbol</td></tr>
<tr><td><kbd>T</kbd></td><td>place a stair</td></tr>
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
<p class="note"><a href="${editor}">Open the editor</a>. <kbd>Ctrl</kbd>+<kbd>Z</kbd> reverses the last
document change.</p>`;
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
<p>Een plattegrond is een <b>vlak netwerk van muurhartlijnen</b>: knopen, met muren als verbindingen
daartussen. Opgeslagen worden die knopen, de muren (hartlijnen met een dikte en eventueel een boog),
openingen die op hun muur geparametriseerd zijn, geplaatste symbolen en trappen. <b>Niets afgeleids staat in
het bestand</b>: muurvlakken, verstekken, ruimtepolygonen, oppervlaktes en maatlijnen worden bij het
tekenen opnieuw berekend.</p>
<p>Hierdoor kan een opening uit de bijbehorende muur worden afgeleid en blijft het bestand compact.
Een generator hoeft alleen het netwerk te schrijven.</p>
<ul>
<li>Alle coördinaten en maten zijn <b>hele millimeters</b>. Geen komma's, geen meters.</li>
<li><b>y wijst naar beneden</b>, net als op het canvas.</li>
<li><code>bulge</code> is de DXF-conventie <code>tan(θ/4)</code>: <code>0</code> is recht. Hij is
verplicht — weglaten betekent niet &ldquo;recht&rdquo;, het betekent dat de boogberekening NaN ziet.</li>
<li>Een opening zit op <code>t</code> millimeter vanaf knoop <code>a</code>, gemeten over de hartlijn.</li>
<li>Een trap draagt zijn eigen maten — <code>width</code>, <code>going</code>, <code>treads</code> en
<code>rise</code> — omdat dezelfde trapsoort per plattegrond anders uitvalt. De treden zelf staan er
niet in. Een trap met <code>n</code> treden heeft <code>n+1</code> optreden, dus de optrede en de
loopvergelijking volgen uit <code>rise</code>, net als de trede waar het snijvlak valt.</li>
</ul>

<h2 id="schema">JSON Schema</h2>
<p>Het formaat staat als JSON Schema (draft 2020-12) op
<a href="${schemaUrl}"><code>/wallgraph.schema.json</code></a>. Elk veld is beschreven en onbekende
velden worden afgekeurd. Zo leidt een onjuiste sleutel tot een validatiefout in plaats van ontbrekende
inhoud in een geladen plattegrond.</p>

<h2 id="voorbeeld">Een compleet voorbeeld</h2>
<p>Eén kamer van 4 × 3 meter met een deur, een draairaam en een stopcontact. Dit is een geldig bestand;
plak het in de editor via het menu, of laad het via een link.</p>
<pre><code>${example}</code></pre>

<h2 id="agents">Voor AI-agents</h2>
<p>De editor biedt twee client-side automatiseringskanalen. Geen van beide vereist een account of API-sleutel.</p>
<h3>1. Een plattegrond in een link</h3>
<p>Het document kan als JSON in een <code>base64url</code>-string achter <code>#plan=</code> worden geplaatst.
De URL-fragmentwaarde wordt niet in een HTTP-verzoek naar de server opgenomen. Iedereen met de link
kan de ingesloten plattegrond openen.</p>
<pre><code>${origin}/#plan=&lt;base64url van het JSON-document&gt;

# en optioneel de taal erbij:
${origin}/#plan=&lt;…&gt;&amp;lang=en</code></pre>
<p>Het laden vervangt de huidige plattegrond en wordt als ongedaan te maken documentstap geregistreerd.</p>
<h3>2. <code>window.wallgraph</code></h3>
<p>De gehoste pagina biedt een automatiseringsinterface op <code>window</code>. De methoden kunnen via
<code>page.evaluate</code> worden aangeroepen om een plattegrond te laden, tekenen en uitlezen.</p>
${api}
<h3>3. De code zelf</h3>
<p>Wallgraph is vrije software (AGPL-3.0) en heeft <b>nul runtime-afhankelijkheden</b>.
<code>npm run build</code> produceert één zelfstandige <code>dist/index.html</code> die zonder netwerk
kan worden geopend. Zie <a href="${SITE.repo}">de broncode</a> en <a href="/llms.txt">llms.txt</a>.</p>
<div class="note"><p><b>Automatiseringsgrenzen:</b> de canvasinhoud is niet beschikbaar als interactieve
DOM-elementen. Automatisering gebruikt daarom het documentformaat, plan-links of
<code>window.wallgraph</code>. Er is geen server-API; verwerking vindt plaats in de browser.</p></div>`;
  }
  return `<h2 id="model">The model</h2>
<p>A plan is a <b>planar graph of wall centerlines</b>. What is stored: nodes, walls (centerlines with a
thickness and an optional arc), openings parameterised along their wall, placed symbols, and stairs.
<b>Nothing derived is in the file</b>: wall faces, mitred corners, room polygons, areas and dimension
labels are all recomputed when the plan is drawn.</p>
<p>This allows openings to be derived from their walls while keeping the file compact. A generator
only needs to write the graph.</p>
<ul>
<li>Every coordinate and length is a <b>whole number of millimetres</b>. No decimals, no metres.</li>
<li><b>y points down</b>, matching the canvas.</li>
<li><code>bulge</code> is the DXF convention <code>tan(θ/4)</code>: <code>0</code> is straight. It is
required — omitting it does not mean &ldquo;straight&rdquo;, it means the arc maths sees NaN.</li>
<li>An opening sits at <code>t</code> millimetres from node <code>a</code>, measured along the centerline.</li>
<li>A stair carries its own dimensions — <code>width</code>, <code>going</code>, <code>treads</code> and
<code>rise</code> — because the same kind is built to a different size in every plan. The treads
themselves are not stored. A flight of <code>n</code> treads has <code>n+1</code> risers, so the riser
height, the walking rule and the tread the section plane cuts all follow from <code>rise</code>.</li>
</ul>

<h2 id="schema">JSON Schema</h2>
<p>The format is published as JSON Schema (draft 2020-12) at
<a href="${schemaUrl}"><code>/wallgraph.schema.json</code></a>. Every field is described and unknown
fields are rejected. An incorrect key therefore produces a validation error instead of missing content
in a loaded plan.</p>

<h2 id="example">A complete example</h2>
<p>One 4 × 3 metre room with a door, a side-hung window and a socket. The valid document can be loaded
through the editor menu or a plan link.</p>
<pre><code>${example}</code></pre>

<h2 id="agents">For AI agents</h2>
<p>The editor provides two client-side automation channels. Neither requires an account or API key.</p>
<h3>1. A plan in a link</h3>
<p>The document JSON can be placed in a <code>base64url</code> string after <code>#plan=</code>. URL fragment
values are not included in HTTP requests to the server. Anyone with the link can open the embedded plan.</p>
<pre><code>${origin}/#plan=&lt;base64url of the JSON document&gt;

# optionally with the language:
${origin}/#plan=&lt;…&gt;&amp;lang=en</code></pre>
<p>Loading replaces the current plan and is recorded as an undoable document step.</p>
<h3>2. <code>window.wallgraph</code></h3>
<p>The hosted page provides an automation interface on <code>window</code>. Its methods can be called
through <code>page.evaluate</code> to load, render and read a plan.</p>
${api}
<h3>3. The code itself</h3>
<p>Wallgraph is free software (AGPL-3.0) with <b>zero runtime dependencies</b>.
<code>npm run build</code> produces a self-contained <code>dist/index.html</code> that opens without a network. See
<a href="${SITE.repo}">the source</a> and <a href="/llms.txt">llms.txt</a>.</p>
<div class="note"><p><b>Automation limits:</b> canvas content is not available as interactive DOM
elements. Automation therefore uses the document format, plan links or <code>window.wallgraph</code>.
There is no server API; processing occurs in the browser.</p></div>`;
}

/** Legal and operational limitations, without promotional content. */
function disclaimerBody(lang: Lang): string {
  const license = `<a href="${SITE.license}">AGPL-3.0</a>`;
  const mail = `<a href="mailto:${SITE.email}">${SITE.email}</a>`;
  if (lang === "nl") {
    return `<h2 id="geen-garantie">Geen garantie</h2>
<p>Wallgraph is vrije software en wordt geleverd <b>zoals beschikbaar</b>. De artikelen 15 en 16 van
de ${license} bevatten een uitsluiting van garantie en een beperking van aansprakelijkheid, voor
zover het toepasselijke recht dit toestaat. Er wordt niet gegarandeerd dat Wallgraph foutloos rekent
of tekent, ononderbroken beschikbaar blijft, wordt ondersteund of wordt hersteld.</p>

<h2 id="wat-het-niet-doet">Wat Wallgraph niet doet</h2>
<ul>
<li>Wallgraph meet geen gebouw. De software verwerkt uitsluitend ingevoerde maten.</li>
<li>Wallgraph toetst niet aan het Besluit bouwwerken leefomgeving, omgevingsplannen, NEN-normen of
andere projectspecifieke eisen.</li>
<li>Wallgraph controleert niet of een tekening juist, volledig of geschikt voor een bepaald doel is.</li>
<li>Oppervlaktes worden berekend op basis van de tekening, volgens de gekozen rekenwijze. Deze
berekening is geen meting van het gebouw.</li>
<li>Gebruik van Wallgraph verleent een tekening geen certificering, goedkeuring of officiële status.</li>
</ul>

<h2 id="verantwoordelijkheid">Verantwoordelijkheid</h2>
<p>De gebruiker is verantwoordelijk voor de ingevoerde gegevens, de inhoud van de tekening, de
controle daarvan en de keuze om de tekening voor een bepaald doel te gebruiken. Professioneel
gebruik verandert de toepasselijke zorgplicht of beroepsaansprakelijkheid van de gebruiker niet.</p>

<h2 id="professional">Professionele controle</h2>
<ul>
<li>Wallgraph levert geen gecertificeerd NEN 2580-meetrapport. Eisen aan meting, certificering en
acceptatie hangen af van het doel en de ontvangende partij.</li>
<li>Wallgraph voert geen constructieve berekeningen uit.</li>
<li>Wallgraph beoordeelt geen brandveiligheid of installatieontwerp.</li>
<li>Werkzaamheden waarbij veiligheid, regelgeving, certificering of vertrouwen van derden een rol
speelt, vereisen controle door een daarvoor gekwalificeerde deskundige.</li>
</ul>
<p>Eisen voor een vergunningaanvraag volgen uit de toepasselijke regelgeving en de eisen van het
bevoegde gezag. Wallgraph controleert deze eisen niet.</p>

<h2 id="aansprakelijkheid">Aansprakelijkheid</h2>
<p>Voor zover de wet dat toestaat aanvaardt de maker <b>geen enkele aansprakelijkheid</b> voor schade
die voortvloeit uit het gebruik van Wallgraph of uit het gebruik van tekeningen, bestanden,
oppervlaktes of maten die ermee zijn gemaakt. Dat geldt voor directe en indirecte schade,
gevolgschade, gemiste besparingen, bouwkosten, herstelkosten en verlies van gegevens, ook als op de
mogelijkheid van die schade was gewezen.</p>

<h2 id="gegevens">Gegevens en opslag</h2>
<p>De applicatie verwerkt plattegronden in de browser en bevat geen telemetrie die de inhoud van een
plattegrond verzendt. Plattegronden worden lokaal in de browser opgeslagen; Wallgraph biedt geen
back-up- of hersteldienst. De hostingprovider kan technische verzoekgegevens verwerken.</p>
<p>Bij delen via een link staat het document in het URL-fragment na <code>#</code>. Dit fragment wordt
niet in het HTTP-verzoek aan de server opgenomen. Iedereen met toegang tot de volledige link kan het
document lezen.</p>

<h2 id="commercieel">Andere voorwaarden</h2>
<p>Wallgraph is dubbel gelicentieerd. Naast de ${license} zijn commerciële voorwaarden beschikbaar
via ${mail}. Aanvullende afspraken over garantie, ondersteuning of aansprakelijkheid gelden alleen
wanneer zij uitdrukkelijk schriftelijk zijn vastgelegd.</p>`;
  }
  return `<h2 id="no-warranty">No warranty</h2>
<p>Wallgraph is free software and is provided <b>as available</b>. Sections 15 and 16 of the ${license}
contain a disclaimer of warranty and a limitation of liability, to the extent permitted by
applicable law. Wallgraph is not guaranteed to calculate or draw without error, remain continuously
available, receive support or be corrected.</p>

<h2 id="what-it-does-not">What Wallgraph does not do</h2>
<ul>
<li>Wallgraph does not measure a building. It processes only dimensions entered by the user.</li>
<li>Wallgraph does not verify compliance with building regulations, zoning rules, NEN standards or
other project-specific requirements.</li>
<li>Wallgraph does not determine whether a drawing is accurate, complete or suitable for a particular
purpose.</li>
<li>Areas are calculated from the drawing using the selected calculation method. This is not a
measurement of the building.</li>
<li>Use of Wallgraph does not confer certification, approval or official status on a drawing.</li>
</ul>

<h2 id="responsibility">Responsibility</h2>
<p>The user is responsible for the entered data, the content of the drawing, its verification and the
decision to use it for a particular purpose. Professional use does not alter the user's applicable
duty of care or professional liability.</p>

<h2 id="professional">Professional verification</h2>
<ul>
<li>Wallgraph does not produce a certified NEN 2580 measurement report. Measurement, certification
and acceptance requirements depend on the purpose and the receiving party.</li>
<li>Wallgraph does not perform structural calculations.</li>
<li>Wallgraph does not assess fire safety or services design.</li>
<li>Work involving safety, regulation, certification or third-party reliance requires verification
by an appropriately qualified professional.</li>
</ul>
<p>Permit-application requirements follow from applicable regulation and the requirements of the
competent authority. Wallgraph does not verify those requirements.</p>

<h2 id="liability">Liability</h2>
<p>To the fullest extent permitted by law the author accepts <b>no liability</b> for any damage
arising from the use of Wallgraph, or from the use of drawings, files, areas or dimensions produced
with it. That covers direct and indirect damage, consequential loss, lost savings, construction
costs, remediation costs and loss of data, even where the possibility of such damage was pointed
out.</p>

<h2 id="data-storage">Data and storage</h2>
<p>The application processes floorplans in the browser and contains no telemetry that transmits plan
contents. Plans are stored locally in browser storage; Wallgraph provides no backup or recovery
service. The hosting provider may process technical request data.</p>
<p>When a plan is shared by link, the document is stored in the URL fragment after <code>#</code>. The
fragment is not included in the HTTP request to the server. Anyone with access to the complete link
can read the document.</p>

<h2 id="other-terms">Other terms</h2>
<p>Wallgraph is dual-licensed. Commercial terms are available alongside the ${license} through
${mail}. Additional terms concerning warranty, support or liability apply only when expressly
agreed in writing.</p>`;
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
    // Symbol and opening names use the active application translation dictionary.
    changeLanguage(lang);
    for (const id of Object.keys(BODIES) as DocId[]) {
      const page = DOCS[id][lang];
      out.set(page.path, shell(ctx, lang, page, BODIES[id](lang, ctx)));
    }
  }
  return out;
}
