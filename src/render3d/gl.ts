// Minimal WebGL2 renderer for one static mesh: lit triangles with a shadow
// map, plus outline segments. Buffers re-upload only when the mesh generation
// moves, and the shadow map re-renders only when the mesh or the sun moves.
//
// The sun is constant in mesh space and shading uses the raw mesh normals —
// only positions go through the view-projection matrix, so no normal matrix
// exists and the lighting stays fixed to the building while the camera
// orbits. Every mesh face is part of a closed prism wound so its normal points
// outward (see mesh.ts), so shading uses the normal as it is and a back face
// is lit as the side it faces.
import { COLORS } from "../render/draw";
import type { Mesh3D } from "./mesh";
import { TEXTURE_LIMIT, TEXTURE_MAX_EDGE, type Texture } from "../model/appearance";
import { PATTERN_GLSL } from "./patterns";
import { lightProjection, type LightProjection, type Vec3T } from "./sun";

/** Outline ink for edge segments. */
const INK = "#3a3a35";

/** Shadow map edge in texels; the small size serves limited GPUs and compact views. */
const SHADOW_SIZE = 2048;
const SHADOW_SIZE_SMALL = 1024;
/** A canvas narrower than this (CSS px) is treated as a compact view. */
const COMPACT_CSS_WIDTH = 768;

export const TRI_VS = `#version 300 es
layout(location = 0) in vec3 aPosition;
in vec3 aNormal;
in vec3 aColor;
in vec4 aSurface;
uniform mat4 uVP;
uniform mat4 uLightVP;
uniform vec3 uLightDir;
uniform float uNormalOffset;
out vec3 vNormal;
out vec3 vColor;
out vec3 vWorld;
out vec3 vShadow;
flat out vec4 vSurface;
void main() {
  gl_Position = uVP * vec4(aPosition, 1.0);
  vNormal = aNormal;
  vColor = aColor;
  vSurface = aSurface;
  vWorld = aPosition;
  // Normal-offset lookup: move the sampled point off the surface by about a
  // texel, more on faces that graze the sun.
  float ndl = clamp(dot(aNormal, uLightDir), 0.0, 1.0);
  vec3 p = aPosition + aNormal * uNormalOffset * (1.0 + sqrt(1.0 - ndl * ndl));
  vShadow = (uLightVP * vec4(p, 1.0)).xyz * 0.5 + 0.5;
}`;

/** Depth-only pass into the shadow map. */
export const DEPTH_VS = `#version 300 es
layout(location = 0) in vec3 aPosition;
uniform mat4 uLightVP;
void main() { gl_Position = uLightVP * vec4(aPosition, 1.0); }`;

export const DEPTH_FS = `#version 300 es
precision highp float;
void main() {}`;

/** Opacity of the glass pass. Two-sided faces blend twice, so a pane reads
 *  a shade denser than this figure alone suggests. */
const GLASS_ALPHA = 0.45;

