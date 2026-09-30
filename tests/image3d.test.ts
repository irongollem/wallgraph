import { resolve3dSize } from "../src/io/image3d";

let failed = 0;
function check(name: string, ok: boolean): void {
  console.log(`${ok ? "ok" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}

const big = { maxRenderbuffer: 16384, maxViewport: [16384, 16384] as const };

const win = resolve3dSize("window", 800, 500, big);
check("window doubles the CSS size", win.w === 1600 && win.h === 1000);
const hd = resolve3dSize("hd", 800, 500, big);
check("hd is 1920x1080", hd.w === 1920 && hd.h === 1080);
const k4 = resolve3dSize("4k", 800, 500, big);
check("4k is 3840x2160", k4.w === 3840 && k4.h === 2160);

const small = { maxRenderbuffer: 2048, maxViewport: [4096, 4096] as const };
const capped = resolve3dSize("4k", 800, 500, small);
check("cap scales both sides", capped.w === 2048 && capped.h === 1152);
check("cap keeps the aspect", Math.abs(capped.w / capped.h - 3840 / 2160) < 0.01);

const narrow = { maxRenderbuffer: 16384, maxViewport: [1000, 8000] as const };
const v = resolve3dSize("window", 1000, 600, narrow);
check("viewport width limit applies", v.w <= 1000 && v.h <= 8000 && v.w === 1000 && v.h === 600);

const tall = resolve3dSize("window", 300, 3000, { maxRenderbuffer: 4096, maxViewport: [4096, 4096] });
check("never exceeds either cap", tall.w <= 4096 && tall.h <= 4096 && tall.h === 4096);
check("tall aspect kept", Math.abs(tall.w / tall.h - 0.1) < 0.002);

const degenerate = resolve3dSize("window", 0, 0, big);
check("zero CSS size stays positive", degenerate.w >= 1 && degenerate.h >= 1);

if (failed) process.exit(1);
