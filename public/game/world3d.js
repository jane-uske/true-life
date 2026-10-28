// 3D 渲染：穹顶小镇、方块小人、像素化后处理、偷拍画中画。
// 画面先渲染到一张低分辨率画布（每个像素约 3 个屏幕像素），再加描边并用最近邻放大，看起来就是像素画。
import * as THREE from '../vendor/three.module.min.js';
import {
  DEG, ISLAND_R, SAND_R, DOME_R, RING_R, SPOT_R, GROUND_Y, PIER_Y, BRIDGE_Y, LOCS, FILLERS,
} from './data.js';
import { polar, clamp } from './engine.js';

THREE.ColorManagement.enabled = false;
const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const BG = new THREE.Color('#0b1120');
const BASE_VIEW_H = 110;
const dirAz = a => new V3(Math.cos(a * DEG), 0, Math.sin(a * DEG));

function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 时间调色板 ----------
const KEYS = [
  // 小时, 穹顶顶部, 地平线, 日光颜色, 日光强度, 天光, 地面反光, 环境强度, 夜晚程度
  [0, '#0b1330', '#1c2a52', '#9fb4ff', 0.55, '#3a4a7a', '#1a2030', 0.95, 1],
  [5, '#1a2450', '#3c4a7a', '#a8b8ff', 0.5, '#4a5a8a', '#20283a', 0.95, 1],
  [6.5, '#6f8fd0', '#f8c7a0', '#ffd2a6', 1.7, '#b8c8e8', '#6a5a50', 1.15, 0.3],
  [9, '#5fb6e8', '#d3edf8', '#fff6e6', 2.5, '#dff0ff', '#8a9a7a', 1.35, 0],
  [16, '#5fb6e8', '#d3edf8', '#fff2dc', 2.4, '#dff0ff', '#8a9a7a', 1.35, 0],
  [18.5, '#3a4a8a', '#f2a47e', '#ffb38a', 1.7, '#c0a8c8', '#6a5060', 1.15, 0.25],
  [20, '#1a2050', '#4a3e6a', '#a8b0ff', 0.7, '#5a5a8a', '#252838', 1.0, 0.85],
  [24, '#0b1330', '#1c2a52', '#9fb4ff', 0.55, '#3a4a7a', '#1a2030', 0.95, 1],
].map(k => ({ h: k[0], top: new THREE.Color(k[1]), hor: new THREE.Color(k[2]), sun: new THREE.Color(k[3]), sunI: k[4], sky: new THREE.Color(k[5]), gnd: new THREE.Color(k[6]), hemiI: k[7], night: k[8] }));

function skyAt(h) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = clamp((h - a.h) / (b.h - a.h), 0, 1);
  const c = (k) => a[k].clone().lerp(b[k], t);
  const n = (k) => a[k] + (b[k] - a[k]) * t;
  return { top: c('top'), hor: c('hor'), sun: c('sun'), sunI: n('sunI'), sky: c('sky'), gnd: c('gnd'), hemiI: n('hemiI'), night: n('night') };
}

// 太阳是挂在穹顶轨道上的一盏灯：6 点从东边升起，18:30 落下，正午偏向镜头一侧，让朝向镜头的墙面被照亮
const SUN_A = dirAz(300);
const SUN_C = new V3(0, 0.85, 0).add(dirAz(30).multiplyScalar(0.5)).normalize();
const MOON = new V3(0, 0.8, 0).add(dirAz(80).multiplyScalar(0.6)).normalize();
function sunDir(h) {
  const ang = ((h - 6) / 12.5) * Math.PI;
  return SUN_A.clone().multiplyScalar(Math.cos(ang)).add(SUN_C.clone().multiplyScalar(Math.sin(ang))).normalize();
}

// ---------- 着色器 ----------
const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

const DOME_VS = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const DOME_FS = `
uniform vec3 uTop, uHor, uSunDir, uSunCol;
uniform float uSus, uTime, uNight;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x), mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), f.x), f.y); }
void main(){
  vec3 d = normalize(vDir);
  float el = asin(clamp(d.y, 0., 1.));
  float az = atan(d.z, d.x);
  float t = el / 1.5708;
  vec3 col = mix(uHor, uTop, smoothstep(0., .85, t));
  // 画上去的云
  vec2 cp = vec2(az * 3. + uTime * .004, el * 6.);
  float c = noise(cp * 1.3) * .6 + noise(cp * 2.7) * .4;
  c = smoothstep(.58, .72, c) * (1. - smoothstep(.5, .9, t)) * (1. - uNight * .75);
  col = mix(col, mix(vec3(1.), uHor, .2), c * .85);
  // 星星（也是画的）
  col += step(.996, hash(floor(vec2(az * 90., el * 90.)))) * uNight * .8;
  // 太阳灯
  float sd = dot(d, uSunDir);
  col += uSunCol * smoothstep(.986, .993, sd) * (1. - uNight);
  col += uSunCol * pow(max(sd, 0.), 30.) * .3 * (1. - uNight);
  // 面板网格：怀疑值越高，接缝越明显，坏掉的面板越多
  vec2 g = vec2((az + 3.14159) / 6.28318 * 48., t * 12.);
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float h = hash(cell);
  float edge = min(min(f.x, 1. - f.x), min(f.y, 1. - f.y));
  float seam = 1. - smoothstep(.0, .045, edge);
  col = mix(col, col * 1.18 + .04, seam * (.05 + uSus * .55));
  float s2 = uSus * uSus;
  if (h < s2 * .32) {
    float flick = step(.45, hash(cell + floor(uTime * 5.)));
    vec3 back = vec3(.07, .09, .13) + step(.86, fract(f.x * 5.)) * .07 + step(.86, fract(f.y * 3.)) * .05;
    float k = h < s2 * .1 ? 1. : .35 + .5 * flick;
    col = mix(col, back, k);
  }
  col *= 1. + (h - .5) * .05 * uSus;
  gl_FragColor = vec4(col, 1.);
}`;

