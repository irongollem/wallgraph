// Generated documentation pages. Symbol and opening illustrations use the same
// drawing functions as the editor and exporters.
import { SYMBOLS, CATEGORIES, type SymbolCategory } from "../../src/render/symbols";
import {
  FURNISHING_GROUPS, FURNISHING_PRESETS, furnishingWallMounted, writeSpec,
  type Furnishing, type FurnishingPreset,
} from "../../src/model/furnishing";
import { furnishingMark } from "../../src/render/furnishing";
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
/** What symbolSvg needs: a footprint and a drawing. A SymbolDef has both, and
 *  so does a furnishing preset once it is drawn at its own size. */
interface Drawable {
  width: number;
  depth: number;
  wallMounted: boolean;
  draw(ctx: CanvasRenderingContext2D): void;
}

function symbolSvg(def: Drawable, label: string): string {
  const prims = recordSymbol(def, 0, 0, 0, false);
  // Include the declared footprint because some marks do not fill their bounds.
  let b = boundsOf(prims);
  const halfW = def.width / 2;
  b = grow(b, -halfW, def.wallMounted ? 0 : -def.depth / 2);
  b = grow(b, halfW, def.wallMounted ? def.depth : def.depth / 2);
  return `<svg ${frame(b, W_SYMBOL, 72, 150)} fill="none" stroke="currentColor"` +
    ` stroke-width="${W_SYMBOL}" stroke-linecap="round" stroke-linejoin="round"` +
    ` role="img" aria-label="${esc(label)}">${prims.map(p => primSvg(p)).join("")}</svg>`;
}

