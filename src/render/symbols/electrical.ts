import { SymbolDef, withCtx } from "./defs";

// ---------------------------------------------------------------------------
// Electrical symbols (Dutch NEN 5152-style installation drawing symbols),
// drawn at annotation scale (legible on the printed plan), not at physical
// device footprint. See ./defs.ts for the full drawing contract.
// ---------------------------------------------------------------------------

// Wandcontactdoos family. One stem out of the wall carries one cup per outlet
// (half-circle, apex on the stem, open side facing the room). "Met randaarde"
// adds a bar across the stem at each cup's apex, parallel to the wall and
// reaching past the cup on both sides.
const CUP_R = 100;      // cup radius
const CUP_FIRST = 200;  // first cup centre, measured from the wall
const CUP_STEP = 120;   // further cups follow along the stem at this spacing
const EARTH_HALF = 120; // earth bar half-length

export function socketPath(ctx: CanvasRenderingContext2D, cups: number, earthed: boolean): void {
  ctx.moveTo(0, 0);
  ctx.lineTo(0, CUP_FIRST - CUP_R); // stem, up to the first cup's apex
  for (let i = 0; i < cups; i++) {
    const c = CUP_FIRST + i * CUP_STEP;
    ctx.moveTo(CUP_R, c);
    ctx.arc(0, c, CUP_R, 0, Math.PI, true);
    if (earthed) {
      ctx.moveTo(-EARTH_HALF, c - CUP_R);
      ctx.lineTo(EARTH_HALF, c - CUP_R);
    }
  }
  ctx.stroke();
}

const socketWidth = (earthed: boolean) => (earthed ? EARTH_HALF : CUP_R) * 2 + 20;
const socketDepth = (cups: number) => CUP_FIRST + (cups - 1) * CUP_STEP + CUP_R;

function socket(type: string, label: string, cups: number, earthed: boolean): SymbolDef {
  return {
    type,
    label,
    category: "electrical",
    wallMounted: true,
    width: socketWidth(earthed),
    depth: socketDepth(cups),
    // The ordinary Dutch wandcontactdoos height. A socket above a worktop or
    // behind an appliance states its own; see SymbolDef.mountHeight.
    mountHeight: 300,
    ports: [{ key: "electrical:power", required: true }],
    draw(ctx) {
      withCtx(ctx, () => socketPath(ctx, cups, earthed));
    },
  };
}

const socketSingle = socket("socket-single", "Socket", 1, false);
const socketEarthed = socket("socket-earthed", "Socket (earthed)", 1, true);
const socketDouble = socket("socket-double", "Double socket", 2, false);
const socketDoubleEarthed = socket("socket-double-earthed", "Double socket (earthed)", 2, true);
const socketTriple = socket("socket-triple", "Triple socket", 3, false);
const socketTripleEarthed = socket("socket-triple-earthed", "Triple socket (earthed)", 3, true);

const socketShaver: SymbolDef = {
  type: "socket-shaver",
  label: "Shaver socket",
  category: "electrical",
  wallMounted: true,
  width: socketWidth(true),
  depth: socketDepth(1),
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: 1300,
  draw(ctx) {
    withCtx(ctx, () => {
      // Scheerapparaat: the socket stem and crossbar, with the isolating
      // transformer's full circle in place of the open cup.
      ctx.moveTo(0, 0);
      ctx.lineTo(0, CUP_FIRST - CUP_R);
      ctx.moveTo(-EARTH_HALF, CUP_FIRST - CUP_R);
      ctx.lineTo(EARTH_HALF, CUP_FIRST - CUP_R);
      ctx.moveTo(CUP_R, CUP_FIRST);
      ctx.arc(0, CUP_FIRST, CUP_R, 0, Math.PI * 2);
      ctx.stroke();
    });
  },
};

