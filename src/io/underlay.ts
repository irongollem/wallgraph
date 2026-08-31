// Underlay image import: read a picked or pasted file, downscale it, and
// re-encode it as the data URL that lands in Floor.underlay.dataUrl.
//
// The dataUrl becomes part of the document, so its size is a real and
// ongoing cost: every autosave (localStorage, MB-order limits -- see
// io/json.ts's try/catch, which is what has to absorb a write that overflows
// it) and every JSON export carries it. Downscaling aggressively here, once,
// on import, is what keeps that cost bounded.
//
// Runs entirely on browser Canvas/Image/FileReader/Clipboard APIs and is not
// exercised by the node test suite -- CLAUDE.md's note that render code
// stays thin because it is not testable in node applies here too. See
// tests/underlay.test.ts for what IS covered: the pure calibration math in
// model/ops.ts and the schema/link rules around the field this produces.
import { Underlay } from "../model/doc";
import { Vec } from "../geometry/vec";

/** Longest edge after downscale, px. */
export const UNDERLAY_MAX_EDGE = 2000;
const UNDERLAY_JPEG_QUALITY = 0.8;
/**
 * The image's long edge spans about this many mm when first placed -- a
 * visibly wrong but workable default (see model/doc.ts's Underlay.mmPerPixel)
 * that calibration (Tools.startCalibration) corrects.
 */
const UNDERLAY_INITIAL_SPAN_MM = 10000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("underlay image failed to decode"));
    img.src = src;
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("underlay file failed to read"));
    reader.readAsDataURL(file);
  });
}

/** True if any pixel already drawn onto `ctx` is not fully opaque. */
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
  return false;
}

/**
 * Downscale `file` to at most UNDERLAY_MAX_EDGE on its long edge and
 * re-encode it as a data URL: JPEG at ~0.8 quality, unless the source is a
 * format that can carry transparency AND actually uses it, in which case PNG
 * keeps it. Null when the file could not be read as an image.
 */
export async function prepareUnderlayImage(
  file: Blob,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  let src: string;
  try { src = await readAsDataUrl(file); } catch { return null; }
  let img: HTMLImageElement;
  try { img = await loadImage(src); } catch { return null; }
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest === 0) return null;
  const scale = Math.min(1, UNDERLAY_MAX_EDGE / longest);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const sourceCanCarryAlpha = /^image\/(png|gif|webp)$/.test(file.type);
  const keepPng = sourceCanCarryAlpha && hasTransparency(ctx, w, h);
  const dataUrl = keepPng
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", UNDERLAY_JPEG_QUALITY);
  return { dataUrl, width: w, height: h };
}

/**
 * A freshly imported image, centred on `centerWorld` (mm -- the current
 * viewport centre, so it lands where the visitor is looking) and scaled so
 * its long edge spans about UNDERLAY_INITIAL_SPAN_MM.
 */
export function initialUnderlay(dataUrl: string, width: number, height: number, centerWorld: Vec): Underlay {
  const mmPerPixel = UNDERLAY_INITIAL_SPAN_MM / Math.max(width, height);
  const wMm = width * mmPerPixel, hMm = height * mmPerPixel;
  return {
    dataUrl,
    x: Math.round(centerWorld.x - wMm / 2),
    y: Math.round(centerWorld.y - hMm / 2),
    mmPerPixel,
    opacity: 1,
  };
}

/** File picker for an underlay image, images only. */
export function pickUnderlayImage(onPicked: (file: File) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onPicked(file);
  };
  input.click();
}

/** The first image among pasted clipboard items, or null. */
export function imageFromClipboard(e: ClipboardEvent): File | null {
  for (const item of e.clipboardData?.items ?? []) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}