/** A named fit-out piece, drawn at the size it is placed at. */
function drawablePreset(preset: FurnishingPreset): Drawable {
  const { id: _id, group: _group, ...spec } = preset;
  const piece: Furnishing = {
    id: "", form: spec.form, x: 0, y: 0, rotation: 0,
    width: spec.width, depth: spec.depth,
  };
  writeSpec(piece, spec);
  return {
    width: piece.width,
    depth: piece.depth,
    wallMounted: furnishingWallMounted(piece.form),
    draw: ctx => furnishingMark(ctx, piece),
  };
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
    solids.map(p => primSvg(p)).join("") + `</g>` +
    `<g fill="none" stroke="currentColor" stroke-width="${W_WALL}" stroke-linecap="round">` +
    marks.map(p => primSvg(p)).join("") + `</g></svg>`;
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
  // The fit-out is not in the symbol registry: every piece here is built to a
  // size and stored with it, so what the catalogue shows is the named piece at
  // the size it is placed at. See model/furnishing.ts.
  out.push(`<h2 id="inrichting">${lang === "nl" ? "Inrichting" : "Fit-out"}</h2>`);
  out.push(lang === "nl"
    ? `<p>Deze zijn geen symbolen maar objecten met een maat: breedte, diepte en hoogte staan in het ` +
      `document en de tekening volgt daaruit. De maat hieronder is waarmee het element geplaatst wordt.</p>`
    : `<p>These are not symbols but objects with a size: width, depth and height live in the document ` +
      `and the drawing follows from them. The size below is the one the piece is placed at.</p>`);
  for (const g of FURNISHING_GROUPS) {
    const presets = FURNISHING_PRESETS.filter(x => x.group === g);
    out.push(`<h3 id="${g}">${esc(t("furnishingGroup." + g))} <small>(${presets.length})</small></h3>`);
    out.push(`<ul class="grid">`);
    for (const preset of presets) {
      const name = t("furnishing." + preset.id);
      out.push(
        `<li class="tile"><figure>${symbolSvg(drawablePreset(preset), name)}</figure>` +
        `<b>${esc(name)}</b>` +
        `<small><code>${esc(preset.form)}</code><br>${preset.width}×${preset.depth} mm ${dims}<br>` +
        `${furnishingWallMounted(preset.form) ? wall : free}</small></li>`,
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
<p><kbd>W</kbd> activeert het muurgereedschap; nogmaals <kbd>W</kbd> loopt door de vier vormen waarin
het tekent: lijn, rechthoek, cirkel en veelhoek. Diezelfde keuze staat in het paneel, samen met de dikte
waarmee de volgende muur wordt getekend.</p>
<p>Met de lijn plaatst een klik het beginpunt en vormen volgende klikken een keten. Tijdens het tekenen
kan een lengte in millimeters worden getypt. <kbd>Enter</kbd> legt het segment op die lengte vast in de
gekozen richting; zonder getypte lengte sluit <kbd>Enter</kbd> de keten terug op het beginpunt.
<kbd>Esc</kbd> sluit de keten af.</p>
<p>De andere drie vormen nemen twee punten: hoek en tegenoverliggende hoek voor de rechthoek,
middelpunt en straal voor de cirkel en de veelhoek. Klikken of slepen, beide werken. <kbd>Shift</kbd>
houdt de rechthoek vierkant, en op een aanraakscherm doet de schakelaar Vierkant hetzelfde. Wat blijft
staan zijn gewone muren — de cirkel is vier kwartbogen — die daarna te verplaatsen en te buigen zijn
en openingen kunnen dragen.</p>
<ul>
<li><kbd>O</kbd> zet hoeksnapping (90°/45°) aan en uit. <kbd>Shift</kbd> houdt de hoek vast zolang die
ingedrukt blijft, ook als hoeksnapping uit staat.</li>
<li>Een muur onder hoeksnapping eindigt op de muur waar hij op gericht wordt: kruist de vastgezette
richting een muur vlak bij de cursor, dan valt het eindpunt op dat snijpunt en wordt die muur gesplitst.</li>
<li><kbd>G</kbd> zet rastersnapping aan en uit. Uit blijft nog steeds op hele millimeters afronden.</li>
<li>Een nieuwe muur splitst elke muur die hij kruist, en zichzelf op elke knoop waar hij doorheen loopt.</li>
<li>Een stuk dat al door een muur op dezelfde lijn wordt gedragen, wordt niet nog eens getekend: twee
rechthoeken naast elkaar delen één muur in plaats van er twee op elkaar te leggen. Die muur houdt
de dikte die hij had.</li>
</ul>

<p>Naast de dikte staat in het paneel wat de muur is en waarin hij wordt getekend. Het materiaal is
metselwerk, beton, hout, staal, glas of sandwichpaneel; niet opgegeven is een aparte staat en geen
aanname. Glas en sandwichpaneel zijn invulling en veranderen de tekening: het muurlichaam krijgt geen
arcering maar een lichte band tussen zijn twee vlakken. Kleur is ook hier betekenis en geen opmaak —
zwart is bestaand, rood te bouwen, geel te slopen — en vult het muurvlak, zoals op een verbouwtekening.
Die keuzes blijven staan voor de volgende muur, net als de dikte.</p>
<p>Elke muur kan stijlen dragen: het raamwerk waarop het muurlichaam rust. Dat is één begrip voor wat in
plattegrond één ding is — de stijlen van een pui, de kolommen van een stalen spant met sandwichpanelen,
de regels van een houten wand. De stijlafstand geldt hart-op-hart als maximale vakbreedte: elk vlak
tussen de sparingen wordt in gelijke vakken verdeeld die niet breder zijn dan de opgegeven maat. Een
deur verschuift daarmee de stijlen van zijn eigen vlak in plaats van er een in de doorgang te laten
vallen; de deurstijlen zijn dan de stijlen, zoals in een echte pui.</p>
<p>De stijlbreedte is los op te geven. Zonder breedte staat een stijl als lijn — de hart-op-hart-maat is
bekend, het profiel nog niet. Mét breedte is het een echt staafje op de maat waarop het wordt gebouwd;
de diepte is de muurdikte zelf. Een stijl wordt nooit breder getekend dan zijn eigen vak. Een muur met
stijlen gaat als <code>ELEMENTEDWALL</code> naar IFC: samengesteld uit onderdelen. Draagt het spant en de
beplating niet, dan is de muur zelf dragend — dat is wat <code>loadBearing</code> over het bouwdeel
zegt; de kolommen worden niet apart gemodelleerd.</p>

<p>Los daarvan staat de gevelbekleding: een schil <em>buiten</em> het constructieve muurlichaam.
<code>thickness</code> blijft de constructie, dus een sandwichwand van 100 + 100 is dikte 100 met
geveldikte 100. Die schil ligt geheel buiten de constructieve vlakken en verandert dus niets aan de
muurgraaf, de ruimtedetectie of het netto oppervlak — hij wordt getekend als een witte band met een
dunne omtrek, zoals op een bouwtekening. Twee beklede muren versnijden hun schil in een hoek; een
onbeklede muur die erop uitkomt laat de schil doorlopen. Wat de gevel wél bepaalt is het bruto
oppervlak: bij oppervlaktemaat <b>bruto (BVO)</b> wordt gemeten tot de buitenkant van de gevel waar een
begrenzende muur er een heeft, en tot de hartlijn waar dat niet zo is — precies wat NEN 2580 over een
gedeelde bouwmuur zegt. Naar IFC gaat een beklede muur als <code>IfcMaterialLayerSet</code>: constructie
en bekleding als geordende lagen.</p>

<p>Onder <b>Wandoppervlak</b> staat wat de muren van de verdieping aan vlak bieden — de maat waarop
stucwerk, verf en behang worden besteld. Per muur staat het netto oppervlak in de muurlijst en in het
paneel van de geselecteerde muur; per ruimte staat het onder haar regel in de ruimtelijst; de verdieping
krijgt haar eigen totaal, met daarnaast <b>in ruimtes</b>: wat de ruimtes samen aan afwerking vragen.
Gemeten wordt de <em>versneden vlaklengte</em> maal de hoogte, aan beide zijden: een muur tussen twee
dikkere muren heeft een binnenvlak dat korter is dan zijn hartlijn en een buitenvlak dat langer is, en
het is het vlak dat wordt afgewerkt. Sparingen worden op ware grootte van beide zijden afgetrokken, tot
niet meer dan het vlak zelf. Draagt een muur gevelbekleding, dan staat er ook een regel <b>binnenzijden</b>:
hetzelfde netto zonder de beklede zijde, die per definitie buiten ligt. Een muur die geen gevelblad
opgeeft telt met beide zijden mee, want het document zegt dan niet welke zijde buiten is. Zoals elke
maat hier wordt dit gemeld en niet gecontroleerd.</p>
<p>De <b>dagkanten</b> staan als eigen regel naast het netto oppervlak, en samen vormen ze
<b>af te werken</b>. Een dagkant is het vlak van de sparing zelf, door de dikte van de muur heen: twee
neggen en een bovendorpel. Géén onderdorpel — onder een deur ligt de vloer en onder een raam komt een
vensterbank in plaats van stucwerk. Eén dag wordt door de twee zijden gedeeld, elk de helft, en dat is
geen benadering die goedgepraat moet worden: bij een raam in de gevel is de binnendag stucwerk en de
buitendag gevelwerk, en de verdeling zet beide waar ze horen. Gemeten wordt over de constructieve dikte;
gevelbekleding maakt de dag dieper, maar dat is gevelwerk. Zit er een verlaagd plafond onder de
bovendorpel, dan telt die dorpel niet mee en stoppen de neggen bij het plafond.</p>
<p>De hoogte wordt <em>per vlak</em> genomen, want de twee zijden van één muur staan in twee ruimtes.
Zonder verlaagd plafond is dat vloer tot vloer; met een verlaagd plafond wordt elk vlak gemeten tot het
plafond van de ruimte waarin het staat. Het plafond van de verdieping staat in het Plan-paneel, een
ruimte geeft in de ruimtelijst haar eigen hoogte op — de badkamer onder een verlaagd plafond terwijl de
rest doorloopt. De tussenmuur wordt dan aan de badkamerzijde tot 2300 afgewerkt en aan de andere zijde
tot de vloer erboven, en dat is precies wat het paneel van die muur laat zien. Een plafond is een
<em>afwerking</em>: het verandert niets aan de verdiepingshoogte, aan wat een trap overbrugt, aan de
ruimteoppervlaktes of aan de export. Een opgegeven hoogte gelijk aan of boven de verdiepingshoogte
werkt niets extra af en telt daarom niet mee. Een vloeropbouw is niet bekend.</p>

<h2 id="selecteren">Selecteren, verplaatsen, krommen</h2>
<p><kbd>V</kbd> activeert het selectiegereedschap voor knopen, muren en symbolen. Een geselecteerde muur
krijgt een ruitvormige greep op het midden; verslepen buigt de muur tot een cirkelboog. De pijlhoogte in millimeters
staat daarna in het paneel, net als de dikte en de lengte. Lengte aanpassen verschuift het verre
uiteinde langs de muurrichting.</p>

<p>Twee muren die net niet op elkaar uitkomen zijn samen te voegen: selecteer ze allebei
(<kbd>Shift</kbd>+klik) en het paneel biedt <b>Muren verbinden</b> aan. Beide muren worden doorgetrokken
tot hun snijpunt en de uiteinden worden één knoop — hetzelfde werkt bij een overlap, want dan ligt het
snijpunt achter een van de uiteinden. Evenwijdige muren hebben geen snijpunt; die uiteinden komen samen
op hun midden, en de knop heet dan ook anders. Kan het niet, dan zegt het paneel waaróm: de muren delen
al een knoop, een uiteinde zit al aan een derde muur vast, of ze reiken niet tot elkaar.</p>
<p>Knopen zijn ook los toe te voegen en te verwijderen. <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+klik op een muur
splitst hem daar en selecteert de nieuwe knoop, zodat x en y meteen op maat te zetten zijn — dezelfde
handeling als op een leiding. Een geselecteerde knoop is oranje getekend, zodat duidelijk is waar
<kbd>Del</kbd> op werkt: die haalt de kn\u00f3\u00f3p weg, niet de muur. Zitten er twee muren aan, dan
worden die \u00e9\u00e9n — ook als het een hoek was, want dat is wat het weghalen van een knoop betekent.
Aan een muuruiteinde is er niets om in op te gaan en gaat die ene muur mee. Komen er drie of meer muren
samen, dan gebeurt er niets: dat weghalen zou losse einden achterlaten, en daarvoor staat
<b>Verwijderen met muren</b> er apart. Op een leiding werkt <kbd>Del</kbd> precies zo — het punt
verdwijnt en de buren worden opnieuw verbonden. Staat een knoop tussen precies twee muren die in \u00e9\u00e9n lijn lopen en
hetzelfde vermelden, dan biedt het paneel <b>Knoop verwijderen</b>: de twee muren worden \u00e9\u00e9n en
de sparingen schuiven mee. Dezelfde bewerking staat op de muren zelf: selecteer beide secties en het
paneel biedt <b>Muren samenvoegen</b> aan — twee secties zijn twee dingen op het scherm, en daar wordt
naar de knop gezocht. Kan het niet, dan zegt het paneel waarom.</p>

<h2 id="openingen">Deuren, ramen en doorgangen</h2>
<p><kbd>D</kbd>, <kbd>N</kbd> en <kbd>P</kbd> plaatsen respectievelijk een deur, raam en doorgang op een
muur. Tijdens het plaatsen worden de afstanden tot beide muuruiteinden weergegeven. Richting, breedte
en type zijn vervolgens instelbaar in het paneel; alle typen staan op
<a href="/kozijnen/">deur- en raamtypen</a>.</p>
<p>Het paneel toont bij een actief openingsgereedschap wat de <b>volgende</b> plaatsing krijgt: breedte,
draairichting en brandwerendheid. Die keuzes blijven staan, zodat een rij gelijke deuren in één keer
goed staat in plaats van stuk voor stuk achteraf. De aangeboden breedtes zijn de standaard dagmaten van
het binnendeurkozijn — 730, 780, 830, 880, 930 en 1010 mm — en daarnaast de dubbele maten; elke andere
maat blijft intypbaar. <code>width</code> is de dagmaat van het kozijn, niet het deurblad.</p>
<p>Brandwerendheid wordt genoteerd zoals op een tekening: <b>WBDBO</b> met het aantal minuten, en
daarnaast WBD en WRD. Het aanzetten van een waardering zet de deur meteen op zelfsluitend. De aanduiding
komt op de plattegrond en in elke export.</p>
<p>Een opening blijft aan de bijbehorende muur gekoppeld en verplaatst met die muur mee.</p>

<h2 id="symbolen">Symbolen</h2>
<p><kbd>S</kbd> opent het symboolgereedschap. Zoeken in het palet werkt in beide talen; de zoekterm
&ldquo;socket&rdquo; vindt bijvoorbeeld de wandcontactdoos in de Nederlandse interface. Symbolen die aan
een muur horen klikken vlak tegen het muurvlak en draaien mee. <kbd>R</kbd> roteert, <kbd>M</kbd>
spiegelt, <kbd>Alt</kbd>+slepen maakt een kopie van wat al goed staat. Kleur is betekenis, geen opmaak: zwart is bestaand, rood is nieuw, geel verdwijnt.
Alle ${SYMBOLS.length} staan op <a href="/symbolen/">plattegrondsymbolen</a>.</p>

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
regelgeving. <kbd>R</kbd> draait een kwartslag om het midden van de trap en <kbd>M</kbd> spiegelt, ook
vóór het plaatsen. Een trap die draait heeft een draairichting in het paneel, linksom of rechtsom; bij
een trap met onder- en bovenkwart staat elk kwart daar apart, zodat de trap boven naast zichzelf
terugkomt of juist naar de andere kant verspringt. De pijl wijst altijd van beneden naar boven; een trap die naar beneden gaat is
dezelfde trap, omgedraaid. Een trap op de verdieping eronder schemert door op de plattegrond erboven,
want daar komt hij aan.</p>

<h2 id="constructie">Constructie</h2>
<p><kbd>H</kbd> opent het constructiegereedschap: kolom, balk, leuning en vide — de dragende en
begrenzende delen die geen muur zijn. Geen daarvan komt in de muurgraaf: een kolom staat los van de
hartlijnen ook waar hij in een muur staat, een balk overspant wat hem draagt, en een leuning begrenst
een rand zonder een ruimte te omsluiten. Elk is een geplaatst object met eigen maten, zoals een trap,
en de tekening volgt daaruit.</p>
<p>Het snijvlak van de plattegrond bepaalt hoe elk getekend wordt. Een <b>kolom</b> wordt erdoor
gesneden en staat gearceerd, als een muur; de doorsnede is rechthoekig, rond of een H-profiel, met
breedte en diepte in het document. Een kolom draagt de vloer erboven tenzij hij een eigen hoogte
opgeeft, wat een kolom onder de vloerrand van een vide nodig heeft. Een <b>balk</b> ligt boven het
snijvlak en staat daarom gestreept, zoals een bovenkast; de gangbare walsprofielen (HEA, HEB, IPE)
staan in het paneel en zetten flensbreedte, profielhoogte en het opschrift in één keer, maar het document
slaat de maten en het opschrift op, niet de tabelrij. Een balk ligt met de bovenkant op de
verdiepingshoogte tenzij een eigen onderkant is ingevuld. Een <b>leuning</b> staat onder het snijvlak
en staat in omtrek: twee lijnen op de breedte van de handregel, met een streepje per baluster op de
opgegeven hart-op-hartmaat. Balk en leuning worden tussen twee punten gezet, met klikken of slepen;
<kbd>O</kbd> zet de hoek vast. Een muur met een eigen hoogte tot 1200 mm — een borstwering,
kniemuur of plint — staat om dezelfde reden in omtrek in plaats van gearceerd.</p>
<p>Een <b>vide</b> is een opening in de vloer, open naar de verdieping eronder. Een vide
hoort bij de verdieping waarin het gat zit, niet bij een verdieping van zichzelf — de vloer heeft een
gat en de plattegrond van die verdieping tekent het. Een trapgat is hetzelfde: de opening waar de trap
van beneden doorheen komt, getekend op de plattegrond van de verdieping erboven. Het merk is de
omtrek met een diagonaal uit elke hoek; de vloerkleur eronder wordt weggenomen, want een vide is geen
vloer.</p>
<p>Materiaal is een keuze per element, net als bij een muur, en niet opgegeven is een eigen antwoord.
De IFC-export schrijft kolom, balk en leuning als eigen elementen met hun maten; de 3D-weergave trekt
ze op tot hun hoogte. Wallgraph rekent niets aan een constructie na: een kolom of balk is een figuur op
de tekening, geen berekening.</p>

<h2 id="inrichting">Inrichting</h2>
<p><kbd>C</kbd> opent het inrichtingsgereedschap: kasten, keukenapparatuur, sanitair en meubels. Geen
daarvan is een symbool, en om dezelfde reden als een trap: hetzelfde kastje is 400, 600 of 800 mm breed,
een bad is 1700 of 1800 lang en een tafel is zo groot als de kamer toelaat. Breedte, diepte en hoogte
staan dus in het document, en de kast, het front, de draairichting, de spoelbak en de overstek van het
blad volgen daaruit bij het tekenen.</p>
<p>Het paneel groepeert de benoemde uitvoeringen per ruimte: keuken, sanitair, kasten en stellingen, en
meubels. Onder de kiezer staan de velden die bij die vorm horen — een kast heeft een hoogteklasse, een
front en een draairichting, een toestel heeft een merkteken, een douche heeft wel of geen bak, een bed
alleen een maat. De hoogteklasse van een kast bepaalt hoe die het snijvlak van de plattegrond raakt:
onderkasten worden van boven gezien en hoge kasten worden doorgesneden, beide doorgetrokken;
<b>bovenkasten en afzuigkappen hangen er volledig boven en staan daarom gestreept</b>, zoals al het werk
boven het snijvlak.</p>
<p>Voor kastwerk zijn de maten de gangbare modulematen: 150, 200, 300, 400, 450, 500, 600, 800, 900, 1000
en 1200 mm, naast een intypbare maat voor een vulpaneel op maat; andere vormen hebben hun eigen reeks.
Wat tegen een muur staat klikt vlak tegen die muur én tegen het element ernaast, zodat een
keukenopstelling als aaneengesloten rij ontstaat in plaats van stuk voor stuk op het oog uitgelijnd. Wat
vrij staat — een bed, een bank, een tafel — landt waar de cursor staat. <kbd>R</kbd> draait een kwartslag
om het midden, <kbd>M</kbd> spiegelt.</p>
<p><kbd>Shift</kbd>+klik kiest meer elementen tegelijk; slepen verplaatst dan alles wat geselecteerd is, en
draaien, spiegelen en verwijderen gelden voor de hele selectie. Een groep neemt geen snap: wat eenmaal is
opgesteld blijft opgesteld. <kbd>Alt</kbd>+slepen kopieert in plaats van te verplaatsen — de kopie hangt
aan de cursor en houdt maat, kleur en draairichting van het origineel.</p>

<h2 id="installaties">Installaties</h2>
<p><kbd>U</kbd> opent het installatiegereedschap. Een leiding is \u00e9\u00e9n samenhangend netwerk van
punten en verbindingen, geen losse lijn: een gedeelde hoofdleiding staat \u00e9\u00e9nmaal in het bestand
en vertakt daarna naar zoveel wandcontactdozen, kranen, afvoeren of ventielen als nodig. Klik om punten
te plaatsen; <kbd>Esc</kbd> of dubbelklik sluit het trac\u00e9 af, <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+klik
voegt onderweg een punt toe. Er zijn vijf disciplines — elektra, water, verwarming, ventilatie en gas —
elk met een eigen kleur en een eigen laag onder <b>Zichtbare lagen</b>. Verwarming staat apart en is geen
soort water: cv-leiding wordt op een andere grondslag gedimensioneerd en staat op een
installatietekening als een eigen systeem, ook waar \u00e9\u00e9n installateur beide legt.</p>
<p>Wat een leiding vermeldt hangt van de discipline af, en bepaalt hoe hij loopt op de tekening:</p>
<ul>
<li><b>Elektra</b> — kracht, utp of coax; het aantal aders; verdeler, groep en een leidingcode. Data
loopt gestreept, kracht doorgetrokken.</li>
<li><b>Water</b> — koud, warm of afvoer, met de diameter: 15/22/28 voor toevoer, 40/50/75/110 voor
afvoer. Warm krijgt een eigen tint binnen de waterkleur; afvoer loopt gestreept en zwaarder.</li>
<li><b>Verwarming</b> — aanvoer of retour, 15/16/22/28 mm.</li>
<li><b>Ventilatie</b> — toevoer of afvoer, kanaaldiameter 100 t/m 200 mm en desgewenst een debiet in
m\u00b3/h. Afvoer loopt gestreept.</li>
<li><b>Gas</b> — diameter.</li>
</ul>
<p>Daarnaast draagt elke leiding een montagewijze — inbouw, opbouw, in de vloer, in of boven het plafond,
of een vrij trac\u00e9 — en een hoogte boven de vloer. De lijn zegt wat voor leiding het is; hoe dik hij
staat zegt hoeveel ruimte hij vraagt. Vanaf 50 mm krijgt een leiding onder zijn eigen lijn een
doorsnedeband op ware maat: een kanaal van \u00d8200 neemt 200 mm in, en een tekening die dat als een
streepje toont kan de vraag of het past niet beantwoorden. Daaronder blijft het bij de lijn — een
toevoerleiding van 15 gaat waar hij gelegd wordt. Elektra vermeldt geen maat, want een bundel kabel
heeft in plattegrond geen zinvolle breedte.</p>
<p>Symbolen dragen aansluitpunten. Zet een symbool op een los leidingeinde en dat einde wordt
overgenomen: het punt volgt vanaf dan het symbool. Dat volgen is afgeleid en niet opgeslagen — verplaats
de wandcontactdoos en het leidingeinde gaat mee, omdat de leiding bij het tekenen de huidige positie
leest in plaats van een bijgewerkte kopie. Staat een apparaat midden op een trac\u00e9, dan biedt het
paneel <b>Aansluiten op</b> aan en wordt de leiding daar gesplitst; staat het precies op een knik of
knooppunt, dan biedt het <b>Hier aansluiten op</b> aan en wordt dat bestaande punt overgenomen, zodat de
leiding bij het apparaat omslaat. Beide zijn een keuze in het paneel en gebeuren nooit vanzelf: een
plaatsing hoort geen knooppunt midden in een hoofdleiding stilzwijgend op te slokken. Zolang een
aansluiting ontbreekt meldt het paneel welke dienst nog open staat.</p>
<p>Een los eindpunt is te typeren als bron, afgedopt of doorvoer buiten het model, en is door te voeren
naar de verdieping erboven of eronder. Zo\u2019n doorvoer is zichtbaar op elke verdieping die hij raakt,
met een eigen schachtaanduiding. Het paneel telt per verdieping wat er binnenkomt, uitgaat en doorloopt,
en hoeveel verticale lengte aan die verdieping toevalt — elke schacht \u00e9\u00e9n keer, bij de laagste
verdieping die hij raakt, zodat dezelfde schacht niet op elke plattegrond opnieuw meetelt. Wat niet
klopt wordt gemeld en niet geweigerd: een doorvoer naar een punt dat niet meer bestaat, tussen punten op
dezelfde verdieping, tussen verschillende disciplines, of tussen leidingen waarvan de gegevens niet
overeenkomen.</p>
<p>Het paneel noemt de getekende lengte, en apart daarvan de aftakkingen naar de aangesloten apparaten:
die zijn echte leiding maar staan niet op de plattegrond, dus worden ze ernaast vermeld in plaats van
erin verwerkt. Apparaten zonder opgegeven montagehoogte worden geteld, niet geraden. Loopt het netwerk
over meer verdiepingen, dan staat de totale netwerklengte er ook, met de verticale lengte apart. Twee
leidingen zijn samen te voegen wanneer dat \u00e9\u00e9n aaneengesloten net oplevert — dezelfde discipline,
en elkaar rakend; lukt dat niet, dan zegt het paneel welke van de twee ontbreekt.
<b>Automatisch langs muren</b> trekt elk stuk over de kortste weg langs de muren, op een instelbare
afstand tot het hart, en levert een gewoon trac\u00e9 op dat daarna met de hand aan te passen is.</p>
<p>Bij export krijgt elke discipline een eigen DXF-laag, met aparte lagen voor data, waterafvoer en
ventilatie-afvoer, omdat DXF kleur en streep per laag regelt en niet per lijn. De vergunningsbladen
dragen geen installaties.</p>

<h2 id="zoomen">Ruimtes in beeld en op naam</h2>
<p><kbd>F</kbd> brengt de hele plattegrond in beeld, <kbd>Shift</kbd>+<kbd>F</kbd> de selectie. Beide
werken in elk gereedschap. <kbd>Z</kbd> opent het ruimtegereedschap: sleep een kader op de tekening om
daarop in te zoomen, of klik een ruimte aan om die vol in beeld te brengen.</p>
<p>Het paneel toont daarbij alle herkende ruimtes als lijst, in de volgorde waarin ze op de tekening
staan. Een regel noemt de oppervlakte en, zodra die er is, de naam; de knop ernaast maakt van de regel
een invoerveld. De lijst volgt de muren: een ruimte die in tweeën wordt gedeeld verschijnt als twee
regels, zonder dat er iets bijgehouden hoeft te worden.</p>

<h2 id="3d">3D-weergave</h2>
<p><kbd>3</kbd> zet de 3D-weergave aan: het hele gebouw, rechtstreeks opgetrokken uit de getekende
muren — met deur- en raamopeningen, vloerplaten met vides en trapgaten, kolommen, balken en leuningen, trappen trede voor trede en
elke verdieping op haar eigen peil. Slepen draait het beeld, scrollen zoomt, <kbd>Shift</kbd>+slepen verschuift;
<kbd>F</kbd> brengt alles in beeld en <kbd>Esc</kbd> of nogmaals <kbd>3</kbd> keert terug naar de
plattegrond. Net als de ruimtes is het beeld afgeleid: er staat niets driedimensionaals in het
document.</p>

<h2 id="ruimtenamen">Ruimtenamen</h2>
<p>Een naam wordt in die lijst geschreven, of door op de tekening op de oppervlakte van een ruimte te
klikken — dat opent dezelfde regel. Een leeg veld haalt de naam weer weg.</p>
<p>Ruimtes zelf worden afgeleid uit de muren en staan niet in het document; wat wél is opgeschreven is
de naam en de plaats waar die is gezet, en dat is dan ook wat wordt bewaard. Welke ruimte de naam draagt
volgt uit dat punt. Verplaatst een muur zich zo dat het punt in de volgende ruimte valt, dan gaat de
naam met het punt mee.</p>
<p>Eén ruimte draagt één naam. Verdwijnt de muur tussen twee benoemde ruimtes, dan houdt de naam van
de grootste van de twee de samengevoegde ruimte en vervalt de andere: die noemde een ruimte die er niet
meer is. Muur en naam gaan in één stap, dus <kbd>Ctrl</kbd>+<kbd>Z</kbd> zet ze samen terug. Een naam
die in helemaal geen ruimte valt blijft wél staan waar hij is geschreven: dat is wat een open ruimte of
een nog niet gesloten muurlus nodig heeft.</p>
<p>De naam komt boven de oppervlakte te staan en gaat mee in PNG, SVG en DXF.</p>

<h2 id="ruimtes">Ruimtes en maten</h2>
<p>Gesloten muurlussen worden automatisch als ruimte herkend en van een oppervlakte voorzien. De maat is
standaard <b>netto</b> (binnenwerks, NEN 2580); de legenda op het canvas zegt welke conventie geldt en
in het Plan-paneel kan hart-op-hart worden gekozen. <kbd>L</kbd> zet maatlijnen op alle muren aan en uit;
selectie van een maatlabel maakt invoer van de lengte mogelijk.</p>
<p>De maatlijnen kennen dezelfde twee conventies, los te kiezen onder <b>Maatlijnen</b>: hart-op-hart,
<b>dagmaat</b> — gemeten tussen de wandvlakken, waar interieurwerk vanaf wordt uitgezet — of beide,
waarbij elke keten zijn eigen regel krijgt en de dagmaat het dichtst bij het gebouw ligt. Zodra de
dagmaat wordt getoond, krijgt elke rechthoekige ruimte ook haar vrije breedte en diepte onder de
oppervlakte, in PNG, SVG en DXF mee.</p>

<h2 id="exporteren">Opslaan en exporteren</h2>
<ul>
<li><b>PNG</b> — de plattegrond als afbeelding, op de tekening bijgesneden, zonder raster, met schaalbalk.</li>
<li><b>SVG</b> — vectorwerk op ware schaal: 1 mm in het document is 1 mm op papier bij 100% afdrukken.</li>
<li><b>DXF</b> — muren, draaicirkels, symbolen, trappen, vides, kolommen, balken, leuningen, de inrichting per vakgebied, ruimtenamen en oppervlaktes op aparte lagen, in millimeters, voor CAD. Werk boven het snijvlak staat op een eigen laag.</li>
<li><b>JSON</b> — het document zelf; zie <a href="/formaat/">documentformaat</a>.</li>
</ul>
<p>De plattegrond wordt automatisch in de lokale browseropslag bewaard. Hiervoor is geen account of
applicatieserver vereist. De plattegrond blijft na het sluiten van het tabblad beschikbaar.</p>

<h2 id="sneltoetsen">Sneltoetsen</h2>
<table><thead><tr><th>Toets</th><th>Doet</th></tr></thead><tbody>
<tr><td><kbd>V</kbd></td><td>selecteren en verplaatsen</td></tr>
<tr><td><kbd>W</kbd></td><td>muren tekenen; nogmaals: volgende vorm</td></tr>
<tr><td><kbd>D</kbd> <kbd>N</kbd> <kbd>P</kbd></td><td>deur, raam, doorgang</td></tr>
<tr><td><kbd>S</kbd></td><td>symbool plaatsen</td></tr>
<tr><td><kbd>T</kbd></td><td>trap plaatsen</td></tr>
<tr><td><kbd>H</kbd></td><td>constructie: kolom, balk, leuning, vide</td></tr>
<tr><td><kbd>C</kbd></td><td>inrichting plaatsen</td></tr>
<tr><td><kbd>Z</kbd></td><td>ruimtes: kader slepen, ruimte aanklikken, ruimte benoemen</td></tr>
<tr><td><kbd>F</kbd></td><td>alles in beeld</td></tr>
<tr><td><kbd>Shift</kbd>+<kbd>F</kbd></td><td>selectie in beeld</td></tr>
<tr><td><kbd>3</kbd></td><td>3D-weergave aan/uit</td></tr>
<tr><td><kbd>O</kbd></td><td>hoeksnapping aan/uit</td></tr>
<tr><td><kbd>Shift</kbd></td><td>hoek vasthouden tijdens het tekenen</td></tr>
<tr><td><kbd>G</kbd></td><td>rastersnapping aan/uit</td></tr>
<tr><td><kbd>L</kbd></td><td>maatlijnen aan/uit</td></tr>
<tr><td><kbd>R</kbd> <kbd>M</kbd></td><td>roteren om het midden, spiegelen</td></tr>
<tr><td><kbd>Shift</kbd>+klik</td><td>meer elementen selecteren</td></tr>
<tr><td><kbd>Alt</kbd>+slepen</td><td>kopie slepen in plaats van het origineel</td></tr>
<tr><td><kbd>Del</kbd></td><td>selectie verwijderen</td></tr>
<tr><td><kbd>Enter</kbd></td><td>muurketen sluiten (zonder getypte lengte)</td></tr>
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
<p><kbd>W</kbd> activates the wall tool; pressing <kbd>W</kbd> again steps through the four shapes it
draws: line, rectangle, circle and polygon. The same choice is in the panel, next to the thickness the
next wall is drawn at.</p>
<p>With the line, the first click places a start point and subsequent clicks form a chain. A length in
millimetres can be typed while drawing. <kbd>Enter</kbd> commits the segment at that length in the
selected direction; with nothing typed, <kbd>Enter</kbd> closes the chain back onto its first point.
<kbd>Esc</kbd> ends the chain.</p>
<p>The other three shapes take two points: corner and opposite corner for the rectangle, centre and
radius for the circle and the polygon. Clicking and dragging both work. <kbd>Shift</kbd> keeps the
rectangle square, and on a touch screen the Square toggle does the same. What they leave behind are
ordinary walls — the circle is four quarter arcs — free to be moved, curved and given openings.</p>
<ul>
<li><kbd>O</kbd> toggles angle snapping (90°/45°). <kbd>Shift</kbd> holds the angle for as long as it
is down, angle snapping on or off.</li>
<li>A wall drawn under the angle lock ends on the wall it is aimed at: where the locked direction
crosses a wall near the cursor, the end lands on that crossing and splits that wall.</li>
<li><kbd>G</kbd> toggles grid snapping. Off still rounds to whole millimetres.</li>
<li>A new wall splits every wall it crosses, and splits itself at every node it runs through.</li>
<li>A stretch a collinear wall already carries is not drawn again: two rectangles side by side share one
wall rather than stacking two. That wall keeps the thickness it had.</li>
</ul>

<p>Beside the thickness, the panel states what the wall is and what it is drawn in. The material is
masonry, concrete, timber, steel, glass or sandwich panel; not stated is a state of its own rather than
an assumption. Glass and sandwich panel are infill and change the drawing: the body is drawn as a light
band between its two faces rather than as poché. Colour is meaning here too, not formatting — black is
existing, red to be built, yellow to be removed — and it fills the wall body, as a verbouwtekening does.
Those choices stay armed for the next wall, the way the thickness does.</p>
<p>Any wall can carry posts: the frame its body is held in. That is one idea for what is one thing in
plan — the mullions of a curtain wall, the columns of a steel portal frame carrying sandwich panels, the
studs of a timber wall. The spacing is centre to centre and reads as a maximum bay width: each run
between openings is divided into equal bays no wider than the stated figure. A door therefore pushes the
posts of its own run aside instead of one landing in the doorway, and the door jambs read as the posts
they are in a real pui.</p>
<p>The post width is stated separately. Without one a post draws as a line — the centres are known, the
section is not yet. With one it is a member at the size it is built to, its depth being the wall
thickness itself, and it is never drawn wider than its own bay. A wall carrying posts exports as an IFC
<code>ELEMENTEDWALL</code>: assembled from components. Where the frame carries and the cladding does not,
the wall itself is load-bearing — that is what <code>loadBearing</code> states about the element; the
columns are not modelled separately.</p>

<p>Separate from that is the cladding: a skin <em>outside</em> the structural body. <code>thickness</code>
stays the structure, so a sandwich wall built 100 + 100 is thickness 100 with a facade of 100. That skin
lies wholly outside the structural faces, so it changes nothing about the wall graph, room detection or
the net area — it is drawn as a white band with a thin outline, as a building drawing does. Two clad
walls miter their skins at a corner; an unclad wall running into one lets the skin pass. What the facade
does set is the gross area: under the <b>gross (BVO)</b> area mode, measurement runs to the outer face of
the facade where a bounding wall has one and to the centreline where it does not — which is what NEN 2580
says about a shared party wall. A clad wall exports to IFC as an <code>IfcMaterialLayerSet</code>:
structure and cladding as ordered layers.</p>

<p><b>Wall surface</b> states the face area the storey's walls present — the quantity stucco, paint and
wallpaper are ordered against. Each wall's net area appears in the wall list and in the pane of the
selected wall; each room's appears under its row in the room list; the storey carries its own total,
with an <b>in rooms</b> line beside it for what the rooms take between them. What is measured is the
<em>mitered face length</em> times the height, on both faces: a wall running between two thicker walls
has an inner face shorter than its centreline and an outer face longer, and it is the face that gets
finished. Openings are deducted at their stated size from both faces, clamped to the face itself.
Where a wall carries cladding an <b>inner faces</b> line appears beside it: the same net area without the clad side, which is by
definition outside. A wall that states no cladding counts with both faces, since the document does not
then say which side is outside. Like every figure here, this is reported and not checked.</p>
<p><b>Reveals</b> — dagkanten — stand as their own line beside the net area, and together they make
<b>to finish</b>. A reveal is the surface of the opening itself, through the wall's thickness: two jambs
and a head. No sill — under a door that is the floor, and under a window it takes a window board rather
than plaster. One reveal is shared by the two sides, half each, and that is not an approximation to
apologise for: on a window in the facade the inner reveal is plasterwork and the outer one is facade
detail, and the split puts each where it belongs. It is measured over the structural thickness;
cladding makes the reveal deeper, but that is facade work. Where a suspended ceiling sits below the
head, the head does not count and the jambs stop at the ceiling.</p>
<p>The height is taken <em>per face</em>, because the two sides of one wall stand in two rooms. With no
suspended ceiling that is floor to floor; with one, each face is measured to the ceiling of the room it
stands in. The storey's ceiling is set in the Plan pane, and a room states its own in the room list —
the bathroom under a dropped ceiling while the rest runs on. The wall between them is then finished to
2300 on the bathroom side and to the floor above on the other, which is exactly what that wall's pane
shows. A ceiling is a <em>finish</em>: it changes nothing about the storey height, what a stair climbs,
the room areas or the exports. A stated height at or above the storey height finishes nothing extra and
so does not count. A floor build-up is not modelled.</p>

<h2 id="select">Selecting, moving, curving</h2>
<p><kbd>V</kbd> activates selection and dragging for nodes, walls and symbols. A selected wall displays
a diamond handle at its midpoint; dragging it forms a circular arc. The sagitta in millimetres is editable in the
panel, alongside thickness and length. Editing the length moves the far node along the wall direction.</p>

<p>Two walls that stop short of each other can be joined: select both (<kbd>Shift</kbd>+click) and the
panel offers <b>Join walls</b>. Both are extended to where their directions cross and the ends become one
node — the same works for an overlap, where the crossing simply lies behind one of the ends. Parallel
walls have no crossing, so their ends are welded at the midpoint and the button says so. Where the join
cannot be made, the panel states which condition failed: the walls already share a node, one end is
attached to a third wall, or they do not reach each other.</p>
<p>Nodes can also be added and removed on their own. <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+click on a wall
splits it there and selects the new node, so its x and y can be set exactly — the same gesture as on a
service run. A selected node is drawn in the selection colour, so it is clear what <kbd>Del</kbd> will
act on: it removes the <em>node</em>, not the wall. Where two walls meet there they become one — a corner
included, since that is what removing a node means. At a wall end there is nothing to heal into and that
one wall goes with it. Where three or more walls meet, nothing happens: removing it would leave loose
ends, and <b>Delete with walls</b> sits beside it for anyone who wants that. <kbd>Del</kbd> behaves the
same way on a service run — the point goes and its neighbours are reconnected. Where a node sits between exactly two walls that run in one line and state the same things, the
panel offers <b>Remove node</b>: the two become one wall and the openings move with it. The same
operation sits on the walls themselves: select both sections and the panel offers <b>Merge walls</b> —
two sections are two things on the screen, and that is where the button gets looked for. Where it cannot
be done, the panel says why.</p>

<h2 id="openings">Doors, windows and passages</h2>
<p><kbd>D</kbd>, <kbd>N</kbd> and <kbd>P</kbd> place a door, window and passage respectively on a wall.
During placement, dimensions to both wall ends are displayed. Direction, width and type are then
configured in the panel; all options appear on <a href="/en/openings/">door and window types</a>.</p>
<p>With an opening tool active, the panel states what the <b>next</b> placement gets: width, hand and
fire resistance. Those choices persist, so a run of identical doors comes out right in one pass instead
of one edit at a time afterwards. The widths offered are the standard Dutch internal frame openings —
730, 780, 830, 880, 930 and 1010 mm — plus the double-leaf sizes; any other width stays typeable.
<code>width</code> is the clear frame opening, not the door leaf.</p>
<p>Fire resistance is written the way a drawing writes it: <b>WBDBO</b> with the rating in minutes,
alongside WBD and WRD. Setting a rating marks the door self-closing. The annotation reaches the plan
and every export.</p>
<p>An opening remains associated with its wall and moves when that wall moves.</p>

<h2 id="symbols">Symbols</h2>
<p><kbd>S</kbd> opens the symbol tool. Palette search matches both languages; for example,
&ldquo;wandcontactdoos&rdquo; finds the socket in the English interface. Wall-mounted symbols
snap to the wall face and align with it. <kbd>R</kbd> rotates, <kbd>M</kbd> mirrors, and <kbd>Alt</kbd>-drag copies one that is
already right. Colour indicates
status: black is existing, red is new work and yellow is to be removed. All ${SYMBOLS.length} are listed under
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
regulations. <kbd>R</kbd> turns a quarter about the middle of the stair and <kbd>M</kbd> mirrors,
before placing as well as after. A stair that turns states its direction in the panel, clockwise or
anticlockwise; a stair with a quarter at each end sets each quarter on its own, so it either comes
back beside itself at the top or leaves to the other side. The arrow always points from the bottom of
the flight to the top; a stair going down is the same stair, turned around. A flight on the storey
below shows through faintly on the plan above it, which is where it arrives.</p>

<h2 id="structure">Structure</h2>
<p><kbd>H</kbd> opens the structure tool: column, beam, railing and vide — the load-bearing and guarding
parts that are not walls. None of them enters the wall graph: a column stands free of the centerlines
even where it sits in a wall, a beam spans whatever carries it, and a railing guards an edge without
bounding a room. Each is a placed object carrying its own dimensions, like a stair, and the drawing
follows from them.</p>
<p>The plan's section plane decides how each is drawn. A <b>column</b> is cut by it and takes poché,
as a wall does; the section is rectangular, round or an H-profile, with width and depth in the
document. A column carries the floor above unless it states a height of its own, which a column under
the floor edge of a void needs. A <b>beam</b> runs above the section plane and is therefore dashed, as
a wall cabinet is; the ordinary rolled sections (HEA, HEB, IPE) are listed in the panel and set flange
width, section height and the designation at once, but the document stores the figures and the label,
not the table row. A beam's top sits at the storey height unless an underside of its own is stated. A
<b>railing</b> stands below the section plane and is drawn in outline: two lines at the handrail's
width, with a tick per baluster at the stated centres. Beams and railings are set out between two
points, by clicking or dragging; <kbd>O</kbd> locks the angle. A wall with its own height of 1200 mm
or less — a parapet, a knee wall, a plinth — is outlined rather than hatched for the same reason.</p>
<p>A <b>vide</b> is an opening in the floor, open to the storey below. It belongs to the
floor the hole is cut in rather than being a storey of its own — the slab has a hole and the plan of
that storey draws it. A stairwell opening is the same object: the hole a flight from below comes up
through, drawn on the plan of the floor above. The mark is the outline with a diagonal from each
corner, and it cuts the floor tint underneath, because a vide is not floor.</p>
<p>Material is a choice per element, as it is for a wall, and not stated is an answer of its own. The
IFC export writes column, beam and railing as elements of their own with their figures; the 3D view
extrudes them to their height. Wallgraph checks nothing about a structure: a column or beam is a figure
on the drawing, not a calculation.</p>

<h2 id="fitout">Fit-out</h2>
<p><kbd>C</kbd> opens the fit-out tool: cabinetry, kitchen appliances, sanitary fixtures and furniture.
None of them is a symbol, for the reason a stair is not: the same unit is built 400, 600 or 800 mm wide,
a bath is 1700 or 1800 long, and a table is whatever the room takes. Width, depth and height live in the
document, and the carcass, the front, the hinge mark, the bowl and the worktop overhang are derived from
them at render time.</p>
<p>The panel groups the named pieces by room — kitchen, sanitary, cabinets and racking, furniture. Under
the picker are the fields that form actually reads: a cabinet has a height class, a front and a hinge
side; an appliance has its mark; a shower has a tray or none; a bed has only a size. A cabinet's height
class decides how it meets the plan's section plane: base units are seen from above and tall units are
cut through, both drawn solid; <b>wall units and extractor hoods hang entirely above it and are
therefore drawn dashed</b>, as overhead work is.</p>
<p>For cabinetry the sizes offered are the standard module widths: 150, 200, 300, 400, 450, 500, 600,
800, 900, 1000 and 1200 mm, beside a typed width for a filler cut to size; other forms carry their own
ladder. A piece that stands against a wall snaps flush to it and to the piece beside it, so a kitchen
comes out as a continuous run rather than a line of units aligned by eye. A free-standing piece — a bed,
a sofa, a table — lands where the cursor is. <kbd>R</kbd> turns a quarter about the middle,
<kbd>M</kbd> mirrors.</p>
<p><kbd>Shift</kbd>-click picks out more than one piece; dragging then moves everything selected, and
turning, mirroring and deleting apply to the whole selection. A group takes no snap, so a run that has
been arranged stays arranged. <kbd>Alt</kbd>-drag copies instead of moving — the copy follows the cursor
with the original's size, colour and hinge side.</p>

<h2 id="services">Building services</h2>
<p><kbd>U</kbd> opens the services tool. A run is one connected network of points and segments rather
than a loose line: a shared trunk is stored once and branches from there to as many sockets, taps,
drains or air terminals as it needs. Click to place points; <kbd>Esc</kbd> or a double-click ends the
run, and <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+click adds a point along one. There are five disciplines —
electrical, water, heating, ventilation and gas — each with its own colour and its own layer under
<b>Visible layers</b>. Heating is its own discipline rather than a kind of water: CV pipe is sized on a
different basis and appears on an installation drawing as a separate system, even where one installer
lays both.</p>
<p>What a run states depends on its discipline, and decides how it draws:</p>
<ul>
<li><b>Electrical</b> — power, utp or coax; the number of cores; board, group and a cable tag. A data
run is dashed, a power run solid.</li>
<li><b>Water</b> — cold, hot or drain, with the diameter: 15/22/28 for supply, 40/50/75/110 for
drainage. Hot takes its own tint within the water ink; drain is dashed and heavier.</li>
<li><b>Heating</b> — CV flow or CV return, 15/16/22/28 mm.</li>
<li><b>Ventilation</b> — supply or extract, duct diameter 100 to 200 mm, and a flow rate in
m\u00b3/h where one is known. Extract is dashed.</li>
<li><b>Gas</b> — diameter.</li>
</ul>
<p>Every run also carries a mounting method — concealed, surface, in the floor, in or above the ceiling,
or a free route — and a height above the floor. The line says what kind of run it is; how thick it draws
says how much room it needs. From 50 mm up a run gains a footprint band at its true bore beneath its own
line: a \u00d8200 duct occupies 200 mm, and a drawing that shows that as a hairline cannot answer whether
it fits. Below that the line is the whole statement — a 15 mm supply leg goes where it is put. Electrical
states no size at all, because a bundle of cable has no meaningful width in plan.</p>
<p>Symbols carry service ports. Place a symbol on a loose end of a run and that end is taken over: the
point follows the symbol from then on. The following is derived rather than stored — move the socket and
the end goes with it, because the run reads the symbol's current position when it draws rather than an
updated copy. Where a device stands part-way along a run, the panel offers <b>Connect to</b> and the run
is split there; where it stands exactly on a bend or a junction, it offers <b>Connect here to</b> and
that existing point is adopted, so the run turns at the device. Both are a choice in the panel and never
happen on their own: a placement should not silently swallow a junction in the middle of a trunk. Until a
device is connected, the panel names which service is still open.</p>
<p>A loose endpoint can be typed as a source, capped, or a run leaving the model, and can be continued to
the storey above or below. Such a riser is visible on every storey it touches, with its own shaft tag.
The panel counts what arrives, leaves and passes through per storey, and how much vertical run belongs to
that storey — each shaft once, charged to the lowest storey it touches, so the same shaft is not counted
again on every plan. What does not add up is reported rather than refused: a riser pointing at a point
that no longer exists, one joining points on the same storey, one joining different disciplines, or one
joining runs whose data disagree.</p>
<p>The panel states the drawn length, and separately the drops to the devices the run is connected to:
those are real cable but are not on the plan, so they are stated beside the drawn length rather than
folded into it. Devices with no stated mounting height are counted, not guessed. Where the network runs
across storeys, its total length is given too, with the vertical part stated separately. Two runs can be
merged where that produces one connected service — the same discipline throughout, and touching; where it
does not, the panel says which of the two is missing. <b>Follow the walls</b> takes each leg by the shortest
path along the walls at a settable offset from the centreline, and leaves an ordinary run behind to edit
afterwards.</p>
<p>On export each discipline gets its own DXF layer, with separate layers for data, water drainage and
ventilation extract, since DXF settles colour and dash per layer rather than per line. The permit sheets
carry no services.</p>

<h2 id="zoom">Framing and naming rooms</h2>
<p><kbd>F</kbd> fits the whole plan, <kbd>Shift</kbd>+<kbd>F</kbd> the selection. Both work in any tool.
<kbd>Z</kbd> opens the room tool: drag a box on the drawing to zoom into it, or click a room to frame
it.</p>
<p>The panel lists every detected room in the order they appear on the drawing. A row states the area
and, once it has one, the name; the button beside it turns the row into an input. The list follows the
walls: a room divided in two shows as two rows, with nothing to keep in step.</p>

<h2 id="3d">3D view</h2>
<p><kbd>3</kbd> switches to the 3D view: the whole building, extruded directly from the drawn walls —
door and window openings cut out, floor slabs with their voids and stairwells, columns, beams and
railings, stairs tread by tread, every storey at its own level. Dragging orbits, scrolling zooms, <kbd>Shift</kbd>+drag pans; <kbd>F</kbd> fits everything
and <kbd>Esc</kbd> or <kbd>3</kbd> again returns to the plan. Like the rooms, the view is derived:
nothing three-dimensional is stored in the document.</p>

<h2 id="roomnames">Room names</h2>
<p>A name is written in that list, or by clicking a room's area figure on the drawing, which opens the
same row. An empty field takes the name off again.</p>
<p>Rooms themselves are derived from the walls and are not in the document; what was authored is the
name and the point it was written at, so that is what is stored. Which room carries the name follows
from that point. Move a wall so the point falls in the next room and the name goes with the point.</p>
<p>One room carries one name. Take out the wall between two named rooms and the name of the larger of
the two keeps the room that results; the other is deleted, because the room it named is gone. The wall
and the name go in one step, so <kbd>Ctrl</kbd>+<kbd>Z</kbd> brings both back. A name that falls in no
room at all does keep drawing where it was written, which is what an open-plan space or a wall loop
that is not closed yet needs.</p>
<p>The name sits above the area figure and carries into PNG, SVG and DXF.</p>

<h2 id="rooms">Rooms and dimensions</h2>
<p>Closed wall loops are detected as rooms and labelled with their area. That area is <b>net</b> by
default (inner faces, NEN 2580); the canvas legend states which convention is in force, and the
Plan panel can select centerline measurement. <kbd>L</kbd> toggles dimension lines on every wall;
selecting a dimension label enables length input.</p>
<p>The dimension lines carry the same two conventions, chosen separately under <b>Dimensions</b>:
centerline, <b>clear span</b> — measured between the wall faces, which is what interior work is set
out from — or both, in which case each chain gets its own line and the clear one sits nearest the
building. With the clear span shown, every rectangular room also states its free width and depth
below the area, in PNG, SVG and DXF.</p>

<h2 id="export">Saving and exporting</h2>
<ul>
<li><b>PNG</b> — the plan as an image, cropped to the drawing, no grid, with a scale bar.</li>
<li><b>SVG</b> — vector artwork at true scale: 1 mm in the document is 1 mm on paper printed at 100%.</li>
<li><b>DXF</b> — walls, swings, symbols, stairs, voids, columns, beams, railings, the fit-out split by trade, room names and areas on separate layers, in millimetres, for CAD. Overhead work gets a layer of its own, since it hangs above the section plane.</li>
<li><b>JSON</b> — the document itself; see <a href="/en/format/">document format</a>.</li>
</ul>
<p>The plan is saved automatically in local browser storage. This requires no account or application
server. The plan remains available after the tab is closed.</p>

<h2 id="shortcuts">Keyboard shortcuts</h2>
<table><thead><tr><th>Key</th><th>Does</th></tr></thead><tbody>
<tr><td><kbd>V</kbd></td><td>select and move</td></tr>
<tr><td><kbd>W</kbd></td><td>draw walls; again: next shape</td></tr>
<tr><td><kbd>D</kbd> <kbd>N</kbd> <kbd>P</kbd></td><td>door, window, passage</td></tr>
<tr><td><kbd>S</kbd></td><td>place a symbol</td></tr>
<tr><td><kbd>T</kbd></td><td>place a stair</td></tr>
<tr><td><kbd>H</kbd></td><td>structure: column, beam, railing, vide</td></tr>
<tr><td><kbd>C</kbd></td><td>place fit-out</td></tr>
<tr><td><kbd>Z</kbd></td><td>rooms: drag a box, click a room, name a room</td></tr>
<tr><td><kbd>F</kbd></td><td>fit everything in view</td></tr>
<tr><td><kbd>Shift</kbd>+<kbd>F</kbd></td><td>fit the selection</td></tr>
<tr><td><kbd>3</kbd></td><td>3D view on/off</td></tr>
<tr><td><kbd>O</kbd></td><td>angle snap on/off</td></tr>
<tr><td><kbd>Shift</kbd></td><td>hold the angle while drawing</td></tr>
<tr><td><kbd>G</kbd></td><td>grid snap on/off</td></tr>
<tr><td><kbd>L</kbd></td><td>dimension lines on/off</td></tr>
<tr><td><kbd>R</kbd> <kbd>M</kbd></td><td>rotate about the middle, mirror</td></tr>
<tr><td><kbd>Shift</kbd>+click</td><td>select more pieces</td></tr>
<tr><td><kbd>Alt</kbd>+drag</td><td>drag a copy instead of the original</td></tr>
<tr><td><kbd>Del</kbd></td><td>delete the selection</td></tr>
<tr><td><kbd>Enter</kbd></td><td>close the wall chain (with no length typed)</td></tr>
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
openingen die op hun muur geparametriseerd zijn, geplaatste symbolen, trappen, vides en constructie-elementen. <b>Niets afgeleids staat in
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
thickness and an optional arc), openings parameterised along their wall, placed symbols, stairs, vides and structural elements.
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
