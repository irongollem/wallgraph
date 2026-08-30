import { SymbolDef, withCtx, circle, dot, rounded } from "./defs";

// ---------------------------------------------------------------------------
// Sanitary. Fixtures are drawn as the standard's plan marks: an outline at the
// fixture's own size, an inner bowl or basin where the fixture has one, and a
// filled dot at the drain.
// ---------------------------------------------------------------------------

const toilet: SymbolDef = {
  type: "toilet",
  label: "Toilet",
  category: "sanitary",
  wallMounted: true,
  width: 400,
  depth: 650,
  draw(ctx) {
    withCtx(ctx, () => {
      // Toilet, wc: cistern against the wall, bowl rounded at the free end.
      ctx.rect(-200, 0, 400, 180);
      rounded(ctx, -180, 180, 360, 470, 180);
      ctx.stroke();
    });
  },
};

const toiletConcealed: SymbolDef = {
  type: "toilet-concealed",
  label: "Toilet, concealed cistern",
  category: "sanitary",
  wallMounted: true,
  width: 500,
  depth: 620,
  draw(ctx) {
    withCtx(ctx, () => {
      // Toilet met ingebouwde stortbak: the cistern is a shallow band the full
      // width of the duct, the bowl hangs off it.
      ctx.rect(-250, 0, 500, 120);
      rounded(ctx, -180, 120, 360, 500, 180);
      ctx.stroke();
    });
  },
};

const toiletAccessible: SymbolDef = {
  type: "toilet-accessible",
  label: "Accessible toilet",
  category: "sanitary",
  wallMounted: true,
  width: 880,
  depth: 750,
  draw(ctx) {
    withCtx(ctx, () => {
      // Invalidentoilet: the toilet with a grab rail either side, at the
      // clearance the rails are set out to.
      ctx.rect(-250, 0, 500, 120);
      rounded(ctx, -180, 120, 360, 500, 180);
      for (const x of [-400, 400]) {
        ctx.moveTo(x - 40, 60);
        ctx.lineTo(x + 40, 60);
        ctx.moveTo(x, 60);
        ctx.lineTo(x, 700);
        ctx.moveTo(x - 40, 700);
        ctx.lineTo(x + 40, 700);
      }
      ctx.stroke();
    });
  },
};

const urinal: SymbolDef = {
  type: "urinal",
  label: "Urinal (wall)",
  category: "sanitary",
  wallMounted: true,
  width: 380,
  depth: 340,
  draw(ctx) {
    withCtx(ctx, () => {
      // Wandurinoir: flat against the wall, semicircular into the room.
      ctx.moveTo(-170, 0);
      ctx.lineTo(170, 0);
      ctx.lineTo(170, 90);
      ctx.arc(0, 90, 170, 0, Math.PI);
      ctx.lineTo(-170, 0);
      ctx.stroke();
      dot(ctx, 0, 120, 30);
    });
  },
};

const urinalStall: SymbolDef = {
  type: "urinal-stall",
  label: "Urinal (stall)",
  category: "sanitary",
  wallMounted: true,
  width: 1200,
  depth: 400,
  draw(ctx) {
    withCtx(ctx, () => {
      // Standurinoir: the trough, with the standing positions marked by the
      // divider zigzag along its length.
      ctx.rect(-600, 0, 1200, 400);
      ctx.moveTo(-600, 0);
      for (let i = 0; i < 3; i++) {
        const x0 = -600 + i * 400;
        ctx.lineTo(x0 + 200, 340);
        ctx.lineTo(x0 + 400, 0);
      }
      ctx.stroke();
      dot(ctx, 480, 300, 30);
    });
  },
};

const bidet: SymbolDef = {
  type: "bidet",
  label: "Bidet",
  category: "sanitary",
  wallMounted: true,
  width: 380,
  depth: 600,
  draw(ctx) {
    withCtx(ctx, () => {
      // Bidet: the outline with its bowl inset, drain at the wall end.
      rounded(ctx, -190, 0, 380, 600, 150);
      rounded(ctx, -130, 90, 260, 420, 110);
      ctx.stroke();
      dot(ctx, 0, 170, 30);
    });
  },
};

/** Wastafel: counter, inset basin, drain. */
function basin(ctx: CanvasRenderingContext2D, x: number, w: number, d: number): void {
  const inset = Math.min(60, w / 6);
  ctx.rect(x - w / 2, 0, w, d);
  ctx.rect(x - w / 2 + inset, inset, w - 2 * inset, d - 2 * inset);
}

const sink: SymbolDef = {
  type: "sink",
  label: "Wash basin",
  category: "sanitary",
  wallMounted: true,
  width: 600,
  depth: 450,
  draw(ctx) {
    withCtx(ctx, () => {
      basin(ctx, 0, 600, 450);
      ctx.stroke();
      dot(ctx, 0, 225, 30);
    });
  },
};

