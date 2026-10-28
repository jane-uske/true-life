// 启动和主循环：模拟 → 导演 → 3D → 界面。3D 名牌和对话气泡也在这里，界面层通过 labels 读它们的屏幕位置。
import { World } from './world3d.js';
import { Sim } from './engine.js';
import { Director } from './director.js';
import { UI } from './ui.js';
import { LOCS } from './data.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const sim = new Sim();
const canvas = $('#view');
let world;
try {
  world = new World(canvas, sim);
} catch (e) {
  $('#loading').textContent = '这个浏览器打不开 3D 画面（WebGL 不可用）。换个浏览器试试。';
  throw e;
}
const director = new Director(sim, world);

// ---------- 浮在 3D 上的名牌 ----------
const layer = $('#labels');
const labels = { layer, loc: {}, locEls: {}, truman: null, trumanEl: null };
let ui = null;

const locTags = Object.entries(LOCS).map(([name, L]) => {
  const b = el('button', 'loc', name);
  b.type = 'button';
  b.title = `把镜头移到${name}`;
  const node = sim.nav.nodes.get(name);
  const base = name === '广场' ? { x: 0, z: 0 } : name === '大桥' ? sim.nav.nodes.get('G2') : (() => { const a = L.a * Math.PI / 180; return { x: Math.cos(a) * L.r, z: Math.sin(a) * L.r }; })();
  b.addEventListener('click', () => { if (ui && ui.dropOn(name)) return; world.focusOn(base.x, base.z); syncCamButtons(); });
  layer.append(b);
  labels.locEls[name] = b;
  labels.loc[name] = { x: -999, y: -999, hidden: true };
  return { name, el: b, x: base.x, y: (node ? node.y : 0.5) + L.top, z: base.z };
});
const exitTag = el('span', 'loc exit', '出口');
layer.append(exitTag);
const exitNode = sim.nav.nodes.get('出口');
const accTag = el('span', 'loc acc', '');
layer.append(accTag);

const nameTags = new Map();
function tagFor(a) {
  let t = nameTags.get(a);
  if (t || !a.name) return t;
  t = el('span', a === sim.truman ? 'tag star' : 'tag', a.name);
  t.style.setProperty('--c', a.color);
  if (a === sim.truman) {
    t.setAttribute('role', 'button');
    t.tabIndex = 0;
    t.title = '跟拍林楚';
    t.addEventListener('click', () => { if (ui && ui.dropOn('林楚')) return; world.setFollow(true); syncCamButtons(); });
    labels.trumanEl = t;
  }
  layer.append(t);
  nameTags.set(a, t);
  return t;
}
for (const a of sim.agents) tagFor(a);
const insideTag = el('span', 'tag inside', '');
layer.append(insideTag);

const bubbles = [];
function addBubble(agent, text, thought, life = 3.6) {
  for (const b of bubbles) if (b.agent === agent) b.life = 0;
  const node = el('div', thought ? 'bubble thought' : 'bubble', text);
  layer.append(node);
  bubbles.push({ agent, node, life });
}

