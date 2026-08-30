import { SymbolDef, withCtx, circle } from "./defs";

// ---------------------------------------------------------------------------
// Heating & climate
// ---------------------------------------------------------------------------

/** Rimmed fan: three blade arcs 120 degrees apart, curving centre to rim. */
function fan(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  circle(ctx, cx, cy, r);
  for (const deg of [-90, 30, 150]) {
    const a = (deg * Math.PI) / 180;
    const ac = ((deg - 35) * Math.PI) / 180;
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(
      cx + r * 0.6 * Math.cos(ac), cy + r * 0.6 * Math.sin(ac),
      cx + r * Math.cos(a), cy + r * Math.sin(a),
    );
  }
}

/** Evenly spaced vertical hatch inside a rectangle: the heating-element band. */
function hatch(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, count: number,
): void {
  const step = w / (count + 1);
  for (let i = 1; i <= count; i++) {
    ctx.moveTo(x + step * i, y);
    ctx.lineTo(x + step * i, y + h);
  }
}

const radiator: SymbolDef = {
  type: "radiator",
  label: "Radiator",
  category: "heating",
  wallMounted: true,
  width: 800,
  depth: 100,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-400, 0, 800, 100);
      hatch(ctx, -400, 0, 800, 100, 8);
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
      fan(ctx, 0, 300, 200);
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

const convector: SymbolDef = {
  type: "convector",
  label: "Convector",
  category: "heating",
  wallMounted: true,
  width: 800,
  depth: 120,
  draw(ctx) {
    withCtx(ctx, () => {
      // Shallow casing with the element drawn as a wedge across it.
      ctx.rect(-400, 0, 800, 120);
      ctx.moveTo(-400, 120);
      ctx.lineTo(400, 0);
      ctx.stroke();
    });
  },
};

const convectorPit: SymbolDef = {
  type: "convector-pit",
  label: "Trench convector",
  category: "heating",
  wallMounted: false,
  width: 1000,
  depth: 200,
  draw(ctx) {
    withCtx(ctx, () => {
      // Sunk in the floor rather than hung on a wall, so it is free-standing:
      // the trench runs along a facade but is not attached to one.
      ctx.rect(-500, -100, 1000, 200);
      hatch(ctx, -500, -100, 1000, 200, 12);
      ctx.stroke();
    });
  },
};

const cvManifold: SymbolDef = {
  type: "cv-manifold",
  label: "Heating manifold",
  category: "heating",
  wallMounted: true,
  width: 600,
  depth: 200,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-300, 0, 600, 200);
      for (const x of [-200, -100, 0, 100, 200]) circle(ctx, x, 100, 35);
      ctx.stroke();
    });
  },
};

const tempSensor: SymbolDef = {
  type: "temp-sensor",
  label: "Temperature sensor",
  category: "heating",
  wallMounted: true,
  width: 300,
  depth: 300,
  draw(ctx) {
    withCtx(ctx, () => {
      // The probe runs through the body and out. Stopping it at the rim, as
      // the switch mark's arm does, leaves a switch without its end tick.
      const cy = 110, r = 70, d = Math.SQRT1_2;
      circle(ctx, 0, cy, r);
      ctx.moveTo(-d * r, cy - d * r);
      ctx.lineTo(d * (r + 120), cy + d * (r + 120));
      ctx.stroke();
    });
  },
};

const storageHeater: SymbolDef = {
  type: "storage-heater",
  label: "Storage heater",
  category: "heating",
  wallMounted: true,
  width: 800,
  depth: 220,
  draw(ctx) {
    withCtx(ctx, () => {
      // The heating appliance's hatched band, boxed: the outer casing is the
      // accumulating mass around it.
      ctx.rect(-400, 0, 800, 220);
      ctx.rect(-340, 40, 680, 140);
      hatch(ctx, -340, 40, 680, 140, 8);
      ctx.stroke();
    });
  },
};

const heatPumpOutdoor: SymbolDef = {
  type: "heat-pump-outdoor",
  label: "Heat pump outdoor unit",
  category: "heating",
  wallMounted: true,
  width: 900,
  depth: 350,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-450, 0, 900, 350);
      fan(ctx, 200, 175, 110);
      // louvred face over the coil, the half the fan does not occupy
      for (const x of [-360, -260, -160, -60, 40]) {
        ctx.moveTo(x, 50);
        ctx.lineTo(x, 300);
      }
      ctx.stroke();
    });
  },
};

const heatExchanger: SymbolDef = {
  type: "heat-exchanger",
  label: "Heat exchanger",
  category: "heating",
  wallMounted: true,
  width: 400,
  depth: 400,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-200, 0, 400, 400);
      circle(ctx, 0, 200, 110);
      // chevron: the direction heat crosses between the two circuits
      ctx.moveTo(-50, 130);
      ctx.lineTo(50, 200);
      ctx.lineTo(-50, 270);
      // the two circuits reaching the exchanger
      ctx.moveTo(-200, 200);
      ctx.lineTo(-110, 200);
      ctx.moveTo(110, 200);
      ctx.lineTo(200, 200);
      ctx.stroke();
    });
  },
};

const circulationPump: SymbolDef = {
  type: "circulation-pump",
  label: "Circulation pump",
  category: "heating",
  wallMounted: false,
  width: 460,
  depth: 280,
  draw(ctx) {
    withCtx(ctx, () => {
      circle(ctx, 0, 0, 130);
      // triangle pointing the way the pump delivers
      ctx.moveTo(-60, -80);
      ctx.lineTo(110, 0);
      ctx.lineTo(-60, 80);
      ctx.closePath();
      ctx.moveTo(-230, 0);
      ctx.lineTo(-130, 0);
      ctx.moveTo(130, 0);
      ctx.lineTo(230, 0);
      ctx.stroke();
    });
  },
};

const shutoffValve: SymbolDef = {
  type: "shutoff-valve",
  label: "Shut-off valve",
  category: "heating",
  wallMounted: false,
  width: 400,
  depth: 200,
  draw(ctx) {
    withCtx(ctx, () => {
      // Two triangles apex to apex on the pipe run.
      for (const sign of [-1, 1]) {
        ctx.moveTo(0, 0);
        ctx.lineTo(sign * 120, -90);
        ctx.lineTo(sign * 120, 90);
        ctx.closePath();
        ctx.moveTo(sign * 120, 0);
        ctx.lineTo(sign * 200, 0);
      }
      ctx.stroke();
    });
  },
};

export const SYMBOLS_HEATING: SymbolDef[] = [
  radiator,
  convector,
  convectorPit,
  floorHeating,
  cvBoiler,
  cvManifold,
  storageHeater,
  heatPump,
  heatPumpOutdoor,
  heatExchanger,
  expansionVessel,
  circulationPump,
  shutoffValve,
  tempSensor,
];
