import { SymbolDef, withCtx } from "./defs";

// ---------------------------------------------------------------------------
// Safety (NEN 1414 style)
// ---------------------------------------------------------------------------
// Simplified line pictograms in the style of NEN 1414 safety signage.

const emergencyExit: SymbolDef = {
  type: "emergency-exit",
  label: "Emergency exit",
  category: "safety",
  wallMounted: true,
  width: 400,
  depth: 400,
  draw(ctx) {
    withCtx(ctx, () => {
      // outer square
      ctx.rect(-200, 0, 400, 400);
      // doorway
      ctx.moveTo(-60, 60);
      ctx.lineTo(-60, 340);
      // arrow shaft
      const tipX = 140;
      const tipY = 200;
      ctx.moveTo(-40, 200);
      ctx.lineTo(tipX, tipY);
      // arrowhead, two strokes at +/-35deg from the shaft direction
      const headLen = 60;
      for (const deg of [35, -35]) {
        const a = Math.PI + (deg * Math.PI) / 180; // reversed direction +/- offset
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX + Math.cos(a) * headLen, tipY + Math.sin(a) * headLen);
      }
      ctx.stroke();
    });
  },
};

const fireExtinguisher: SymbolDef = {
  type: "fire-extinguisher",
  label: "Extinguisher",
  category: "safety",
  wallMounted: true,
  width: 300,
  depth: 400,
  draw(ctx) {
    withCtx(ctx, () => {
      // vertical rounded-rectangle body
      const x0 = -70;
      const x1 = 70;
      const y0 = 80;
      const y1 = 340;
      const r = 40;
      ctx.moveTo(x0 + r, y0);
      ctx.lineTo(x1 - r, y0);
      ctx.arcTo(x1, y0, x1, y0 + r, r);
      ctx.lineTo(x1, y1 - r);
      ctx.arcTo(x1, y1, x1 - r, y1, r);
      ctx.lineTo(x0 + r, y1);
      ctx.arcTo(x0, y1, x0, y1 - r, r);
      ctx.lineTo(x0, y0 + r);
      ctx.arcTo(x0, y0, x0 + r, y0, r);
      ctx.closePath();
      // neck
      ctx.moveTo(0, 80);
      ctx.lineTo(0, 30);
      // handle
      ctx.moveTo(-50, 30);
      ctx.lineTo(50, 30);
      ctx.stroke();
    });
  },
};

const fireHose: SymbolDef = {
  type: "fire-hose",
  label: "Fire hose reel",
  category: "safety",
  wallMounted: true,
  width: 400,
  depth: 400,
  draw(ctx) {
    withCtx(ctx, () => {
      // outer square
      ctx.rect(-200, 0, 400, 400);
      // inner reel circle
      ctx.moveTo(130, 200);
      ctx.arc(0, 200, 130, 0, Math.PI * 2);
      // hose from the reel
      ctx.moveTo(0, 330);
      ctx.lineTo(120, 380);
      ctx.stroke();
    });
  },
};