export const TRI_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
precision highp sampler2DArray;
uniform vec3 uLightDir;
uniform vec3 uEye;
uniform float uAlpha;
uniform sampler2DShadow uShadow;
uniform float uTexel;
uniform float uBias;
uniform float uShadowOn;
uniform sampler2DArray uTex;
uniform vec2 uTexSize[${TEXTURE_LIMIT}];
uniform float uTexReady;
in vec3 vNormal;
in vec3 vColor;
in vec3 vWorld;
in vec3 vShadow;
flat in vec4 vSurface;
out vec4 fragColor;
const vec3 SKY = vec3(0.78, 0.82, 0.88);
const vec3 GROUND = vec3(0.52, 0.49, 0.45);
const vec3 SUN = vec3(1.0, 0.96, 0.88);
const float AMBIENT = 0.9;
const float SUN_STRENGTH = 0.45;
${PATTERN_GLSL}
// Fraction of sun reaching the point: 3x3 taps over hardware-filtered
// comparisons, with a bias that grows as the face turns from the sun.
float sunVisible(float ndl) {
  vec3 c = vShadow;
  if (uShadowOn < 0.5 || c.z > 1.0 || c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) return 1.0;
  float tanT = sqrt(max(1.0 - ndl * ndl, 0.0)) / max(ndl, 0.05);
  float ref = c.z - uBias * (1.0 + min(tanT, 4.0));
  float s = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      s += texture(uShadow, vec3(c.xy + vec2(float(i), float(j)) * uTexel, ref));
    }
  }
  return s / 9.0;
}
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uEye - vWorld);
  float ndl = dot(n, uLightDir);
  vec3 ambient = mix(GROUND, SKY, n.z * 0.5 + 0.5) * AMBIENT;
  float vis = ndl > 0.0 ? sunVisible(ndl) : 0.0;
  vec3 diffuse = SUN * SUN_STRENGTH * max(ndl, 0.0) * vis;
  // Roughness (vSurface.x): low is a tight, stronger highlight, 0.9 and above
  // is matte; a negative value means none stated and reads as matte.
  float rough = vSurface.x < 0.0 ? 1.0 : vSurface.x;
  float gloss = 1.0 - smoothstep(0.3, 0.9, rough);
  vec3 h = normalize(uLightDir + v);
  float spec = gloss * 0.35 * pow(max(dot(n, h), 0.0), mix(12.0, 160.0, gloss)) * vis;
  // The pattern scales the resolved colour, so an override still tints it.
  int pid = int(vSurface.y + 0.5);
  vec3 albedo = vColor;
  vec2 uv = surfaceUV(n, vWorld);
  float fw = max(fwidth(uv.x), fwidth(uv.y)); // outside the branch: derivatives need uniform flow
  if (pid > 0) albedo *= patternTone(pid, uv, fw);
  // A texture layer (vSurface.w >= 0) replaces colour and pattern: the image,
  // one copy per uTexSize mm, is the albedo. v runs up the face and image rows
  // run down, hence the sign. Until the layers are uploaded the face is neutral.
  int layer = int(vSurface.w + 0.5);
  vec2 uvx = dFdx(uv), uvy = dFdy(uv);
  if (vSurface.w > -0.5) {
    if (uTexReady > 0.5) {
      vec2 sz = uTexSize[layer];
      vec2 k = vec2(1.0 / sz.x, -1.0 / sz.y);
      albedo = textureGrad(uTex, vec3(uv * k, float(layer)), uvx * k, uvy * k).rgb;
    } else albedo = vec3(0.75);
  }
  vec3 rgb = albedo * (ambient + diffuse) + SUN * spec;
  fragColor = vec4(min(rgb, vec3(1.0)), uAlpha);
}`;

export const LINE_VS = `#version 300 es
in vec3 aPosition;
uniform mat4 uVP;
void main() { gl_Position = uVP * vec4(aPosition, 1.0); }`;

export const LINE_FS = `#version 300 es
precision mediump float;
uniform vec3 uInk;
out vec4 fragColor;
void main() { fragColor = vec4(uInk, 1.0); }`;

interface Resources {
  tri: WebGLProgram;
  triPos: number;
  triNrm: number;
  triCol: number;
  triSrf: number;
  triVP: WebGLUniformLocation | null;
  triLightVP: WebGLUniformLocation | null;
  triAlpha: WebGLUniformLocation | null;
  triEye: WebGLUniformLocation | null;
  triTexel: WebGLUniformLocation | null;
  triBias: WebGLUniformLocation | null;
  triNormalOffset: WebGLUniformLocation | null;
  triLight: WebGLUniformLocation | null;
  triShadowOn: WebGLUniformLocation | null;
  triTexSize: WebGLUniformLocation | null;
  triTexReady: WebGLUniformLocation | null;
  line: WebGLProgram;
  linePos: number;
  lineVP: WebGLUniformLocation | null;
  depth: WebGLProgram;
  depthLightVP: WebGLUniformLocation | null;
  pos: WebGLBuffer;
  nrm: WebGLBuffer;
  col: WebGLBuffer;
  srf: WebGLBuffer;
  edge: WebGLBuffer;
  gpos: WebGLBuffer;
  gnrm: WebGLBuffer;
  gcol: WebGLBuffer;
  gsrf: WebGLBuffer;
  /** One vertex array per soup; attributes are bound once, at build. */
  triVao: WebGLVertexArrayObject;
  lineVao: WebGLVertexArrayObject;
  glassVao: WebGLVertexArrayObject;
  fbo: WebGLFramebuffer;
  shadowTex: WebGLTexture | null;
  shadowSize: number;
}

const SHADOW_UNIT = 0;
const TEXTURE_UNIT = 1;
const TEX_EDGE = TEXTURE_MAX_EDGE;
const TEX_LEVELS = Math.log2(TEX_EDGE) + 1;
const ANISOTROPY_EXT = "EXT_texture_filter_anisotropic";

/** What identifies a texture list for upload: ids, image sizes and real sizes. */
function textureKey(list: readonly Texture[]): string {
  return list.map(x => `${x.id}:${x.dataUrl.length}`).join("|");
}

/** Decode each image into a TEX_EDGE square canvas, stretched; the real-world
 *  size is carried by widthMm/heightMm, not by the pixel aspect. A failed
 *  decode leaves a mid-grey layer. */
async function decodeTextures(list: readonly Texture[]): Promise<HTMLCanvasElement[]> {
  return Promise.all(list.map(async tx => {
    const c = document.createElement("canvas");
    c.width = c.height = TEX_EDGE;
    const ctx = c.getContext("2d");
    if (!ctx) return c;
    ctx.fillStyle = "#bbb";
    ctx.fillRect(0, 0, TEX_EDGE, TEX_EDGE);
    try {
      const img = new Image();
      img.src = tx.dataUrl;
      await img.decode();
      ctx.drawImage(img, 0, 0, TEX_EDGE, TEX_EDGE);
    } catch { /* stays grey */ }
    return c;
  }));
}

export interface GLRendererOptions {
  /** Keep the drawing buffer after presenting, so toDataURL/toBlob read the frame. */
  preserveDrawingBuffer?: boolean;
  /** Shadow map edge in texels; absent chooses from the canvas and device limits. */
  shadowSize?: number;
  /** Called when a texture decode finishes and a redraw would show it. */
  onTexturesReady?: () => void;
}

export class GLRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private res: Resources | null = null;
  private lost = false;
  private mesh: Mesh3D | null = null;
  private generation = -1;
  private uploaded = -1;
  private sun: Vec3T = [0, 0, 1];
  private shadowGeneration = -1;
  private shadowSun = "";
  private light: LightProjection | null = null;
  private readonly fixedShadowSize: number;
  private triVerts = 0;
  private edgeVerts = 0;
  private glassVerts = 0;
  private readonly onTexturesReady: () => void;
  /** Key of the texture list the GL array holds, and of the one staged/decoded. */
  private texKey = "";
  private wantKey = "";
  private decoding = "";
  private decoded: { key: string; canvases: HTMLCanvasElement[] } | null = null;
  private texArray: WebGLTexture | null = null;
  private decodePromise: Promise<void> = Promise.resolve();

  /** Throws when WebGL is unavailable; the caller decides what to show then. */
  constructor(canvas: HTMLCanvasElement, onRestore: () => void = () => {}, options: GLRendererOptions = {}) {
    this.canvas = canvas;
    this.fixedShadowSize = options.shadowSize ?? 0;
    this.onTexturesReady = options.onTexturesReady ?? (() => {});
    const gl = canvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: options.preserveDrawingBuffer ?? false });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    // preventDefault signals the browser that the context should be restored.
    canvas.addEventListener("webglcontextlost", e => {
      e.preventDefault();
      this.lost = true;
      this.res = null;
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.res = null; // program and buffers rebuild on the next draw
      this.uploaded = -1;
      this.shadowGeneration = -1;
      this.texKey = "";
      this.texArray = null;
      onRestore();
    });
    this.res = this.build();
  }

  /** Delete the GL objects and release the context. The renderer is unusable afterwards. */
  dispose(): void {
    const gl = this.gl;
    const r = this.res;
    this.res = null;
    this.lost = true;
    if (r && !gl.isContextLost()) {
      gl.deleteProgram(r.tri);
      gl.deleteProgram(r.line);
      gl.deleteProgram(r.depth);
      for (const b of [r.pos, r.nrm, r.col, r.srf, r.edge, r.gpos, r.gnrm, r.gcol, r.gsrf]) gl.deleteBuffer(b);
      for (const v of [r.triVao, r.lineVao, r.glassVao]) gl.deleteVertexArray(v);
      gl.deleteFramebuffer(r.fbo);
      if (r.shadowTex) gl.deleteTexture(r.shadowTex);
      if (this.texArray) gl.deleteTexture(this.texArray);
    }
    this.texArray = null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  /** Stage a mesh and the unit vector toward the sun (mesh space). Buffers
   *  upload on the next draw when `generation` moved. */
  upload(mesh: Mesh3D, generation: number, sun: Vec3T = [0.3, 0.45, 0.84]): void {
    this.mesh = mesh;
    this.generation = generation;
    this.sun = sun;
    this.wantKey = textureKey(mesh.textures);
    if (this.wantKey !== "" && this.wantKey !== this.decoding && this.decoded?.key !== this.wantKey) {
      const key = this.wantKey;
      const list = mesh.textures;
      this.decoding = key;
      this.decodePromise = decodeTextures(list).then(canvases => {
        if (this.decoding !== key) return;
        this.decoded = { key, canvases };
        this.onTexturesReady();
      });
    }
  }

  /** Resolves once the textures of the staged mesh are decoded, so the next
   *  draw shows them. An offscreen still awaits this before drawing. */
  async texturesReady(): Promise<void> {
    await this.decodePromise;
  }

  /** Upload the decoded layers when they match the staged list. Returns whether
   *  the shader may sample them. */
  private syncTextures(): boolean {
    const gl = this.gl;
    if (this.wantKey === "") return false;
    if (this.texKey === this.wantKey && this.texArray) return true;
    if (!this.decoded || this.decoded.key !== this.wantKey) return false;
    const layers = this.decoded.canvases;
    const tex = gl.createTexture();
    if (!tex) return false;
    gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, TEX_LEVELS, gl.RGBA8, TEX_EDGE, TEX_EDGE, layers.length);
    layers.forEach((c, i) => {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, TEX_EDGE, TEX_EDGE, 1, gl.RGBA, gl.UNSIGNED_BYTE, c);
    });
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const aniso = gl.getExtension(ANISOTROPY_EXT) as { TEXTURE_MAX_ANISOTROPY_EXT: number; MAX_TEXTURE_MAX_ANISOTROPY_EXT: number } | null;
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, max));
    }
    if (this.texArray) gl.deleteTexture(this.texArray);
    this.texArray = tex;
    this.texKey = this.wantKey;
    return true;
  }

  /** Clear and draw the staged mesh through `viewProjection` (mm to clip),
   *  seen from `eye` in mesh space (the specular term reads it). */
  draw(viewProjection: Float32Array, eye: readonly [number, number, number] = [0, 0, 1e6]): void {
    if (this.lost) return;
    const gl = this.gl;
    if (!this.res) {
      try {
        this.res = this.build();
      } catch {
        this.lost = true;
        return;
      }
    }
    const r = this.res;
    if (this.mesh && this.uploaded !== this.generation) this.uploadBuffers(r, this.mesh);
    const shadowed = this.renderShadow(r);
    const texReady = this.syncTextures();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (this.triVerts > 0) {
      this.bindShading(r, viewProjection, eye, shadowed, 1, texReady);
      // Faces are pushed back a fraction so the outlines never z-fight them.
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.bindVertexArray(r.triVao);
      gl.drawArrays(gl.TRIANGLES, 0, this.triVerts);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    if (this.edgeVerts > 0) {
      gl.useProgram(r.line);
      gl.uniformMatrix4fv(r.lineVP, false, viewProjection);
      gl.bindVertexArray(r.lineVao);
      gl.drawArrays(gl.LINES, 0, this.edgeVerts);
    }
    // Glass last: blended over the opaque scene, depth-tested against it but
    // not written, so panes never mask each other out.
    if (this.glassVerts > 0) {
      this.bindShading(r, viewProjection, eye, shadowed, GLASS_ALPHA, texReady);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.bindVertexArray(r.glassVao);
      gl.drawArrays(gl.TRIANGLES, 0, this.glassVerts);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }

  /** Per-draw uniforms of the lit triangle program. */
  private bindShading(
    r: Resources, vp: Float32Array, eye: readonly [number, number, number], shadowed: boolean, alpha: number,
    texReady: boolean,
  ): void {
    const gl = this.gl;
    gl.useProgram(r.tri);
    gl.uniformMatrix4fv(r.triVP, false, vp);
    gl.uniform1f(r.triAlpha, alpha);
    gl.uniform3f(r.triEye, eye[0], eye[1], eye[2]);
    const [sx, sy, sz] = this.sun;
    gl.uniform3f(r.triLight, sx, sy, sz);
    gl.uniform1f(r.triShadowOn, shadowed && this.light ? 1 : 0);
    gl.uniform1f(r.triTexReady, texReady ? 1 : 0);
    if (texReady && this.mesh) {
      const sizes = new Float32Array(TEXTURE_LIMIT * 2);
      this.mesh.textures.forEach((x, i) => { sizes[i * 2] = x.widthMm; sizes[i * 2 + 1] = x.heightMm; });
      gl.uniform2fv(r.triTexSize, sizes);
      gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArray);
    }
    if (shadowed && this.light) {
      const texel = this.light.texelMm(r.shadowSize);
      gl.uniformMatrix4fv(r.triLightVP, false, this.light.matrix);
      gl.uniform1f(r.triTexel, 1 / r.shadowSize);
      gl.uniform1f(r.triBias, texel / this.light.depthMm);
      gl.uniform1f(r.triNormalOffset, texel * 1.5);
      gl.activeTexture(gl.TEXTURE0 + SHADOW_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, r.shadowTex);
    }
  }

  /**
   * Render opaque geometry into the shadow map when the mesh or the sun moved
   * since the last time. Glass is not drawn, so it casts nothing. Returns
   * false when there is nothing to shadow with, in which case the map is left
   * cleared (everything lit).
   */
  private renderShadow(r: Resources): boolean {
    const gl = this.gl;
    const b = this.mesh?.bounds;
    if (!b || this.triVerts === 0) return false;
    const size = this.shadowSize();
    const key = this.sun.map(c => c.toFixed(5)).join(",");
    if (r.shadowSize === size && this.shadowGeneration === this.generation && this.shadowSun === key) return true;
    if (r.shadowSize !== size || !r.shadowTex) this.allocShadow(r, size);
    this.light = lightProjection(b, this.sun);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo);
    gl.viewport(0, 0, size, size);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(r.depth);
    gl.uniformMatrix4fv(r.depthLightVP, false, this.light.matrix);
    // Push casters back so a lit face does not shadow itself.
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2, 4);
    gl.bindVertexArray(r.triVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.triVerts);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowGeneration = this.generation;
    this.shadowSun = key;
    return true;
  }

  private shadowSize(): number {
    const gl = this.gl;
    if (this.fixedShadowSize > 0) {
      return Math.min(this.fixedShadowSize, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    }
    const compact = this.canvas.clientWidth > 0 && this.canvas.clientWidth < COMPACT_CSS_WIDTH;
    const small = compact || (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) < 4096;
    return small ? SHADOW_SIZE_SMALL : SHADOW_SIZE;
  }

  private allocShadow(r: Resources, size: number): void {
    const gl = this.gl;
    if (r.shadowTex) gl.deleteTexture(r.shadowTex);
    const tex = gl.createTexture();
    if (!tex) throw new Error("texture allocation failed");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    r.shadowTex = tex;
    r.shadowSize = size;
  }

  private uploadBuffers(r: Resources, m: Mesh3D): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, r.pos);
    gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.nrm);
    gl.bufferData(gl.ARRAY_BUFFER, m.normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.col);
    gl.bufferData(gl.ARRAY_BUFFER, m.colors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.srf);
    gl.bufferData(gl.ARRAY_BUFFER, m.surfaces, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.edge);
    gl.bufferData(gl.ARRAY_BUFFER, m.edges, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.gpos);
    gl.bufferData(gl.ARRAY_BUFFER, m.glassPositions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.gnrm);
    gl.bufferData(gl.ARRAY_BUFFER, m.glassNormals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.gcol);
    gl.bufferData(gl.ARRAY_BUFFER, m.glassColors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.gsrf);
    gl.bufferData(gl.ARRAY_BUFFER, m.glassSurfaces, gl.STATIC_DRAW);
    this.triVerts = Math.floor(m.positions.length / 3);
    this.edgeVerts = Math.floor(m.edges.length / 3);
    this.glassVerts = Math.floor(m.glassPositions.length / 3);
    this.uploaded = this.generation;
  }

  private build(): Resources {
    const gl = this.gl;
    const tri = link(gl, TRI_VS, TRI_FS);
    const line = link(gl, LINE_VS, LINE_FS);
    const depth = link(gl, DEPTH_VS, DEPTH_FS);
    const mk = (): WebGLBuffer => {
      const b = gl.createBuffer();
      if (!b) throw new Error("buffer allocation failed");
      return b;
    };
    const [br, bg, bb] = rgb(COLORS.bg); // the 2D canvas paper
    gl.clearColor(br, bg, bb, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.polygonOffset(1, 1);
    // Ink and the sampler binding never change; set them once per program build.
    gl.useProgram(tri);
    gl.uniform1i(gl.getUniformLocation(tri, "uShadow"), SHADOW_UNIT);
    gl.uniform1i(gl.getUniformLocation(tri, "uTex"), TEXTURE_UNIT);
    gl.useProgram(line);
    const [ir, ig, ib] = rgb(INK);
    gl.uniform3f(gl.getUniformLocation(line, "uInk"), ir, ig, ib);
    const triPos = gl.getAttribLocation(tri, "aPosition");
    const triNrm = gl.getAttribLocation(tri, "aNormal");
    const triCol = gl.getAttribLocation(tri, "aColor");
    const triSrf = gl.getAttribLocation(tri, "aSurface");
    const linePos = gl.getAttribLocation(line, "aPosition");
    const [pos, nrm, col, srf, edge, gpos, gnrm, gcol, gsrf] = [mk(), mk(), mk(), mk(), mk(), mk(), mk(), mk(), mk()];
    const vao = (bindings: [WebGLBuffer, number, number?][]): WebGLVertexArrayObject => {
      const v = gl.createVertexArray();
      if (!v) throw new Error("vertex array allocation failed");
      gl.bindVertexArray(v);
      for (const [buf, loc, size] of bindings) attrib(gl, buf, loc, size);
      gl.bindVertexArray(null);
      return v;
    };
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error("framebuffer allocation failed");
    return {
      tri,
      triPos, triNrm, triCol, triSrf,
      triVP: gl.getUniformLocation(tri, "uVP"),
      triLightVP: gl.getUniformLocation(tri, "uLightVP"),
      triAlpha: gl.getUniformLocation(tri, "uAlpha"),
      triEye: gl.getUniformLocation(tri, "uEye"),
      triTexel: gl.getUniformLocation(tri, "uTexel"),
      triBias: gl.getUniformLocation(tri, "uBias"),
      triNormalOffset: gl.getUniformLocation(tri, "uNormalOffset"),
      triLight: gl.getUniformLocation(tri, "uLightDir"),
      triShadowOn: gl.getUniformLocation(tri, "uShadowOn"),
      triTexSize: gl.getUniformLocation(tri, "uTexSize"),
      triTexReady: gl.getUniformLocation(tri, "uTexReady"),
      line,
      linePos,
      lineVP: gl.getUniformLocation(line, "uVP"),
      depth,
      depthLightVP: gl.getUniformLocation(depth, "uLightVP"),
      pos, nrm, col, srf, edge, gpos, gnrm, gcol, gsrf,
      triVao: vao([[pos, triPos], [nrm, triNrm], [col, triCol], [srf, triSrf, 4]]),
      lineVao: vao([[edge, linePos]]),
      glassVao: vao([[gpos, triPos], [gnrm, triNrm], [gcol, triCol], [gsrf, triSrf, 4]]),
      fbo,
      shadowTex: null,
      shadowSize: 0,
    };
  }
}

/** A location of -1 means the compiler dropped the attribute; there is nothing to bind. */
function attrib(gl: WebGL2RenderingContext, buf: WebGLBuffer, loc: number, size = 3): void {
  if (loc < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("shader allocation failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(String(gl.getShaderInfoLog(sh)));
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error("program allocation failed");
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(String(gl.getProgramInfoLog(p)));
  }
  return p;
}

/** "#rrggbb" to channels in 0..1. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
