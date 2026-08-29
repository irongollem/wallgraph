import { SymbolDef, withCtx } from "./defs";

// ---------------------------------------------------------------------------
// Heating & climate
// ---------------------------------------------------------------------------

const radiator: SymbolDef = {
  type: "radiator",
  label: "Radiator",
  category: "heating",
  wallMounted: true,
  width: 800,
  depth: 100,
  draw(ctx) {
    withCtx(ctx, () => {
      // outer rectangle
      ctx.rect(-400, 0, 800, 100);
      // 8 evenly spaced vertical hatch lines inside
      const count = 8;
      const margin = 800 / (count + 1);
      for (let i = 1; i <= count; i++) {
        const x = -400 + margin * i;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 100);
      }
      ctx.stroke();
    });
  },
};

const floorHeating: SymbolDef = {
  type: "floor-heating",
  label: "Floor heating",
  category: "heating",
  wallMounted: false,
  width: 600,
  depth: 600,
  draw(ctx) {
    withCtx(ctx, () => {
      // square outline
      ctx.rect(-300, -300, 600, 600);
      // serpentine coil inset 80mm: 4 horizontal passes joined by
      // semicircular turns that alternate left/right.
      const r = 50; // turn radius
      const xIn = 170; // horizontal pass half-length (bulge reaches 220)
      ctx.moveTo(-xIn, -150);
      ctx.lineTo(xIn, -150);
      ctx.arc(xIn, -100, r, -Math.PI / 2, Math.PI / 2, false); // turn right, ends (xIn,-50)
      ctx.lineTo(-xIn, -50);
      ctx.arc(-xIn, 0, r, -Math.PI / 2, Math.PI / 2, true); // turn left, ends (-xIn,50)
      ctx.lineTo(xIn, 50);
      ctx.arc(xIn, 100, r, -Math.PI / 2, Math.PI / 2, false); // turn right, ends (xIn,150)
      ctx.lineTo(-xIn, 150);
      ctx.stroke();
    });
  },
};

const cvBoiler: SymbolDef = {
  type: "cv-boiler",
  label: "CV boiler",
  category: "heating",
  wallMounted: true,
  width: 500,
  depth: 500,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-250, 0, 500, 500);
      const cy = 250;
      ctx.moveTo(140, cy);
      ctx.arc(0, cy, 140, 0, Math.PI * 2);
      // small open flame triangle, apex up, centred in the circle
      const side = 90;
      const h = (side * Math.sqrt(3)) / 2;
      const half = side / 2;
      const apexY = cy - (2 * h) / 3;
      const baseY = cy + h / 3;
      ctx.moveTo(0, apexY);
      ctx.lineTo(half, baseY);
      ctx.lineTo(-half, baseY);
      ctx.closePath();
      ctx.stroke();
    });
  },
};

const heatPump: SymbolDef = {
  type: "heat-pump",
  label: "Heat pump",
  category: "heating",
  wallMounted: true,
  width: 600,
  depth: 600,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-300, 0, 600, 600);
      const cx = 0;
      const cy = 300;
      const r = 200;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      // three fan-blade arcs, 120deg apart, curving from centre to the rim
      const angles = [-90, 30, 150];
      for (const deg of angles) {
        const a = (deg * Math.PI) / 180;
        const ac = ((deg - 35) * Math.PI) / 180;
        const ex = cx + r * Math.cos(a);
        const ey = cy + r * Math.sin(a);
        const ctrlX = cx + r * 0.6 * Math.cos(ac);
        const ctrlY = cy + r * 0.6 * Math.sin(ac);
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(ctrlX, ctrlY, ex, ey);
      }
      ctx.stroke();
    });
  },
};

const ventValve: SymbolDef = {
  type: "vent-valve",
  label: "Vent valve",
  category: "heating",
  wallMounted: false,
  width: 240,
  depth: 240,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.moveTo(100, 0);
      ctx.arc(0, 0, 100, 0, Math.PI * 2);
      ctx.moveTo(-120, 0);
      ctx.lineTo(120, 0);
      ctx.moveTo(0, -120);
      ctx.lineTo(0, 120);
      ctx.stroke();
      // small filled centre dot
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

const wtwUnit: SymbolDef = {
  type: "wtw-unit",
  label: "Heat recovery unit",
  category: "heating",
  wallMounted: true,
  width: 600,
  depth: 600,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-300, 0, 600, 600);
      // full X of both diagonals
      ctx.moveTo(-300, 0);
      ctx.lineTo(300, 600);
      ctx.moveTo(300, 0);
      ctx.lineTo(-300, 600);
      // arrowheads on the two right-side diagonal ends (air in/out)
      const headLen = 60;
      const addHead = (tipX: number, tipY: number, dirDeg: number) => {
        for (const off of [30, -30]) {
          const a = ((dirDeg + 180 + off) * Math.PI) / 180;
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX + Math.cos(a) * headLen, tipY + Math.sin(a) * headLen);
        }
      };
      addHead(300, 600, 45); // end of (-300,0)->(300,600)
      addHead(300, 0, -45); // start-side end of (300,0)->(-300,600), travelling outward
      ctx.stroke();
    });
  },
};

const expansionVessel: SymbolDef = {
  type: "expansion-vessel",
  label: "Expansion vessel",
  category: "heating",
  wallMounted: true,
  width: 400,
  depth: 400,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.moveTo(180, 200);
      ctx.arc(0, 200, 180, 0, Math.PI * 2);
      ctx.moveTo(-180, 200);
      ctx.lineTo(180, 200);
      ctx.stroke();
    });
  },
};

export const SYMBOLS_HEATING: SymbolDef[] = [
  radiator,
  floorHeating,
  cvBoiler,
  heatPump,
  ventValve,
  wtwUnit,
  expansionVessel,
];