const socketFloor: SymbolDef = {
  type: "socket-floor",
  label: "Floor socket",
  category: "electrical",
  wallMounted: false,
  width: 320,
  depth: 320,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: 0,
  draw(ctx) {
    withCtx(ctx, () => {
      // Vloercontactdoos: the single-socket wine-glass form, re-centred, set
      // inside a round floor box outline.
      const r = 100;
      const cy = 60; // cup centre
      ctx.moveTo(0, -160);
      ctx.lineTo(0, -60); // stem
      ctx.moveTo(r, cy);
      ctx.arc(0, cy, r, 0, Math.PI, true); // cup
      ctx.moveTo(150, 0);
      ctx.arc(0, 0, 150, 0, Math.PI * 2); // floor box
      ctx.stroke();
    });
  },
};

// Schakelaar: the body circle plus one operating arm leaving the circle at 45
// degrees away from the wall, ticked across its end. The whole switch family is
// this mark with more arms or more ticks.
export const SWITCH_CY = 90;
export const SWITCH_R = 70;

export function switchMark(ctx: CanvasRenderingContext2D, cy = SWITCH_CY, r = SWITCH_R): void {
  ctx.moveTo(r, cy);
  ctx.arc(0, cy, r, 0, Math.PI * 2);
  const dirX = Math.cos(Math.PI / 4);
  const dirY = Math.sin(Math.PI / 4);
  ctx.moveTo(dirX * r, cy + dirY * r);
  const endX = dirX * (r + 90);
  const endY = cy + dirY * (r + 90);
  ctx.lineTo(endX, endY);
  // short perpendicular tick at the end
  const tick = 18;
  ctx.moveTo(endX + dirY * tick, endY - dirX * tick);
  ctx.lineTo(endX - dirY * tick, endY + dirX * tick);
}

const switchSingle: SymbolDef = {
  type: "switch-single",
  label: "Switch",
  category: "electrical",
  wallMounted: true,
  width: 240,
  depth: 240,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: 1050,
  draw(ctx) {
    withCtx(ctx, () => {
      switchMark(ctx);
      ctx.stroke();
    });
  },
};

const switchDouble: SymbolDef = {
  type: "switch-double",
  label: "Switch (2-pole)",
  category: "electrical",
  wallMounted: true,
  width: 240,
  depth: 240,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: 1050,
  draw(ctx) {
    withCtx(ctx, () => {
      const cx = 0;
      const cy = 90;
      const r = 70;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      const dirX = Math.cos(Math.PI / 4);
      const dirY = Math.sin(Math.PI / 4);
      const startX = cx + dirX * r;
      const startY = cy + dirY * r;
      const endX = cx + dirX * (r + 90);
      const endY = cy + dirY * (r + 90);
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      // two parallel perpendicular ticks near the end (2-pole)
      const perpX = -dirY;
      const perpY = dirX;
      const tickHalf = 18; // 36mm tick length
      for (const t of [r + 90, r + 60]) {
        const px = cx + dirX * t;
        const py = cy + dirY * t;
        ctx.moveTo(px - perpX * tickHalf, py - perpY * tickHalf);
        ctx.lineTo(px + perpX * tickHalf, py + perpY * tickHalf);
      }
      ctx.stroke();
    });
  },
};

const switchSeries: SymbolDef = {
  type: "switch-series",
  label: "Series switch",
  category: "electrical",
  wallMounted: true,
  width: 260,
  depth: 260,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: 1050,
  draw(ctx) {
    withCtx(ctx, () => {
      const cx = 0;
      const cy = 90;
      const r = 70;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      const tickHalf = 18;
      for (const deg of [30, 60]) {
        const a = (deg * Math.PI) / 180;
        const dirX = Math.cos(a);
        const dirY = Math.sin(a);
        const startX = cx + dirX * r;
        const startY = cy + dirY * r;
        const endX = cx + dirX * (r + 90);
        const endY = cy + dirY * (r + 90);
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        const perpX = -dirY;
        const perpY = dirX;
        ctx.moveTo(endX - perpX * tickHalf, endY - perpY * tickHalf);
        ctx.lineTo(endX + perpX * tickHalf, endY + perpY * tickHalf);
      }
      ctx.stroke();
    });
  },
};