const fireAlarm: SymbolDef = {
  type: "fire-alarm",
  label: "Alarm call point",
  category: "safety",
  wallMounted: true,
  width: 300,
  depth: 300,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-150, 0, 300, 300);
      ctx.stroke();
      // small filled dot at centre
      ctx.beginPath();
      ctx.arc(0, 150, 15, 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

const smokeDetector: SymbolDef = {
  type: "smoke-detector",
  label: "Smoke detector",
  category: "safety",
  wallMounted: false,
  width: 300,
  depth: 300,
  draw(ctx) {
    withCtx(ctx, () => {
      const r = 130;
      ctx.moveTo(r, 0);
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      // three radial ticks pointing away from the centre
      const tickLen = 60;
      for (const deg of [45, 90, 135]) {
        const a = (deg * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        ctx.moveTo(cos * r, sin * r);
        ctx.lineTo(cos * (r + tickLen), sin * (r + tickLen));
      }
      ctx.stroke();
      // small filled dot at centre
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

const heatDetector: SymbolDef = {
  type: "heat-detector",
  label: "Heat detector",
  category: "safety",
  wallMounted: false,
  width: 300,
  depth: 300,
  draw(ctx) {
    withCtx(ctx, () => {
      const r = 130;
      ctx.moveTo(r, 0);
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      // three radial ticks pointing away from the centre
      const tickLen = 60;
      for (const deg of [45, 90, 135]) {
        const a = (deg * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        ctx.moveTo(cos * r, sin * r);
        ctx.lineTo(cos * (r + tickLen), sin * (r + tickLen));
      }
      // small open triangle, apex up, centred at the origin, instead of a dot
      const side = 90;
      const h = (side * Math.sqrt(3)) / 2;
      const half = side / 2;
      const apexY = -(2 * h) / 3;
      const baseY = h / 3;
      ctx.moveTo(0, apexY);
      ctx.lineTo(half, baseY);
      ctx.lineTo(-half, baseY);
      ctx.closePath();
      ctx.stroke();
    });
  },
};

const coDetector: SymbolDef = {
  type: "co-detector",
  label: "CO detector",
  category: "safety",
  wallMounted: false,
  width: 300,
  depth: 300,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.moveTo(130, 0);
      ctx.arc(0, 0, 130, 0, Math.PI * 2);
      ctx.moveTo(70, 0);
      ctx.arc(0, 0, 70, 0, Math.PI * 2);
      ctx.stroke();
      // small filled centre dot
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

const alarmSounder: SymbolDef = {
  type: "alarm-sounder",
  label: "Alarm sounder",
  category: "safety",
  wallMounted: true,
  width: 300,
  depth: 300,
  draw(ctx) {
    withCtx(ctx, () => {
      // quarter-fan loudspeaker cone: two lines from a point near the wall,
      // angled +/-40deg off the forward (into-the-room) axis, closed by a
      // base line, plus two concentric sound-wave arcs beyond the fan.
      const apexX = 0;
      const apexY = 20;
      const len = 160;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const halfAngle = toRad(40);
      const dir1 = { x: Math.sin(halfAngle), y: Math.cos(halfAngle) };
      const dir2 = { x: -dir1.x, y: dir1.y };
      const end1 = { x: apexX + dir1.x * len, y: apexY + dir1.y * len };
      const end2 = { x: apexX + dir2.x * len, y: apexY + dir2.y * len };
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(end1.x, end1.y);
      ctx.lineTo(end2.x, end2.y);
      ctx.closePath();
      // sound waves, centred on the apex, spanning a bit wider than the fan
      const a1 = toRad(90 - 45);
      const a2 = toRad(90 + 45);
      ctx.moveTo(apexX + 200 * Math.cos(a1), apexY + 200 * Math.sin(a1));
      ctx.arc(apexX, apexY, 200, a1, a2);
      ctx.moveTo(apexX + 250 * Math.cos(a1), apexY + 250 * Math.sin(a1));
      ctx.arc(apexX, apexY, 250, a1, a2);
      ctx.stroke();
    });
  },
};

const alarmBeacon: SymbolDef = {
  type: "alarm-beacon",
  label: "Alarm beacon",
  category: "safety",
  wallMounted: true,
  width: 300,
  depth: 300,
  draw(ctx) {
    withCtx(ctx, () => {
      const cx = 0;
      const cy = 140;
      const r = 90;
      const rayLen = 50;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      for (let i = 0; i < 6; i++) {
        const a = (i * 60 * Math.PI) / 180;
        const sx = cx + r * Math.cos(a);
        const sy = cy + r * Math.sin(a);
        const ex = cx + (r + rayLen) * Math.cos(a);
        const ey = cy + (r + rayLen) * Math.sin(a);
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
      }
      ctx.stroke();
    });
  },
};

const firstAid: SymbolDef = {
  type: "first-aid",
  label: "First aid",
  category: "safety",
  wallMounted: true,
  width: 400,
  depth: 400,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-200, 0, 400, 400);
      ctx.stroke();
      // plus symbol, drawn heavier (lineWidth 40) then restored to 20
      ctx.lineWidth = 40;
      ctx.beginPath();
      ctx.moveTo(-100, 200);
      ctx.lineTo(100, 200);
      ctx.moveTo(0, 100);
      ctx.lineTo(0, 300);
      ctx.stroke();
      ctx.lineWidth = 20;
    });
  },
};

const assemblyPoint: SymbolDef = {
  type: "assembly-point",
  label: "Assembly point",
  category: "safety",
  wallMounted: false,
  width: 400,
  depth: 400,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-200, -200, 400, 400);
      const corners = [
        { x: -200, y: -200 },
        { x: 200, y: -200 },
        { x: 200, y: 200 },
        { x: -200, y: 200 },
      ];
      const shaftLen = 90;
      const headLen = 36;
      for (const c of corners) {
        const dist = Math.hypot(c.x, c.y);
        const dirX = -c.x / dist;
        const dirY = -c.y / dist;
        const tipX = c.x + dirX * shaftLen;
        const tipY = c.y + dirY * shaftLen;
        // arrow shaft, pointing inward from the corner
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(tipX, tipY);
        // arrowhead at the tip
        const a = Math.atan2(dirY, dirX);
        for (const off of [30, -30]) {
          const ha = a + Math.PI + (off * Math.PI) / 180;
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX + Math.cos(ha) * headLen, tipY + Math.sin(ha) * headLen);
        }
      }
      ctx.stroke();
      // filled centre dot
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

const fireBlanket: SymbolDef = {
  type: "fire-blanket",
  label: "Fire blanket",
  category: "safety",
  wallMounted: true,
  width: 300,
  depth: 400,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-150, 0, 300, 400);
      // diagonal fold line from the top-left corner to a point 120mm down
      // the right edge
      ctx.moveTo(-150, 0);
      ctx.lineTo(150, 120);
      ctx.stroke();
    });
  },
};

export const SYMBOLS_SAFETY: SymbolDef[] = [
  emergencyExit,
  fireExtinguisher,
  fireHose,
  fireAlarm,
  smokeDetector,
  heatDetector,
  coDetector,
  alarmSounder,
  alarmBeacon,
  firstAid,
  assemblyPoint,
  fireBlanket,
];