const sinkDouble: SymbolDef = {
  type: "sink-double",
  label: "Double wash basin",
  category: "sanitary",
  wallMounted: true,
  width: 1200,
  depth: 450,
  draw(ctx) {
    withCtx(ctx, () => {
      // Wastafel, dubbel: two basins in one counter run.
      basin(ctx, -300, 600, 450);
      basin(ctx, 300, 600, 450);
      ctx.stroke();
      dot(ctx, -300, 225, 30);
      dot(ctx, 300, 225, 30);
    });
  },
};

const handBasin: SymbolDef = {
  type: "hand-basin",
  label: "Hand basin",
  category: "sanitary",
  wallMounted: true,
  width: 400,
  depth: 300,
  draw(ctx) {
    withCtx(ctx, () => {
      basin(ctx, 0, 400, 300);
      ctx.stroke();
      dot(ctx, 0, 150, 25);
    });
  },
};

const basinTrough: SymbolDef = {
  type: "basin-trough",
  label: "Trough basin",
  category: "sanitary",
  wallMounted: true,
  width: 1800,
  depth: 500,
  draw(ctx) {
    withCtx(ctx, () => {
      // Wastafel, meervoudig (trog): one trough, a tap cross per position,
      // one drain.
      ctx.rect(-900, 0, 1800, 500);
      for (const x of [-560, 0, 560]) {
        ctx.moveTo(x - 50, 130);
        ctx.lineTo(x + 50, 130);
        ctx.moveTo(x, 80);
        ctx.lineTo(x, 180);
      }
      ctx.stroke();
      dot(ctx, 700, 370, 30);
    });
  },
};

const bath: SymbolDef = {
  type: "bath",
  label: "Bathtub",
  category: "sanitary",
  wallMounted: true,
  width: 1700,
  depth: 750,
  draw(ctx) {
    withCtx(ctx, () => {
      // Bad, badkuip: rim and inner tub, drain at the tap end.
      ctx.rect(-850, 0, 1700, 750);
      rounded(ctx, -770, 80, 1540, 590, 150);
      ctx.stroke();
      dot(ctx, -640, 375, 35);
    });
  },
};

const shower: SymbolDef = {
  type: "shower",
  label: "Shower area",
  category: "sanitary",
  wallMounted: true,
  width: 900,
  depth: 900,
  draw(ctx) {
    withCtx(ctx, () => {
      // Douchehoek / stortbad: the wet area with its drain, no tray.
      ctx.rect(-450, 0, 900, 900);
      ctx.stroke();
      dot(ctx, -280, 200, 40);
    });
  },
};

const showerTray: SymbolDef = {
  type: "shower-tray",
  label: "Shower tray",
  category: "sanitary",
  wallMounted: true,
  width: 900,
  depth: 900,
  draw(ctx) {
    withCtx(ctx, () => {
      // Douchebak: the tray inside its enclosure, drain in one corner.
      ctx.rect(-450, 0, 900, 900);
      rounded(ctx, -390, 60, 780, 780, 100);
      ctx.stroke();
      dot(ctx, -280, 200, 40);
    });
  },
};

const showerDrain: SymbolDef = {
  type: "shower-drain",
  label: "Shower tray, linear drain",
  category: "sanitary",
  wallMounted: true,
  width: 900,
  depth: 900,
  draw(ctx) {
    withCtx(ctx, () => {
      // Douchebak met gootdrain: the drain runs the depth of one side rather
      // than collecting at a point.
      ctx.rect(-450, 0, 900, 900);
      rounded(ctx, -390, 60, 780, 780, 100);
      ctx.rect(-360, 250, 90, 400);
      ctx.moveTo(-500, 450);
      ctx.lineTo(-200, 450);
      ctx.stroke();
    });
  },
};

const showerHead: SymbolDef = {
  type: "shower-head",
  label: "Shower head",
  category: "sanitary",
  wallMounted: true,
  width: 400,
  depth: 400,
  draw(ctx) {
    withCtx(ctx, () => {
      // Douche: the head seen from above, spraying.
      const cy = 200, r = 90;
      circle(ctx, 0, cy, r);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.moveTo(Math.cos(a) * (r + 30), cy + Math.sin(a) * (r + 30));
        ctx.lineTo(Math.cos(a) * (r + 105), cy + Math.sin(a) * (r + 105));
      }
      ctx.stroke();
    });
  },
};

export const SYMBOLS_SANITARY: SymbolDef[] = [
  toilet,
  toiletConcealed,
  toiletAccessible,
  urinal,
  urinalStall,
  bidet,
  sink,
  sinkDouble,
  handBasin,
  basinTrough,
  bath,
  shower,
  showerTray,
  showerDrain,
  showerHead,
];