const switchTwoWay: SymbolDef = {
  type: "switch-two-way",
  label: "Two-way switch",
  category: "electrical",
  wallMounted: true,
  width: 260,
  depth: 260,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: 1050,
  draw(ctx) {
    withCtx(ctx, () => {
      const cx = 0;
      const cy = 100;
      const r = 70;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      // one 45deg axis, extended on BOTH opposite sides of the circle
      const a = Math.PI / 4;
      const dirX = Math.cos(a);
      const dirY = Math.sin(a);
      const perpX = -dirY;
      const perpY = dirX;
      const tickHalf = 18;
      for (const sign of [1, -1]) {
        const edgeX = cx + sign * dirX * r;
        const edgeY = cy + sign * dirY * r;
        const endX = cx + sign * dirX * (r + 90);
        const endY = cy + sign * dirY * (r + 90);
        ctx.moveTo(edgeX, edgeY);
        ctx.lineTo(endX, endY);
        ctx.moveTo(endX - perpX * tickHalf, endY - perpY * tickHalf);
        ctx.lineTo(endX + perpX * tickHalf, endY + perpY * tickHalf);
      }
      ctx.stroke();
    });
  },
};

const switchCross: SymbolDef = {
  type: "switch-cross",
  label: "Cross switch",
  category: "electrical",
  wallMounted: true,
  width: 260,
  depth: 260,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: 1050,
  draw(ctx) {
    withCtx(ctx, () => {
      const cx = 0;
      const cy = 90;
      const r = 70;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      const tickHalf = 18;
      // both 45deg axes, both ends of each (4 diagonals total)
      for (const deg of [45, 135, 225, 315]) {
        const a = (deg * Math.PI) / 180;
        const dirX = Math.cos(a);
        const dirY = Math.sin(a);
        const edgeX = cx + dirX * r;
        const edgeY = cy + dirY * r;
        const endX = cx + dirX * (r + 90);
        const endY = cy + dirY * (r + 90);
        ctx.moveTo(edgeX, edgeY);
        ctx.lineTo(endX, endY);
        const perpX = -dirY;
        const perpY = dirX;
        ctx.moveTo(endX - perpX * tickHalf, endY - perpY * tickHalf);
        ctx.lineTo(endX + perpX * tickHalf, endY + perpY * tickHalf);
      }
      ctx.stroke();
    });
  },
};

const dimmer: SymbolDef = {
  type: "dimmer",
  label: "Dimmer",
  category: "electrical",
  wallMounted: true,
  width: 260,
  depth: 260,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: 1050,
  draw(ctx) {
    withCtx(ctx, () => {
      const cx = 0;
      const cy = 90;
      const r = 70;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      const dirX = Math.cos(Math.PI / 4);
      const dirY = Math.sin(Math.PI / 4);
      const startX = cx + dirX * r;
      const startY = cy + dirY * r;
      const endX = cx + dirX * (r + 90);
      const endY = cy + dirY * (r + 90);
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      const perpX = -dirY;
      const perpY = dirX;
      const tick = 18;
      ctx.moveTo(endX - perpX * tick, endY - perpY * tick);
      ctx.lineTo(endX + perpX * tick, endY + perpY * tick);
      // small right triangle (base 70mm), one leg on the circle edge,
      // hypotenuse pointing out along the diagonal. Stroked, not filled.
      const p1x = startX + perpX * 70;
      const p1y = startY + perpY * 70;
      const p3x = startX + dirX * 40;
      const p3y = startY + dirY * 40;
      ctx.moveTo(startX, startY);
      ctx.lineTo(p1x, p1y);
      ctx.lineTo(p3x, p3y);
      ctx.closePath();
      ctx.stroke();
    });
  },
};