const WATER_VS = `varying vec2 vXZ; void main(){ vXZ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const WATER_FS = `
uniform float uTime, uNight;
uniform vec3 uDeep, uShallow, uFoam;
varying vec2 vXZ;
void main(){
  float r = length(vXZ);
  float shore = 1. - smoothstep(${SAND_R.toFixed(1)}, 56., r);
  vec3 col = mix(uDeep, uShallow, shore * .8);
  float ring = sin(r * 2.2 - uTime * 1.5);
  float foam = step(.86, ring) * (1. - smoothstep(${(SAND_R + 0.1).toFixed(1)}, 51.5, r)) * step(${SAND_R.toFixed(1)}, r);
  col = mix(col, uFoam, foam * .85);
  vec2 cell = floor(vXZ * 1.1);
  col += step(.993, fract(sin(dot(cell, vec2(12.9898, 78.233)) + floor(uTime * 2.)) * 43758.5453)) * .3 * (1. - uNight * .6);
  col += .035 * step(.94, sin(vXZ.x * .55 + uTime * .7 + sin(vXZ.y * .35)));
  gl_FragColor = vec4(col, 1.);
}`;

const POST_FS = `
uniform sampler2D tColor, tDepth, tNormal;
uniform vec2 uRes, uScale, uOffset;
uniform float uNear, uFar, uDepthTh;
varying vec2 vUv;
float lin(float z){ return uNear + z * (uFar - uNear); }
float D(vec2 uv){ return lin(texture2D(tDepth, uv).x); }
vec4 N(vec2 uv){ vec4 n = texture2D(tNormal, uv); return vec4(n.xyz * 2. - 1., n.a); }
void main(){
  vec2 uv = vUv * uScale + uOffset / uRes;
  vec2 tc = (floor(uv * uRes) + .5) / uRes;
  vec2 px = 1. / uRes;
  vec3 col = texture2D(tColor, tc).rgb;
  vec4 n = N(tc);
  if (n.a > .5) {
    float d = D(tc);
    float de = 0., ne = 0.;
    vec2 o[4];
    o[0] = vec2(px.x, 0.); o[1] = vec2(-px.x, 0.); o[2] = vec2(0., px.y); o[3] = vec2(0., -px.y);
    for (int i = 0; i < 4; i++) {
      float dn = D(tc + o[i]);
      de += clamp(dn - d, 0., 8.);
      vec4 nn = N(tc + o[i]);
      ne += step(-.1, dn - d) * nn.a * clamp(1. - dot(n.xyz, nn.xyz), 0., 1.);
    }
    float depthEdge = step(uDepthTh, de);
    float normEdge = step(.4, ne) * (1. - depthEdge);
    col = mix(col, col * .42, depthEdge);
    col = mix(col, min(col * 1.22 + .03, vec3(1.)), normEdge * .7);
  }
  gl_FragColor = vec4(col, 1.);
}`;

const CRT_FS = `
uniform sampler2D tColor, tDepth;
uniform vec2 uRes;
uniform float uNear, uFar, uTime;
varying vec2 vUv;
float lin(float z){ float ndc = z * 2. - 1.; return 2. * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear)); }
void main(){
  vec2 c = vUv - .5;
  vec2 uv = .5 + c * (1. + dot(c, c) * .18);
  if (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1.) { gl_FragColor = vec4(0., 0., 0., 1.); return; }
  vec2 tc = (floor(uv * uRes) + .5) / uRes;
  vec2 px = 1. / uRes;
  vec3 col = texture2D(tColor, tc).rgb;
  float d = lin(texture2D(tDepth, tc).x);
  float de = 0.;
  de += clamp(lin(texture2D(tDepth, tc + vec2(px.x, 0.)).x) - d, 0., 4.);
  de += clamp(lin(texture2D(tDepth, tc - vec2(px.x, 0.)).x) - d, 0., 4.);
  de += clamp(lin(texture2D(tDepth, tc + vec2(0., px.y)).x) - d, 0., 4.);
  de += clamp(lin(texture2D(tDepth, tc - vec2(0., px.y)).x) - d, 0., 4.);
  col = mix(col, col * .45, step(.6 + d * .05, de));
  float g = dot(col, vec3(.3, .59, .11));
  col = mix(col, vec3(g) * vec3(.92, 1.04, .96), .35);
  col *= .9 + .1 * sin(uv.y * uRes.y * 3.14159);
  col += (fract(sin(dot(floor(uv * uRes * 2.), vec2(12.9898, 78.233)) + uTime * 7.) * 43758.5453) - .5) * .06;
  col *= 1. - dot(c, c) * 1.1;
  gl_FragColor = vec4(col, 1.);
}`;

// ---------- 材质与静态合批 ----------
function gradientMap() {
  const t = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

const GLOW = { win: '#ffd98a', lamp: '#fff1b8', warm: '#ffc870', rimR: '#ff4d4f', rimW: '#ffffff', door: '#8fd3ff' };
class Mats {
  constructor() { this.grad = gradientMap(); this.map = new Map(); }
  get(color, kind = '') {
    const key = `${color}|${kind}`;
    let m = this.map.get(key);
    if (!m) {
      m = new THREE.MeshToonMaterial({ color, gradientMap: this.grad });
      if (kind) { m.emissive = new THREE.Color(GLOW[kind] || '#ffffff'); m.emissiveIntensity = 0; m.userData.kind = kind; }
      this.map.set(key, m);
    }
    return m;
  }
}

class Batch {
  constructor() { this.b = new Map(); }
  add(geo, matrix, color, kind = '') {
    const key = `${color}|${kind}`;
    let e = this.b.get(key);
    if (!e) { e = { color, kind, pos: [], nor: [] }; this.b.set(key, e); }
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { e.pos.push(p[i]); e.nor.push(n[i]); }
    g.dispose();
    geo.dispose();
  }
  build(scene, mats) {
    for (const e of this.b.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(e.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(e.nor, 3));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats.get(e.color, e.kind));
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    }
  }
}

// 在某个位置和朝向下摆放零件。局部 +z 是建筑正面。
function frame(batch, x, z, rotY, y0 = 0) {
  const base = new THREE.Matrix4().compose(new V3(x, y0, z), new THREE.Quaternion().setFromAxisAngle(UP, rotY), new V3(1, 1, 1));
  const put = (geo, lx, ly, lz, color, o = {}) => {
    const L = new THREE.Matrix4().compose(new V3(lx, ly, lz), new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0)), new V3(1, 1, 1));
    batch.add(geo, base.clone().multiply(L), color, o.kind);
  };
  return {
    box: (w, h, d, color, lx, ly, lz, o) => put(new THREE.BoxGeometry(w, h, d), lx, ly + h / 2, lz, color, o),
    cyl: (rt, rb, h, seg, color, lx, ly, lz, o) => put(new THREE.CylinderGeometry(rt, rb, h, seg), lx, ly + h / 2, lz, color, o),
    geo: (g, color, lx, ly, lz, o) => put(g, lx, ly, lz, color, o),
  };
}
const faceCenter = a => Math.atan2(-Math.cos(a * DEG), -Math.sin(a * DEG));
const faceOut = a => Math.atan2(Math.cos(a * DEG), Math.sin(a * DEG));

function roofGeo(w, h, d) {
  const s = new THREE.Shape();
  s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(0, h); s.lineTo(-d / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  g.translate(-w / 2, 0, 0);
  return g;
}
function sailGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(0, 2.6); s.lineTo(1.6, 0); s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  return g;
}

// ---------- 建筑 ----------
function home(F, wall, roof, w = 7, h = 4, d = 6, fence = true) {
  F.box(w, h, d, wall, 0, 0, 0);
  F.geo(roofGeo(w + 0.8, 2.4 + h * 0.05, d + 0.8), roof, 0, h, 0);
  F.box(1.2, 2.1, 0.2, '#8a5a44', 0, 0, d / 2 + 0.05);
  F.box(1.3, 1.0, 0.15, '#e3f3fb', -w * 0.3, h * 0.48, d / 2 + 0.05, { kind: 'win' });
  F.box(1.3, 1.0, 0.15, '#e3f3fb', w * 0.3, h * 0.48, d / 2 + 0.05, { kind: 'win' });
  if (h > 4.5) {
    F.box(1.3, 1.0, 0.15, '#e3f3fb', -w * 0.3, h * 0.78, d / 2 + 0.05, { kind: 'win' });
    F.box(1.3, 1.0, 0.15, '#e3f3fb', w * 0.3, h * 0.78, d / 2 + 0.05, { kind: 'win' });
  }
  if (!fence) return;
  for (let x = -w / 2 - 0.4; x <= w / 2 + 0.41; x += 0.8) {
    if (Math.abs(x) < 1) continue;
    F.box(0.18, 0.8, 0.18, '#ffffff', x, 0, d / 2 + 1.6);
  }
  F.box(w / 2 - 0.6, 0.12, 0.12, '#ffffff', -(w / 4 + 0.6), 0.55, d / 2 + 1.6);
  F.box(w / 2 - 0.6, 0.12, 0.12, '#ffffff', w / 4 + 0.6, 0.55, d / 2 + 1.6);
}

function buildTown(batch, anchors) {
  const at = (name) => { const L = LOCS[name]; const p = polar(L.a, L.r); return { ...p, a: L.a }; };

  // 家
  { const p = at('家'); const F = frame(batch, p.x, p.z, faceCenter(p.a), GROUND_Y);
    home(F, '#f5c3bc', '#d9787a');
    F.box(0.8, 1.6, 0.8, '#b86b6b', 1.8, 4.6, -1.2);
    F.box(0.3, 1.1, 0.3, '#55627a', 3.6, 0, 4.6); F.box(0.7, 0.5, 0.5, '#e4576e', 3.6, 1.1, 4.6); }

  // 报刊亭
  { const p = at('报刊亭'); const F = frame(batch, p.x, p.z, faceCenter(p.a), GROUND_Y);
    F.box(3.2, 2.4, 2.6, '#a6dccb', 0, 0, 0);
    F.box(3.8, 0.3, 0.8, '#6f8f86', 0, 1.0, 1.6);
    ['#f2a541', '#8fd3ff', '#e4576e', '#7cc58f', '#b49be0'].forEach((c, i) => F.box(0.45, 0.6, 0.1, c, -1.2 + i * 0.6, 1.3, 1.75, { rx: -0.25 }));
    for (let i = 0; i < 6; i++) F.box(3.8 / 6, 0.1, 1.5, i % 2 ? '#ffffff' : '#e4576e', -1.9 + 3.8 / 12 + (i * 3.8) / 6, 2.3, 1.55, { rx: 0.35 });
    F.box(2.6, 0.6, 0.2, '#2b3a55', 0, 2.4, 0); }

  // 保险公司
  { const p = at('保险公司'); const F = frame(batch, p.x, p.z, faceCenter(p.a), GROUND_Y);
    F.box(7, 10, 7, '#f4e2a3', 0, 0, 0);
    F.box(7.3, 1.2, 7.3, '#2f5d8a', 0, 10, 0);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      F.box(1.0, 1.3, 0.12, '#dcefff', -2.4 + c * 1.6, 2.8 + r * 1.8, 3.55, { kind: 'win' });
      F.box(0.12, 1.3, 1.0, '#dcefff', 3.55, 2.8 + r * 1.8, -2.4 + c * 1.6, { kind: 'win' });
      F.box(0.12, 1.3, 1.0, '#dcefff', -3.55, 2.8 + r * 1.8, -2.4 + c * 1.6, { kind: 'win' });
    }
    F.box(2.0, 2.3, 0.15, '#bfe0f2', 0, 0, 3.55);
    F.cyl(1, 1, 1.6, 10, '#9aa6b5', 1.8, 11.2, -1.5); }

  // 小酒馆
  { const p = at('小酒馆'); const F = frame(batch, p.x, p.z, faceCenter(p.a), GROUND_Y);
    F.box(7, 4.5, 6, '#cdb9e7', 0, 0, 0);
    F.box(7.4, 0.6, 6.4, '#a48bcb', 0, 4.5, 0);
    F.box(2.8, 1.6, 0.15, '#ffd98a', -1.6, 1.4, 3.05, { kind: 'warm' });
    F.box(1.3, 2.3, 0.2, '#6b4a6e', 1.9, 0, 3.05);
    F.box(2.4, 0.8, 0.15, '#3b3542', 0, 3.3, 3.2);
    F.cyl(0.45, 0.45, 0.9, 8, '#9b7350', -3.0, 0, 3.7); F.cyl(0.45, 0.45, 0.9, 8, '#9b7350', -2.1, 0, 4.0); }

  // 广场
  { const F = frame(batch, 0, 0, 0, GROUND_Y);
    F.cyl(9, 9, 0.04, 40, '#e9e2d2', 0, 0, 0);
    F.cyl(2.6, 2.8, 0.7, 16, '#d7eef6', 0, 0, 0);
    F.cyl(2.2, 2.2, 0.1, 16, '#8fd3ea', 0, 0.62, 0);
    F.cyl(0.35, 0.45, 1.9, 8, '#d7eef6', 0, 0.6, 0);
    F.cyl(1.1, 0.6, 0.3, 10, '#d7eef6', 0, 2.4, 0);
    F.box(0.3, 4.2, 0.3, '#55627a', -5.5, 0, -5.5); F.box(1.1, 1.1, 0.5, '#ffffff', -5.5, 4.2, -5.5);
    F.box(2.2, 0.15, 0.7, '#b9875a', 5.4, 0.55, -2.2); F.box(0.15, 0.55, 0.6, '#55627a', 4.5, 0, -2.2); F.box(0.15, 0.55, 0.6, '#55627a', 6.3, 0, -2.2);
    F.box(0.7, 0.15, 2.2, '#b9875a', -2.2, 0.55, 5.4); F.box(0.6, 0.55, 0.15, '#55627a', -2.2, 0, 4.5); F.box(0.6, 0.55, 0.15, '#55627a', -2.2, 0, 6.3); }

  // 海滩
  { const p = at('海滩'); const F = frame(batch, p.x, p.z, faceCenter(p.a), GROUND_Y);
    F.cyl(0.1, 0.1, 2.6, 6, '#7a6552', -2.6, 0, 0.8); F.geo(new THREE.ConeGeometry(2.2, 0.9, 8), '#ff93b6', -2.6, 3.0, 0.8);
    F.cyl(0.1, 0.1, 2.6, 6, '#7a6552', 2.8, 0, -1.6); F.geo(new THREE.ConeGeometry(2.2, 0.9, 8), '#8fd3ff', 2.8, 3.0, -1.6);
    F.box(1.0, 0.05, 2.0, '#f2a541', -1.4, 0, -0.6); F.box(1.0, 0.05, 2.0, '#ffffff', 1.0, 0, 0.6);
    F.box(0.2, 2.2, 0.2, '#ffffff', -0.5, 0, -3.6); F.box(0.2, 2.2, 0.2, '#ffffff', 0.5, 0, -3.6);
    F.box(1.4, 0.2, 1.0, '#ffffff', 0, 2.2, -3.6); F.box(1.2, 0.7, 0.15, '#e4576e', 0, 2.4, -4.1); }

  // 码头：局部 +z 指向海
  { const L = LOCS.码头; const p = polar(L.a, 51); const F = frame(batch, p.x, p.z, faceOut(L.a), 0);
    F.box(3.2, 0.3, 12.5, '#b9875a', 0, PIER_Y - 0.3, 0);
    for (let z = -6; z <= 6; z += 2) { F.cyl(0.18, 0.18, 2.4, 6, '#9b7350', -1.5, -1.5, z); F.cyl(0.18, 0.18, 2.4, 6, '#9b7350', 1.5, -1.5, z); }
    F.box(2, 0.9, 4.6, '#ffffff', 3.6, -0.3, 1.5); F.box(2.05, 0.15, 4.65, '#e4576e', 3.6, 0.2, 1.5);
    F.cyl(0.08, 0.08, 3.4, 6, '#7a6552', 3.6, 0.6, 1.5);
    F.geo(sailGeo(), '#f3ead3', 3.6, 1.0, 1.4); }

  // 大桥：从岛边一直通到穹顶上的出口
  { const L = LOCS.大桥;
    const r0 = polar(L.a, 41.25); const R = frame(batch, r0.x, r0.z, faceOut(L.a), 0);
    R.box(4.2, 0.3, 4.7, '#cfd8e3', 0, (GROUND_Y + BRIDGE_Y) / 2 - 0.3, 0, { rx: -Math.atan((BRIDGE_Y - GROUND_Y) / 4.5) });
    const len = 68.4 - 43.5, mid = polar(L.a, 43.5 + len / 2);
    const F = frame(batch, mid.x, mid.z, faceOut(L.a), 0);
    F.box(4.2, 0.4, len, '#cfd8e3', 0, BRIDGE_Y - 0.4, 0);
    F.box(0.15, 0.9, len, '#e8edf3', -2.0, BRIDGE_Y, 0); F.box(0.15, 0.9, len, '#e8edf3', 2.0, BRIDGE_Y, 0);
    for (let z = -len / 2; z <= len / 2; z += 2.2) { F.box(0.22, 0.9, 0.22, '#e8edf3', -2.0, BRIDGE_Y, z); F.box(0.22, 0.9, 0.22, '#e8edf3', 2.0, BRIDGE_Y, z); }
    for (const z of [-6, 3, 10]) F.cyl(0.7, 0.7, 4.5, 8, '#aab6c4', 0, -3.2, z);
    F.box(0.15, 2.6, 0.15, '#55627a', -2.7, BRIDGE_Y, -len / 2 + 0.8); F.box(1.8, 0.7, 0.12, '#2f5d8a', -2.7, BRIDGE_Y + 2.2, -len / 2 + 0.8);
    const dp = polar(L.a, 69.0); const D = frame(batch, dp.x, dp.z, faceOut(L.a), 0);
    D.box(4.4, 0.4, 2, '#cfd8e3', 0, BRIDGE_Y - 0.4, -0.8);
    D.box(3.0, 0.25, 0.4, '#e8edf7', 0, BRIDGE_Y + 3.6, 0.1); D.box(0.25, 3.6, 0.4, '#e8edf7', -1.35, BRIDGE_Y, 0.1); D.box(0.25, 3.6, 0.4, '#e8edf7', 1.35, BRIDGE_Y, 0.1); }

  // 群演住的房子
  FILLERS.forEach((f) => {
    const p = polar(f.a, 31.2);
    home(frame(batch, p.x, p.z, faceCenter(f.a), GROUND_Y), f.wall, f.roof, f.w, f.h, 4.6, false);
  });

  // 道路：环路、虚线、通往各处的小路
  { const W = frame(batch, 0, 0, 0, 0);
    W.geo(new THREE.RingGeometry(RING_R - 1.8, RING_R + 1.8, 72, 1).rotateX(-Math.PI / 2), '#d9d3c5', 0, GROUND_Y + 0.02, 0);
    for (let a = 0; a < 360; a += 6) { const p = polar(a, RING_R); frame(batch, p.x, p.z, -(a + 90) * DEG, GROUND_Y + 0.02).box(1.1, 0.02, 0.22, '#ffffff', 0, 0, 0); }
    const path = (a, r0, r1, w, color = '#e2dccd') => { const p = polar(a, (r0 + r1) / 2); frame(batch, p.x, p.z, faceOut(a), GROUND_Y + 0.01).box(w, 0.02, r1 - r0, color, 0, 0, 0); };
    for (const a of [0, 90, 180, 270]) path(a, 9, RING_R - 1.8, 2.4);
    for (const n of ['小酒馆', '报刊亭', '家', '保险公司']) path(LOCS[n].a, RING_R + 1.8, SPOT_R + 1.4, 2);
    FILLERS.forEach(f => path(f.a, RING_R + 1.8, SPOT_R + 1.2, 1.4));
    path(320, RING_R + 1.8, 34, 2, '#e6d6ac'); path(275, RING_R + 1.8, 45, 2); path(225, RING_R + 1.8, 39, 2.4);
    W.geo(new THREE.RingGeometry(34, ISLAND_R, 20, 1, -340 * DEG, 40 * DEG).rotateX(-Math.PI / 2), '#efdcae', 0, GROUND_Y + 0.01, 0); }

  // 路灯：灯头里藏着摄像头
  for (let a = 15, i = 1; a < 360; a += 30, i++) {
    const p = polar(a, RING_R + 2.8);
    const F = frame(batch, p.x, p.z, 0, GROUND_Y);
    F.cyl(0.12, 0.14, 3.6, 6, '#55627a', 0, 0, 0);
    F.box(0.6, 0.3, 0.6, '#fff1b8', 0, 3.6, 0, { kind: 'lamp' });
    anchors.push({ p: new V3(p.x, GROUND_Y + 3.4, p.z), name: `路灯摄像头 ${String(i).padStart(2, '0')}` });
  }
  for (const [name, L] of Object.entries(LOCS)) {
    const s = polar(L.a, name === '广场' ? 12 : L.r < 30 ? 20.5 : L.r - 8);
    const side = polar(L.a + 90, 2.5);
    anchors.push({ p: new V3(s.x + side.x, (name === '大桥' || name === '码头' ? BRIDGE_Y : GROUND_Y) + 2.6, s.z + side.z), name: L.cam });
  }

  // 停着的车
  for (const [a, color] of [[112, '#e4576e'], [196, '#8fd3ff'], [332, '#f2a541']]) {
    const p = polar(a, RING_R - 1.2);
    const F = frame(batch, p.x, p.z, -(a + 90) * DEG, GROUND_Y);
    F.box(3.2, 0.8, 1.6, color, 0, 0.3, 0); F.box(1.8, 0.7, 1.4, '#dcefff', -0.2, 1.1, 0);
    for (const [x, z] of [[-1, -0.8], [1, -0.8], [-1, 0.8], [1, 0.8]]) F.cyl(0.32, 0.32, 0.25, 8, '#2b2b33', x, 0, z, { rx: Math.PI / 2 });
  }

  // 树
  const rand = rng(7);
  const tree = (x, z, s) => {
    const F = frame(batch, x, z, rand() * 6, GROUND_Y);
    F.cyl(0.3 * s, 0.4 * s, 1.4 * s, 6, '#8b6a4f', 0, 0, 0);
    if (rand() < 0.4) { F.geo(new THREE.ConeGeometry(1.5 * s, 2.6 * s, 7), '#5fae7a', 0, 2.4 * s, 0); F.geo(new THREE.ConeGeometry(1.1 * s, 2.0 * s, 7), '#6cbd85', 0, 3.6 * s, 0); }
    else F.geo(new THREE.IcosahedronGeometry(1.6 * s, 0), rand() < 0.5 ? '#7cc58f' : '#8fd19a', 0, 2.6 * s, 0);
  };
  for (const a of [135, 225, 315]) { const p = polar(a, 7.6); tree(p.x, p.z, 1.1); }
  const blocked = (a, r) => {
    const near = (x, w) => Math.abs(((a - x + 540) % 360) - 180) < w;
    if (r > 33 && (near(225, 10) || near(275, 10) || near(320, 24))) return true;
    for (const L of Object.values(LOCS)) if (Math.hypot(polar(a, r).x - polar(L.a, L.r).x, polar(a, r).z - polar(L.a, L.r).z) < 6.5) return true;
    for (const f of FILLERS) if (near(f.a, 9) && Math.abs(r - 31) < 4.5) return true;
    if (r < 18 && [0, 90, 180, 270].some(x => near(x, 9))) return true;
    for (let k = 15; k < 360; k += 30) if (near(k, 3) && Math.abs(r - (RING_R + 2.8)) < 1.5) return true;
    return false;
  };
  for (let i = 0; i < 260; i++) {
    const r = rand() < 0.3 ? 11 + rand() * 6.5 : 34.5 + rand() * 8.5;
    const a = rand() * 360;
    if (blocked(a, r)) continue;
    const p = polar(a, r);
    tree(p.x, p.z, 0.75 + rand() * 0.5);
  }
}

// ---------- 方块小人 ----------
class Person {
  constructor(world, a) {
    const g = this.group = new THREE.Group();
    const M = (c) => world.mats.get(c);
    const mk = (geo, c, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, M(c)); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    const leg = new THREE.BoxGeometry(0.3, 0.85, 0.3).translate(0, -0.425, 0);
    this.legL = mk(leg, a.pants, -0.18, 0.85, 0);
    this.legR = mk(leg, a.pants, 0.18, 0.85, 0);
    this.body = mk(new THREE.BoxGeometry(0.9, 0.95, 0.55), a.color, 0, 1.32, 0);
    const arm = new THREE.BoxGeometry(0.24, 0.8, 0.24).translate(0, -0.38, 0);
    this.armL = mk(arm, a.color, -0.58, 1.75, 0);
    this.armR = mk(arm, a.color, 0.58, 1.75, 0);
    mk(new THREE.BoxGeometry(0.74, 0.7, 0.7), '#f2d0b4', 0, 2.17, 0);
    mk(new THREE.BoxGeometry(0.8, 0.24, 0.76), a.hair, 0, 2.55, -0.02);
    mk(new THREE.BoxGeometry(0.8, 0.46, 0.2), a.hair, 0, 2.3, -0.32);
    mk(new THREE.BoxGeometry(0.1, 0.12, 0.04), '#1d1d24', -0.17, 2.2, 0.36);
    mk(new THREE.BoxGeometry(0.1, 0.12, 0.04), '#1d1d24', 0.17, 2.2, 0.36);
    if (a.prop === 'dog') {
      const d = new THREE.Group(); d.position.set(0.95, 0, -0.4); g.add(d);
      mk(new THREE.BoxGeometry(0.42, 0.36, 0.8), '#d9a35b', 0, 0.48, 0, d);
      mk(new THREE.BoxGeometry(0.34, 0.32, 0.34), '#d9a35b', 0, 0.72, 0.48, d);
      mk(new THREE.BoxGeometry(0.1, 0.1, 0.1), '#1d1d24', 0, 0.72, 0.67, d);
      for (const [x, z] of [[-0.14, -0.28], [0.14, -0.28], [-0.14, 0.28], [0.14, 0.28]]) mk(new THREE.BoxGeometry(0.1, 0.32, 0.1), '#b8843f', x, 0.15, z, d);
      mk(new THREE.BoxGeometry(0.08, 0.08, 0.3), '#d9a35b', 0, 0.62, -0.5, d);
      this.dog = d;
    } else if (a.prop === 'stroller') {
      const s = new THREE.Group(); s.position.set(0, 0, 1.05); g.add(s);
      mk(new THREE.BoxGeometry(0.62, 0.45, 0.85), '#e4576e', 0, 0.62, 0, s);
      mk(new THREE.BoxGeometry(0.62, 0.4, 0.3), '#c94460', 0, 1.0, -0.28, s);
      mk(new THREE.BoxGeometry(0.06, 0.06, 0.5), '#3b3542', 0, 1.15, -0.62, s);
      for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) mk(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 8).rotateZ(Math.PI / 2), '#2b2b33', x, 0.16, z, s);
    }
    g.scale.setScalar(0.82);
    world.scene.add(g);
  }
  animate(walking, phase, now) {
    const s = walking ? Math.sin(phase) * 0.65 : 0;
    this.legL.rotation.x = s; this.legR.rotation.x = -s;
    this.armL.rotation.x = -s * 0.8; this.armR.rotation.x = s * 0.8;
    this.body.position.y = 1.32 + (walking ? Math.abs(Math.sin(phase)) * 0.05 : 0);
    if (this.dog) this.dog.position.y = walking ? Math.abs(Math.sin(phase * 1.6)) * 0.08 : 0;
  }
}

// ---------- 世界 ----------
export class World {
  constructor(canvas, sim) {
    this.sim = sim;
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    this.scene = new THREE.Scene();
    this.mats = new Mats();
    this.normalMat = new THREE.MeshNormalMaterial();
    this.anchors = [];
    this.crtAnchor = null;
    this.view = { az: 45, azT: 45, el: 30, target: new V3(0, 0, 0), focus: null, zoom: 1.0, zoomT: 2.1, follow: true };
    this.offset = new THREE.Vector2();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 100, 440);
    this.camTrue = this.cam.clone();
    this.crtCam = new THREE.PerspectiveCamera(46, 4 / 3, 0.3, 220);
    this._v = new V3();

    this.buildLights();
    this.buildEnvironment();
    const batch = new Batch();
    buildTown(batch, this.anchors);
    batch.build(this.scene, this.mats);
    this.people = new Map();
    this.syncPeople();
    this.markers = new Map();
    this.camOverride = null;
    this.buildExitDoor();
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.2, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#8fd3ff', transparent: true, opacity: 0.85, depthWrite: false }));
    this.scene.add(this.ring);
    this.buildPost();
    this.resize();
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight('#dff0ff', '#8a9a7a', 1.3);
    this.scene.add(this.hemi);
    const s = this.sun = new THREE.DirectionalLight('#ffffff', 2.4);
    s.castShadow = true;
    s.shadow.mapSize.set(2048, 2048);
    Object.assign(s.shadow.camera, { left: -62, right: 62, top: 62, bottom: -62, near: 1, far: 320 });
    s.shadow.bias = -0.0006;
    s.shadow.normalBias = 0.03;
    this.scene.add(s, s.target);
  }

  buildEnvironment() {
    const toon = (c) => this.mats.get(c);
    this.domeU = {
      uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunDir: { value: new V3() }, uSunCol: { value: new THREE.Color() },
      uSus: { value: 0 }, uTime: { value: 0 }, uNight: { value: 0 },
    };
    // 只画穹顶的内壁：从外面看，靠近镜头的半边自动被“剖开”
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 96, 32, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.ShaderMaterial({ uniforms: this.domeU, vertexShader: DOME_VS, fragmentShader: DOME_FS, side: THREE.BackSide }));
    this.scene.add(this.dome);

    this.waterU = { uTime: { value: 0 }, uNight: { value: 0 }, uDeep: { value: new THREE.Color('#2f78ab') }, uShallow: { value: new THREE.Color('#6cc4e0') }, uFoam: { value: new THREE.Color('#ffffff') } };
    const water = new THREE.Mesh(new THREE.CircleGeometry(DOME_R, 96).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: this.waterU, vertexShader: WATER_VS, fragmentShader: WATER_FS }));
    this.scene.add(water);

    const island = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_R, ISLAND_R + 1.2, 3, 72), toon('#bfe3bc'));
    island.position.y = GROUND_Y - 1.5; island.receiveShadow = true; this.scene.add(island);
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(SAND_R, SAND_R + 1.5, 3.2, 72), toon('#efdcae'));
    sand.position.y = 0.3 - 1.6; sand.receiveShadow = true; this.scene.add(sand);

    // 摄影棚的底座和边缘的指示灯
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(DOME_R + 2.5, DOME_R + 4, 5, 72), toon('#1b2436'));
    plinth.position.y = -2.55; this.scene.add(plinth);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(DOME_R, 0.35, 6, 96).rotateX(Math.PI / 2), toon('#cfd8e3'));
    rim.position.y = 0.15; this.scene.add(rim);
    const lightGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    for (let i = 0; i < 36; i++) {
      const p = polar(i * 10, DOME_R + 3.6);
      const m = new THREE.Mesh(lightGeo, this.mats.get(i % 2 ? '#ffffff' : '#ff4d4f', i % 2 ? 'rimW' : 'rimR'));
      m.position.set(p.x, -1.2, p.z); this.scene.add(m);
    }
  }

  // 出口门单独建：最终幕里要能推开，门后是一片白光
  buildExitDoor() {
    const L = LOCS.大桥, p = polar(L.a, 69.0);
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = faceOut(L.a);
    const light = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.6), new THREE.MeshBasicMaterial({ color: '#fff4d6', side: THREE.DoubleSide }));
    light.position.set(0, BRIDGE_Y + 1.8, 0.02);
    light.visible = false;
    const hinge = new THREE.Group();
    hinge.position.set(-1.2, BRIDGE_Y, 0.1);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.6, 0.3), this.mats.get('#151b28', 'door'));
    leaf.position.set(1.2, 1.8, 0);
    leaf.castShadow = true;
    hinge.add(leaf);
    g.add(light, hinge);
    this.scene.add(g);
    this.door = { hinge, light, open: 0, target: 0 };
  }
  openDoor(now = false) { this.door.target = 1; if (now) this.door.open = 1; }

  buildPost() {
    const quad = new THREE.PlaneGeometry(2, 2);
    this.post = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tNormal: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) }, uScale: { value: new THREE.Vector2(1, 1) }, uOffset: { value: new THREE.Vector2() },
        uNear: { value: 100 }, uFar: { value: 440 }, uDepthTh: { value: 1 },
      },
      vertexShader: QUAD_VS, fragmentShader: POST_FS, depthTest: false, depthWrite: false,
    });
    this.crtMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.3 }, uFar: { value: 220 }, uTime: { value: 0 } },
      vertexShader: QUAD_VS, fragmentShader: CRT_FS, depthTest: false, depthWrite: false,
    });
    this.quadScene = new THREE.Scene(); this.quadScene.add(new THREE.Mesh(quad, this.post));
    this.crtScene = new THREE.Scene(); this.crtScene.add(new THREE.Mesh(quad, this.crtMat));
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  makeTarget(w, h, depth) {
    const rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    if (depth) rt.depthTexture = new THREE.DepthTexture(w, h);
    return rt;
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.cssW = w; this.cssH = h;
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.px = w < 700 ? 2 : 3;
    this.lw = Math.ceil(w / this.px);
    this.lh = Math.ceil(h / this.px);
    for (const rt of [this.rtColor, this.rtNormal]) if (rt) { rt.depthTexture?.dispose(); rt.dispose(); }
    this.rtColor = this.makeTarget(this.lw, this.lh, true);
    this.rtNormal = this.makeTarget(this.lw, this.lh, false);
    const u = this.post.uniforms;
    u.tColor.value = this.rtColor.texture; u.tDepth.value = this.rtColor.depthTexture; u.tNormal.value = this.rtNormal.texture;
    u.uRes.value.set(this.lw, this.lh);
    u.uScale.value.set(w / (this.lw * this.px), h / (this.lh * this.px));
  }

  // 新角色（小雨、林父）加入小镇时补建方块小人
  syncPeople() {
    for (const a of this.sim.agents) if (!this.people.has(a)) this.people.set(a, new Person(this, a));
  }

  // 待拍的戏：在地点上立一块场记板
  addMarker(id, nodeId) {
    const n = this.sim.nav.nodes.get(nodeId);
    if (!n || this.markers.has(id)) return;
    const g = new THREE.Group();
    const mk = (geo, c, x, y, z, rz = 0) => { const m = new THREE.Mesh(geo, this.mats.get(c)); m.position.set(x, y, z); m.rotation.z = rz; m.castShadow = true; g.add(m); };
    mk(new THREE.BoxGeometry(0.14, 1.5, 0.14), '#55627a', 0, 0.75, 0);
    mk(new THREE.BoxGeometry(1.3, 0.85, 0.14), '#1d1d24', 0, 1.9, 0);
    mk(new THREE.BoxGeometry(1.1, 0.08, 0.16), '#ffffff', 0, 1.75, 0);
    for (let i = 0; i < 4; i++) mk(new THREE.BoxGeometry(0.32, 0.22, 0.16), i % 2 ? '#1d1d24' : '#ffffff', -0.48 + i * 0.32, 2.48, 0, 0.18);
    const len = Math.hypot(n.x, n.z) || 1;
    const off = this.sim.nav.nodes.has(nodeId) && nodeId === '广场' ? 2.4 : 1.8;
    g.position.set(n.x - (n.x / len) * off + (n.z / len) * 1.4, n.y, n.z - (n.z / len) * off - (n.x / len) * 1.4);
    this.scene.add(g);
    this.markers.set(id, g);
  }
  removeMarker(id) {
    const g = this.markers.get(id);
    if (!g) return;
    this.scene.remove(g);
    this.markers.delete(id);
  }
  markerPos(id) { const g = this.markers.get(id); return g ? g.position : null; }

  // 最终幕：镜头转到能同时看见林楚背影和出口门的角度
  focusExit() {
    const v = this.view, p = polar(LOCS.大桥.a, 64);
    v.follow = false;
    v.focus = new V3(p.x, 0, p.z);
    v.zoomT = 3.2;
    v.azT = v.az + ((((60 - v.az) % 360) + 540) % 360) - 180;
  }

  focusScene() { this.setFollow(true); this.view.zoomT = Math.max(this.view.zoomT, 2.8); }

  // ----- 镜头 -----
  rotate(step) { this.view.azT += step * 45; }
  zoomBy(f) { this.view.zoomT = clamp(this.view.zoomT * f, 0.75, 4.2); }
  setFollow(on) { this.view.follow = on; if (on) { this.view.focus = null; this.view.zoomT = Math.max(this.view.zoomT, 1.8); } }
  overview() { this.view.follow = false; this.view.focus = new V3(0, 0, 0); this.view.zoomT = 1.0; }
  focusOn(x, z) { this.view.follow = false; this.view.focus = new V3(x, 0, z); this.view.zoomT = Math.max(this.view.zoomT, 2.4); }
  pan(dx, dy) {
    const v = this.view;
    v.follow = false; v.focus = null;
    const upp = (BASE_VIEW_H / v.zoom) / (this.lh * this.px);
    const az = v.az * DEG;
    const right = new V3(Math.cos(az), 0, -Math.sin(az));
    const fwd = new V3(-Math.sin(az), 0, -Math.cos(az));
    v.target.addScaledVector(right, -dx * upp).addScaledVector(fwd, (dy * upp) / Math.sin(v.el * DEG));
    if (v.target.length() > 60) v.target.setLength(60);
  }

  trumanSpot() {
    const T = this.sim.truman;
    if (!T.inside) return new V3(T.x, T.y, T.z);
    const n = this.sim.nav.nodes.get(T.place) || T;
    return new V3(n.x, n.y, n.z);
  }

  // ----- 每帧 -----
  update(dt, now) {
    const sim = this.sim;
    const hour = sim.min / 60;
    const k = skyAt(hour);
    const t = now / 1000;
    const sd = sunDir(hour);
    const sus = sim.sus / 100;

    const U = this.domeU;
    U.uTop.value.copy(k.top); U.uHor.value.copy(k.hor); U.uSunDir.value.copy(sd); U.uSunCol.value.copy(k.sun);
    U.uSus.value = sus; U.uTime.value = t; U.uNight.value = k.night;
    this.waterU.uTime.value = t; this.waterU.uNight.value = k.night;
    this.waterU.uDeep.value.set('#2f78ab').lerp(new THREE.Color('#13224a'), k.night);
    this.waterU.uShallow.value.set('#6cc4e0').lerp(new THREE.Color('#2a4a7a'), k.night);
    this.waterU.uFoam.value.set('#ffffff').lerp(new THREE.Color('#9fb0d8'), k.night);

    this.hemi.color.copy(k.sky); this.hemi.groundColor.copy(k.gnd); this.hemi.intensity = k.hemiI;
    const L = sd.y > 0.06 ? sd : MOON;
    this.sun.color.copy(k.sun); this.sun.intensity = k.sunI;
    this.sun.position.copy(L).multiplyScalar(150); this.sun.target.position.set(0, 0, 0);

    const blink = Math.floor(t * 1.5) % 2;
    for (const m of this.mats.map.values()) {
      const kind = m.userData.kind;
      if (!kind) continue;
      m.emissiveIntensity = kind === 'win' ? k.night * 0.95 : kind === 'lamp' ? k.night * 1.3 : kind === 'warm' ? 0.3 + k.night * 0.7
        : kind === 'rimR' ? blink * 1.2 : kind === 'rimW' ? (1 - blink) * 0.9 : kind === 'door' ? sus * (0.5 + 0.5 * Math.sin(t * 3)) : 0;
    }

    for (const [a, p] of this.people) {
      p.group.visible = !a.inside && !a.gone;
      if (!p.group.visible) continue;
      p.group.position.set(a.x, a.y, a.z);
      let dh = a.heading - p.group.rotation.y;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      p.group.rotation.y += dh * Math.min(1, dt * 10);
      p.animate(a.walking, a.phase, now);
    }
    for (const g of this.markers.values()) g.rotation.y = Math.sin(t * 1.2) * 0.35;
    const T = sim.truman;
    const d = this.door;
    d.open += (d.target - d.open) * Math.min(1, dt * 1.6);
    d.hinge.rotation.y = -1.65 * d.open;
    d.light.visible = d.open > 0.02;
    this.ring.visible = !T.inside && !T.gone;
    this.ring.position.set(T.x, T.y + 0.04, T.z);
    this.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.08);

    this.updateCamera(dt);
    this.updateCrtCamera();
    this.crtMat.uniforms.uTime.value = t;
  }

  updateCamera(dt) {
    const v = this.view;
    const ease = Math.min(1, dt * 6);
    v.az += (v.azT - v.az) * ease;
    if (Math.abs(v.azT - v.az) < 0.02) v.az = v.azT;
    v.zoom += (v.zoomT - v.zoom) * ease;
    const goal = v.follow ? this.trumanSpot() : v.focus;
    if (goal) {
      const f = Math.min(1, dt * (v.follow ? 2.5 : 4));
      v.target.x += (goal.x - v.target.x) * f;
      v.target.z += (goal.z - v.target.z) * f;
    }
    const viewH = BASE_VIEW_H / v.zoom;
    const texel = viewH / this.lh;
    const viewW = texel * this.lw;
    for (const c of [this.cam, this.camTrue]) {
      c.left = -viewW / 2; c.right = viewW / 2; c.top = viewH / 2; c.bottom = -viewH / 2;
      c.updateProjectionMatrix();
    }
    const az = v.az * DEG, el = v.el * DEG;
    const pos = new V3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(260).add(v.target);
    const ct = this.camTrue;
    ct.position.copy(pos); ct.lookAt(v.target); ct.updateMatrixWorld();
    // 把相机吸附到像素网格上，剩下的小数部分在放大时补偿，画面平移时像素不会闪
    const right = new V3().setFromMatrixColumn(ct.matrixWorld, 0);
    const up = new V3().setFromMatrixColumn(ct.matrixWorld, 1);
    const fwd = new V3().setFromMatrixColumn(ct.matrixWorld, 2);
    const pr = pos.dot(right), pu = pos.dot(up), pf = pos.dot(fwd);
    const sr = Math.round(pr / texel) * texel, su = Math.round(pu / texel) * texel;
    this.cam.position.copy(right.clone().multiplyScalar(sr)).addScaledVector(up, su).addScaledVector(fwd, pf);
    this.cam.quaternion.copy(ct.quaternion);
    this.cam.updateMatrixWorld();
    this.offset.set((pr - sr) / texel, (pu - su) / texel);
    this.post.uniforms.uOffset.value.copy(this.offset);
    this.post.uniforms.uDepthTh.value = texel * 4 + 0.3;
  }

  updateCrtCamera() {
    const tp = this.trumanSpot();
    let best = null, bestD = Infinity;
    for (const a of this.anchors) {
      const d = a.p.distanceTo(tp);
      if (d < 3.5) continue;
      if (d < bestD) { bestD = d; best = a; }
    }
    // 只在明显更近时才切镜头，避免来回跳
    if (!this.crtAnchor || (best !== this.crtAnchor && bestD < this.crtAnchor.p.distanceTo(tp) * 0.8) || this.crtAnchor.p.distanceTo(tp) < 3.5) this.crtAnchor = best;
    if (!this.crtAnchor) return;
    this.crtCam.position.copy(this.crtAnchor.p);
    this.crtCam.lookAt(tp.x, tp.y + 1.6, tp.z);
  }

  crtName() {
    const name = this.camOverride || (this.crtAnchor && this.crtAnchor.name);
    if (!name) return '';
    let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
    return `CAM ${String(h % 300 + 1).padStart(3, '0')} · ${name}`;
  }

  // 世界坐标 → 屏幕 CSS 像素（用未吸附的相机，和补偿后的画面对齐）
  project(x, y, z) {
    const v = this._v.set(x, y, z).project(this.camTrue);
    return { x: ((v.x + 1) / 2) * this.lw * this.px, y: this.cssH - ((v.y + 1) / 2) * this.lh * this.px };
  }

  render(crtRect) {
    const r = this.renderer;
    r.setScissorTest(false);
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.rtColor);
    r.setClearColor(BG, 1);
    r.render(this.scene, this.cam);

    // 法线通道：只给物体描边用，穹顶不参与
    this.dome.visible = false; this.ring.visible = false;
    this.scene.overrideMaterial = this.normalMat;
    r.setRenderTarget(this.rtNormal);
    r.setClearColor(0x8080ff, 0);
    r.render(this.scene, this.cam);
    this.scene.overrideMaterial = null;
    this.dome.visible = true; this.ring.visible = !this.sim.truman.inside && !this.sim.truman.gone;

    let crt = null;
    if (crtRect && crtRect.w > 10 && crtRect.h > 10) {
      const cw = Math.max(32, Math.round(crtRect.w / 2)), ch = Math.max(24, Math.round(crtRect.h / 2));
      if (!this.rtCrt || this.rtCrt.width !== cw || this.rtCrt.height !== ch) {
        if (this.rtCrt) { this.rtCrt.depthTexture?.dispose(); this.rtCrt.dispose(); }
        this.rtCrt = this.makeTarget(cw, ch, true);
        this.crtMat.uniforms.tColor.value = this.rtCrt.texture;
        this.crtMat.uniforms.tDepth.value = this.rtCrt.depthTexture;
        this.crtMat.uniforms.uRes.value.set(cw, ch);
        this.crtCam.aspect = cw / ch; this.crtCam.updateProjectionMatrix();
      }
      r.setRenderTarget(this.rtCrt);
      r.setClearColor(BG, 1);
      r.render(this.scene, this.crtCam);
      crt = crtRect;
    }

    r.setRenderTarget(null);
    r.setViewport(0, 0, this.cssW, this.cssH);
    r.render(this.quadScene, this.quadCam);
    if (crt) {
      const y = this.cssH - crt.y - crt.h;
      r.setScissorTest(true);
      r.setScissor(crt.x, y, crt.w, crt.h);
      r.setViewport(crt.x, y, crt.w, crt.h);
      r.render(this.crtScene, this.quadCam);
      r.setScissorTest(false);
      r.setViewport(0, 0, this.cssW, this.cssH);
    }
  }
}