function place(node, p, dy = 0) {
  const off = p.x < -80 || p.x > world.cssW + 80 || p.y < -80 || p.y > world.cssH + 80;
  node.hidden = off;
  if (!off) node.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y + dy)}px)`;
  return off;
}

function updateLabels(dt) {
  for (const t of locTags) {
    const p = world.project(t.x, t.y, t.z);
    const hidden = place(t.el, p);
    labels.loc[t.name] = { x: p.x, y: p.y, hidden };
  }
  place(exitTag, world.project(exitNode.x, exitNode.y + 5.4, exitNode.z));
  const acc = world.accidentLabel();
  if (acc) { if (accTag.textContent !== acc.text) accTag.textContent = acc.text; place(accTag, world.project(acc.x, acc.y, acc.z)); } else accTag.hidden = true;
  for (const a of sim.agents) {
    const t = tagFor(a);
    if (!t) continue;
    if (a.inside || a.gone) { t.hidden = true; if (a === sim.truman) labels.truman = null; continue; }
    const p = world.project(a.x, a.y + 2.75, a.z);
    const hidden = place(t, p);
    if (a === sim.truman) {
      labels.truman = { x: p.x, y: p.y, hidden };
      const run = !!director.D.escape;
      if (t.classList.contains('run') !== run) { t.classList.toggle('run', run); t.textContent = run ? '林楚 · 正在逃离' : '林楚'; }
    }
  }
  const T = sim.truman;
  if (T.inside) {
    const n = sim.nav.nodes.get(T.place);
    const L = LOCS[T.place];
    insideTag.textContent = `林楚在里面 · ${T.act}`;
    place(insideTag, world.project(n.x, n.y + (L ? L.top : 4) + 1.4, n.z));
  } else insideTag.hidden = true;
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    b.life -= dt;
    if (b.life <= 0 || b.agent.inside || b.agent.gone) { b.node.remove(); bubbles.splice(i, 1); continue; }
    place(b.node, world.project(b.agent.x, b.agent.y + 2.75, b.agent.z), -26);
  }
}

ui = new UI({ sim, world, director, labels, addBubble });
director.hooks = ui.hooks();

// ---------- 抽屉 ----------
const drawer = $('#drawer');
$('#drawer-tab').addEventListener('click', () => {
  const open = drawer.classList.toggle('open');
  $('#drawer-tab').setAttribute('aria-expanded', String(open));
});
if (innerWidth >= 900) { drawer.classList.add('open'); $('#drawer-tab').setAttribute('aria-expanded', 'true'); }

// ---------- 镜头操作 ----------
function syncCamButtons() { $('#follow').setAttribute('aria-pressed', String(world.view.follow)); }
$('#rot-l').addEventListener('click', () => world.rotate(-1));
$('#rot-r').addEventListener('click', () => world.rotate(1));
$('#follow').addEventListener('click', () => { world.setFollow(!world.view.follow); syncCamButtons(); });
$('#overview').addEventListener('click', () => { world.overview(); syncCamButtons(); });
$('#zoom-in').addEventListener('click', () => world.zoomBy(1.25));
$('#zoom-out').addEventListener('click', () => world.zoomBy(0.8));

const pointers = new Map();
let pinchDist = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1) { if (dx || dy) { world.pan(dx, dy); syncCamButtons(); } }
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) world.zoomBy(d / pinchDist);
    pinchDist = d;
  }
});
const release = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchDist = 0; };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); world.zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  if (e.key === 'q' || e.key === 'Q') world.rotate(-1);
  else if (e.key === 'e' || e.key === 'E') world.rotate(1);
  else if (e.key === 'f' || e.key === 'F') { world.setFollow(true); syncCamButtons(); }
  else if (e.key === ' ' && !director.locked && !ui.popOpen) { e.preventDefault(); ui.setSpeed(sim.speed === 0 ? 1 : 0); }
  else if (['1', '2', '3'].includes(e.key) && !director.locked && !ui.popOpen) ui.setSpeed([1, 2, 4][Number(e.key) - 1]);
});
new ResizeObserver(() => world.resize()).observe(canvas);

// ---------- 主循环 ----------
const crtScreen = $('#crt-screen');
function crtRect() {
  const c = canvas.getBoundingClientRect(), r = crtScreen.getBoundingClientRect();
  if (!r.width) return null;
  return { x: Math.round(r.left - c.left), y: Math.round(r.top - c.top), w: Math.round(r.width), h: Math.round(r.height) };
}

let last = performance.now();
let frames = 0, frameMs = 0, camT = 0;
window.__perf = () => ({ frames, avgMs: frames ? frameMs / frames : 0 });
window.__game = { sim, director, world, ui };
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  sim.update(dt);
  for (const ev of sim.events.splice(0)) {
    if (ev.type === 'say') { if (!director.busy) addBubble(ev.agent, ev.text, ev.thought); }
    else director.onClock(ev);
  }
  director.tick();
  world.update(dt, now);
  world.render(crtRect());
  updateLabels(dt);
  ui.frame(dt);
  camT -= dt;
  if (camT <= 0) {
    camT = 0.25;
    $('#crt-cam').textContent = world.crtName();
    const sec = Math.floor((sim.min * 60) % 60);
    $('#crt-tc').textContent = `${String(Math.floor(sim.min / 60) % 24).padStart(2, '0')}:${String(Math.floor(sim.min % 60)).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  frames++;
  frameMs += performance.now() - t0;
  requestAnimationFrame(frame);
}
ui.setSpeed(sim.speed);
ui.showTab('truman');
requestAnimationFrame((now) => { last = now; frame(now); $('#loading').hidden = true; window.__booted = true; });