const switchPull: SymbolDef = {
  type: "switch-pull",
  label: "Pull switch",
  category: "electrical",
  wallMounted: true,
  width: 240,
  depth: 300,
  ports: [{ key: "electrical:power", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      const cx = 0;
      const cy = 90;
      const r = 70;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      const dirX = Math.cos(Math.PI / 4);
      const dirY = Math.sin(Math.PI / 4);
      const startX = cx + dirX * r;
      const startY = cy + dirY * r;
      const endX = cx + dirX * (r + 90);
      const endY = cy + dirY * (r + 90);
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      const perpX = -dirY;
      const perpY = dirX;
      const tick = 18;
      ctx.moveTo(endX - perpX * tick, endY - perpY * tick);
      ctx.lineTo(endX + perpX * tick, endY + perpY * tick);
      // pull cord: from the circle's room-side edge, further into the room
      const cordStartY = cy + r;
      const cordEndY = cordStartY + 70;
      ctx.moveTo(cx, cordStartY);
      ctx.lineTo(cx, cordEndY);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cordEndY, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

const pushButton: SymbolDef = {
  type: "push-button",
  label: "Push button",
  category: "electrical",
  wallMounted: true,
  width: 200,
  depth: 200,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: 1050,
  draw(ctx) {
    withCtx(ctx, () => {
      const cx = 0;
      const cy = 90;
      ctx.moveTo(cx + 70, cy);
      ctx.arc(cx, cy, 70, 0, Math.PI * 2);
      ctx.moveTo(cx + 30, cy);
      ctx.arc(cx, cy, 30, 0, Math.PI * 2);
      ctx.stroke();
    });
  },
};

const doorbell: SymbolDef = {
  type: "doorbell",
  label: "Doorbell",
  category: "electrical",
  wallMounted: true,
  width: 240,
  depth: 200,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: 1050,
  draw(ctx) {
    withCtx(ctx, () => {
      // bell dome bulging into the room, chord (mounting side) toward the wall
      const cy = 110;
      const r = 90;
      ctx.moveTo(r, cy);
      ctx.arc(0, cy, r, 0, Math.PI, false); // dome through (0, cy+r)
      ctx.closePath(); // chord line back to (r, cy) via (-r, cy)
      ctx.stroke();
      // clapper
      ctx.beginPath();
      ctx.arc(0, 145, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

const lightPoint: SymbolDef = {
  type: "light-point",
  label: "Ceiling light",
  category: "electrical",
  wallMounted: false,
  width: 300,
  depth: 300,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: "ceiling",
  draw(ctx) {
    withCtx(ctx, () => {
      const half = 150;
      // crossed diagonals (X), two 300mm lines through the centre
      ctx.moveTo(-half, -half);
      ctx.lineTo(half, half);
      ctx.moveTo(half, -half);
      ctx.lineTo(-half, half);
      // circle at centre
      ctx.moveTo(45, 0);
      ctx.arc(0, 0, 45, 0, Math.PI * 2);
      ctx.stroke();
    });
  },
};

const lightWall: SymbolDef = {
  type: "light-wall",
  label: "Wall light",
  category: "electrical",
  wallMounted: true,
  width: 300,
  depth: 300,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: 1800,
  draw(ctx) {
    withCtx(ctx, () => {
      const cy = 150;
      const half = 150;
      const r = 45;
      // crossed diagonals (X), centred at (0, cy)
      ctx.moveTo(-half, cy - half);
      ctx.lineTo(half, cy + half);
      ctx.moveTo(half, cy - half);
      ctx.lineTo(-half, cy + half);
      // circle at centre
      ctx.moveTo(r, cy);
      ctx.arc(0, cy, r, 0, Math.PI * 2);
      // stem from the wall to the circle edge
      ctx.moveTo(0, 0);
      ctx.lineTo(0, cy - r);
      ctx.stroke();
    });
  },
};

const lightFluor: SymbolDef = {
  type: "light-fluor",
  label: "Fluorescent light",
  category: "electrical",
  wallMounted: false,
  width: 1200,
  depth: 120,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: "ceiling",
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-600, -60, 1200, 120);
      ctx.moveTo(-600, 0);
      ctx.lineTo(600, 0);
      ctx.stroke();
    });
  },
};

const lightSpot: SymbolDef = {
  type: "light-spot",
  label: "Spotlight",
  category: "electrical",
  wallMounted: false,
  width: 240,
  depth: 240,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: "ceiling",
  draw(ctx) {
    withCtx(ctx, () => {
      const r = 80;
      ctx.moveTo(r, 0);
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      for (const deg of [45, 135, 225, 315]) {
        const a = (deg * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        ctx.moveTo(cos * r, sin * r);
        ctx.lineTo(cos * (r + 50), sin * (r + 50));
      }
      ctx.stroke();
    });
  },
};

const lightEmergency: SymbolDef = {
  type: "light-emergency",
  label: "Emergency light",
  category: "electrical",
  wallMounted: false,
  width: 320,
  depth: 320,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: 2200,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-160, -160, 320, 320);
      const half = 100;
      ctx.moveTo(-half, -half);
      ctx.lineTo(half, half);
      ctx.moveTo(half, -half);
      ctx.lineTo(-half, half);
      ctx.moveTo(40, 0);
      ctx.arc(0, 0, 40, 0, Math.PI * 2);
      ctx.stroke();
    });
  },
};

const outletTv: SymbolDef = {
  type: "outlet-tv",
  label: "TV/CAI outlet",
  category: "electrical",
  wallMounted: true,
  width: 240,
  depth: 260,
  // A coax outlet takes coax. A power circuit run to it is not what
  // feeds it, so it does not count as connected.
  ports: [{ key: "electrical:coax", required: true }],
  mountHeight: 300,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 120);
      const deg = 35;
      const a = (deg * Math.PI) / 180;
      for (const sign of [1, -1]) {
        const dirX = sign * Math.sin(a);
        const dirY = Math.cos(a);
        ctx.moveTo(0, 120);
        ctx.lineTo(dirX * 130, 120 + dirY * 130);
      }
      ctx.stroke();
    });
  },
};

