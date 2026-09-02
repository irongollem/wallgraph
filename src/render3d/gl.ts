// Minimal WebGL1 renderer for one static mesh: flat-shaded triangles plus
// outline segments. Buffers re-upload only when the mesh generation moves.
//
// The light direction is constant in mesh space and shading uses the raw
// mesh normals — only positions go through the view-projection matrix, so no
// normal matrix exists and the lighting stays fixed to the building while
// the camera orbits.
import { COLORS } from "../render/draw";
import type { Mesh3D } from "./mesh";

/** Outline ink for edge segments. */
const INK = "#3a3a35";

/** Light direction in mesh space, normalised at use. Mostly vertical so
 *  horizontal faces read brightest; unequal x/y components keep the four
 *  wall orientations distinct. Shading is two-sided (|N·L|), so the sign
 *  does not matter and face culling stays off. */
const LX = 0.3, LY = 0.45, LZ = 0.84;
const LLEN = Math.hypot(LX, LY, LZ);

const TRI_VS = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uVP;
varying vec3 vNormal;
varying vec3 vColor;
void main() {
  gl_Position = uVP * vec4(aPosition, 1.0);
  vNormal = aNormal;
  vColor = aColor;
}`;

const TRI_FS = `
precision mediump float;
uniform vec3 uLightDir;
varying vec3 vNormal;
varying vec3 vColor;
void main() {
  float lit = 0.55 + 0.45 * abs(dot(normalize(vNormal), uLightDir));
  gl_FragColor = vec4(vColor * lit, 1.0);
}`;

const LINE_VS = `
attribute vec3 aPosition;
uniform mat4 uVP;
void main() { gl_Position = uVP * vec4(aPosition, 1.0); }`;

const LINE_FS = `
precision mediump float;
uniform vec3 uInk;
void main() { gl_FragColor = vec4(uInk, 1.0); }`;

interface Resources {
  tri: WebGLProgram;
  triPos: number;
  triNrm: number;
  triCol: number;
  triVP: WebGLUniformLocation | null;
  line: WebGLProgram;
  linePos: number;
  lineVP: WebGLUniformLocation | null;
  pos: WebGLBuffer;
  nrm: WebGLBuffer;
  col: WebGLBuffer;
  edge: WebGLBuffer;
}

export class GLRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private res: Resources | null = null;
  private lost = false;
  private mesh: Mesh3D | null = null;
  private generation = -1;
  private uploaded = -1;
  private triVerts = 0;
  private edgeVerts = 0;

  /** Throws when WebGL is unavailable; the caller decides what to show then. */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl", { antialias: true });
    if (!gl) throw new Error("WebGL unavailable");
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
    });
    this.res = this.build();
  }

  /** Stage a mesh; buffers upload on the next draw when `generation` moved. */
  upload(mesh: Mesh3D, generation: number): void {
    this.mesh = mesh;
    this.generation = generation;
  }

  /** Clear and draw the staged mesh through `viewProjection` (mm to clip). */
  draw(viewProjection: Float32Array): void {
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
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (this.triVerts > 0) {
      gl.useProgram(r.tri);
      gl.uniformMatrix4fv(r.triVP, false, viewProjection);
      // Faces are pushed back a fraction so the outlines never z-fight them.
      gl.enable(gl.POLYGON_OFFSET_FILL);
      attrib(gl, r.pos, r.triPos);
      attrib(gl, r.nrm, r.triNrm);
      attrib(gl, r.col, r.triCol);
      gl.drawArrays(gl.TRIANGLES, 0, this.triVerts);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    if (this.edgeVerts > 0) {
      gl.useProgram(r.line);
      gl.uniformMatrix4fv(r.lineVP, false, viewProjection);
      attrib(gl, r.edge, r.linePos);
      gl.drawArrays(gl.LINES, 0, this.edgeVerts);
    }
  }

  private uploadBuffers(r: Resources, m: Mesh3D): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, r.pos);
    gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.nrm);
    gl.bufferData(gl.ARRAY_BUFFER, m.normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.col);
    gl.bufferData(gl.ARRAY_BUFFER, m.colors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.edge);
    gl.bufferData(gl.ARRAY_BUFFER, m.edges, gl.STATIC_DRAW);
    this.triVerts = Math.floor(m.positions.length / 3);
    this.edgeVerts = Math.floor(m.edges.length / 3);
    this.uploaded = this.generation;
  }

  private build(): Resources {
    const gl = this.gl;
    const tri = link(gl, TRI_VS, TRI_FS);
    const line = link(gl, LINE_VS, LINE_FS);
    const mk = (): WebGLBuffer => {
      const b = gl.createBuffer();
      if (!b) throw new Error("buffer allocation failed");
      return b;
    };
    const [br, bg, bb] = rgb(COLORS.bg); // the 2D canvas paper
    gl.clearColor(br, bg, bb, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.polygonOffset(1, 1);
    // Light and ink never change; set them once per program build.
    gl.useProgram(tri);
    gl.uniform3f(gl.getUniformLocation(tri, "uLightDir"), LX / LLEN, LY / LLEN, LZ / LLEN);
    gl.useProgram(line);
    const [ir, ig, ib] = rgb(INK);
    gl.uniform3f(gl.getUniformLocation(line, "uInk"), ir, ig, ib);
    return {
      tri,
      triPos: gl.getAttribLocation(tri, "aPosition"),
      triNrm: gl.getAttribLocation(tri, "aNormal"),
      triCol: gl.getAttribLocation(tri, "aColor"),
      triVP: gl.getUniformLocation(tri, "uVP"),
      line,
      linePos: gl.getAttribLocation(line, "aPosition"),
      lineVP: gl.getUniformLocation(line, "uVP"),
      pos: mk(), nrm: mk(), col: mk(), edge: mk(),
    };
  }
}

function attrib(gl: WebGLRenderingContext, buf: WebGLBuffer, loc: number): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("shader allocation failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(String(gl.getShaderInfoLog(sh)));
  }
  return sh;
}

function link(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
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
