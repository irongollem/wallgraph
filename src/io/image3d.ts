// 3D still image.
//
// The view is re-rendered offscreen with its own renderer from the camera the
// screen shows, at the requested pixel size; the screen canvas is never read.
// The camera keeps its vertical field of view, so a different aspect changes
// the horizontal extent only.
import type { PlanDoc } from "../model/doc";
import { buildSceneMesh } from "../render3d/mesh";
import { GLRenderer } from "../render3d/gl";
import { sunDirection } from "../render3d/sun";
import type { View3DSnapshot } from "../render3d/view3d";
import { saveViaHost, downloadBlob } from "./save";
import type { PngResult } from "./image";

const FILENAME = "floorplan-3d.png";
/** Shadow map edge for a still, when the device allows it. */
const SHADOW_LARGE = 4096;
const SHADOW_FALLBACK = 2048;

export type Size3d = "window" | "hd" | "4k";

export interface SizeCaps {
  maxRenderbuffer: number;
  maxViewport: readonly [number, number];
}

const FIXED: Record<"hd" | "4k", readonly [number, number]> = {
  hd: [1920, 1080],
  "4k": [3840, 2160],
};

/**
 * Pixel size of a still. `window` is the canvas's CSS size doubled; `hd` and
 * `4k` are fixed. Both sides scale down together, keeping the aspect, until
 * neither exceeds the renderbuffer or viewport limit.
 */
export function resolve3dSize(kind: Size3d, cssW: number, cssH: number, caps: SizeCaps): { w: number; h: number } {
  const [bw, bh] = kind === "window" ? [Math.max(1, cssW) * 2, Math.max(1, cssH) * 2] : FIXED[kind];
  const limW = Math.min(caps.maxRenderbuffer, caps.maxViewport[0]);
  const limH = Math.min(caps.maxRenderbuffer, caps.maxViewport[1]);
  const k = Math.min(1, limW / bw, limH / bh);
  return {
    w: Math.min(limW, Math.max(1, Math.round(bw * k))),
    h: Math.min(limH, Math.max(1, Math.round(bh * k))),
  };
}

/** Render the current 3D view to a PNG and save it. */
export async function export3dPng(doc: PlanDoc, snap: View3DSnapshot, size: Size3d): Promise<PngResult> {
  let renderer: GLRenderer | null = null;
  try {
    const mesh = buildSceneMesh(doc, snap.hidden, { phase: snap.phase });
    if (!mesh.bounds) return "empty";
    // Device limits need a context; a throwaway canvas keeps the target's own
    // first getContext call the one that sets preserveDrawingBuffer.
    const probeCanvas = document.createElement("canvas");
    const probe = probeCanvas.getContext("webgl2");
    if (!probe) return "failed";
    const caps: SizeCaps = {
      maxRenderbuffer: probe.getParameter(probe.MAX_RENDERBUFFER_SIZE) as number,
      maxViewport: Array.from(probe.getParameter(probe.MAX_VIEWPORT_DIMS) as Int32Array) as [number, number],
    };
    const shadowSize = (probe.getParameter(probe.MAX_TEXTURE_SIZE) as number) >= SHADOW_LARGE
      ? SHADOW_LARGE : SHADOW_FALLBACK;
    probe.getExtension("WEBGL_lose_context")?.loseContext();

    const { w, h } = resolve3dSize(size, snap.cssWidth, snap.cssHeight, caps);
    const target = document.createElement("canvas");
    target.width = w;
    target.height = h;
    renderer = new GLRenderer(target, () => {}, { preserveDrawingBuffer: true, shadowSize });
    renderer.upload(mesh, 0, sunDirection(doc.northDeg));
    await renderer.texturesReady();
    renderer.draw(snap.camera.viewProjection(w / h), snap.camera.eye());

    if (await saveViaHost(FILENAME, () => target.toDataURL("image/png"))) return "saved";

    const blob = await new Promise<Blob | null>(res => target.toBlob(b => res(b), "image/png"));
    if (!blob) return "failed";
    if (downloadBlob(FILENAME, blob)) return "saved";
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return "copied";
    } catch { return "failed"; }
  } catch {
    return "failed";
  } finally {
    renderer?.dispose();
  }
}