const outletData: SymbolDef = {
  type: "outlet-data",
  label: "Data outlet",
  category: "electrical",
  wallMounted: true,
  width: 240,
  depth: 260,
  ports: [{ key: "electrical:utp", required: true }],
  mountHeight: 300,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 110);
      // open square, no far (room-facing) side
      ctx.moveTo(-60, 110);
      ctx.lineTo(60, 110);
      ctx.lineTo(60, 230);
      ctx.moveTo(-60, 110);
      ctx.lineTo(-60, 230);
      ctx.stroke();
    });
  },
};

const distBoard: SymbolDef = {
  type: "dist-board",
  label: "Distribution board",
  category: "electrical",
  wallMounted: true,
  width: 500,
  depth: 250,
  mountHeight: 1600,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-250, 0, 500, 250);
      for (const o of [-150, 0, 150]) {
        ctx.moveTo(o - 60, 0);
        ctx.lineTo(o + 60, 250);
      }
      ctx.stroke();
    });
  },
};

const thermostat: SymbolDef = {
  type: "thermostat",
  label: "Thermostat",
  category: "electrical",
  wallMounted: true,
  width: 240,
  depth: 240,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: 1500,
  draw(ctx) {
    withCtx(ctx, () => {
      const cx = 0;
      const cy = 120;
      const r = 90;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      const a = Math.PI / 4;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

const motionSensor: SymbolDef = {
  type: "motion-sensor",
  label: "Motion sensor",
  category: "electrical",
  wallMounted: true,
  width: 280,
  depth: 220,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: "ceiling",
  draw(ctx) {
    withCtx(ctx, () => {
      const apexX = 0;
      const apexY = 10;
      const a1 = (35 * Math.PI) / 180;
      const a2 = (145 * Math.PI) / 180;
      // fan edges
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(apexX + Math.cos(a1) * 180, apexY + Math.sin(a1) * 180);
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(apexX + Math.cos(a2) * 180, apexY + Math.sin(a2) * 180);
      // concentric arcs between the fan edges
      for (const r of [90, 160]) {
        ctx.moveTo(apexX + Math.cos(a1) * r, apexY + Math.sin(a1) * r);
        ctx.arc(apexX, apexY, r, a1, a2, false);
      }
      ctx.stroke();
    });
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SYMBOLS_ELECTRICAL: SymbolDef[] = [
  socketSingle,
  socketEarthed,
  socketDouble,
  socketDoubleEarthed,
  socketTriple,
  socketTripleEarthed,
  socketShaver,
  socketFloor,
  switchSingle,
  switchDouble,
  switchSeries,
  switchTwoWay,
  switchCross,
  dimmer,
  switchPull,
  pushButton,
  doorbell,
  lightPoint,
  lightWall,
  lightFluor,
  lightSpot,
  lightEmergency,
  outletTv,
  outletData,
  distBoard,
  thermostat,
  motionSensor,
];
