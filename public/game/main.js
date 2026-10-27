// 3D 样机的启动和界面：顶部状态条、右侧林楚面板、头顶名牌和对话气泡、偷拍小窗、镜头操作。
import { World } from './world3d.js';
import { Sim, fmtClock, periodOf, suspicionLevel } from './engine.js';
import { LOCS, MINDS, PREVIEW_HAND, trumanPlan } from './data.js';

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

// ---------- 浮在 3D 上的标签 ----------
const layer = $('#labels');
const locTags = Object.entries(LOCS).map(([name, L]) => {
  const b = el('button', 'loc', name);
  b.type = 'button';
  b.title = `把镜头移到${name}`;
  const n = sim.nav.nodes.get(name === '广场' ? 'P0' : name);
  const base = name === '广场' ? { x: 0, z: 0 } : name === '大桥' ? sim.nav.nodes.get('G2') : (() => { const a = L.a * Math.PI / 180; return { x: Math.cos(a) * L.r, z: Math.sin(a) * L.r }; })();
  b.addEventListener('click', () => { world.focusOn(base.x, base.z); syncCamButtons(); });
  layer.append(b);
  return { el: b, x: base.x, y: (n ? n.y : 0.5) + L.top, z: base.z };
});
const exitTag = el('span', 'loc exit', '出口');
layer.append(exitTag);
const exitNode = sim.nav.nodes.get('出口');

const nameTags = new Map();
for (const a of sim.agents) {
  if (!a.name) continue;
  const t = el('span', a === sim.truman ? 'tag star' : 'tag', a.name);
  t.style.setProperty('--c', a.color);
  if (a === sim.truman) { t.setAttribute('role', 'button'); t.tabIndex = 0; t.title = '跟拍林楚'; t.addEventListener('click', () => { world.setFollow(true); syncCamButtons(); }); }
  layer.append(t);
  nameTags.set(a, t);
}
const insideTag = el('span', 'tag inside', '');
layer.append(insideTag);

const bubbles = [];
function addBubble(agent, text, thought) {
  for (const b of bubbles) if (b.agent === agent) b.life = 0;
  const node = el('div', thought ? 'bubble thought' : 'bubble', text);
  layer.append(node);
  bubbles.push({ agent, node, life: 3.6 });
}

function place(node, p, dy = 0) {
  const off = p.x < -80 || p.x > world.cssW + 80 || p.y < -80 || p.y > world.cssH + 80;
  node.hidden = off;
  if (!off) node.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y + dy)}px)`;
}

function updateLabels(dt) {
  for (const t of locTags) place(t.el, world.project(t.x, t.y, t.z));
  place(exitTag, world.project(exitNode.x, exitNode.y + 5.4, exitNode.z));
  for (const [a, t] of nameTags) {
    if (a.inside) { t.hidden = true; continue; }
    place(t, world.project(a.x, a.y + 2.75, a.z));
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
    if (b.life <= 0 || b.agent.inside) { b.node.remove(); bubbles.splice(i, 1); continue; }
    place(b.node, world.project(b.agent.x, b.agent.y + 2.75, b.agent.z), -26);
  }
}

// ---------- 顶部状态条和林楚面板 ----------
const speedBtns = [...document.querySelectorAll('[data-speed]')];
function setSpeed(s) { sim.speed = s; speedBtns.forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s))); }
speedBtns.forEach(b => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));

let lastSchedKey = '';
let lastMindLevel = -1;
function updateHud() {
  $('#clock-day').textContent = `第 ${sim.day} 天`;
  $('#clock-time').textContent = fmtClock(sim.min);
  $('#clock-period').textContent = sim.nightFF ? '夜间快进' : periodOf(sim.min);
  $('#clock-period').classList.toggle('ff', sim.nightFF);
  $('#showday').textContent = `直播第 ${(12409 + sim.day).toLocaleString('zh-CN')} 天`;
  const T = sim.truman;
  $('#t-place').textContent = T.path.length ? '路上' : T.place.startsWith('h') ? '别人家' : T.place;
  $('#t-act').textContent = T.act || '—';
  const { entries, index } = sim.currentPlan();
  const next = entries[index + 1];
  $('#t-next').textContent = next ? `${fmtClock(next.t)} ${next.at} · ${next.act}` : '明天 06:40 起床';
  const key = `${sim.day}:${index}`;
  if (key !== lastSchedKey) {
    lastSchedKey = key;
    const ol = $('#t-sched');
    ol.replaceChildren();
    trumanPlan(sim.day).forEach((e, i) => {
      if (i === 0) return;
      const li = el('li', i === index ? 'now' : i < index ? 'done' : '');
      li.append(el('time', '', fmtClock(e.t)), el('span', '', `${e.at} · ${e.act}`));
      ol.append(li);
    });
  }
  const lv = sim.sus < 30 ? 0 : sim.sus < 60 ? 1 : sim.sus < 85 ? 2 : 3;
  if (lv !== lastMindLevel) { lastMindLevel = lv; $('#t-mind').textContent = `「${MINDS[lv]}」`; }
  $('#crt-cam').textContent = world.crtName();
  const sec = Math.floor((sim.min * 60) % 60);
  $('#crt-tc').textContent = `${fmtClock(sim.min)}:${String(sec).padStart(2, '0')}`;
}

function setSus(v) {
  sim.sus = v;
  $('#sus-val').textContent = v;
  $('#dbg-sus-v').textContent = v;
  const bar = $('#sus-bar');
  bar.style.width = `${v}%`;
  bar.style.backgroundColor = v < 30 ? 'var(--calm)' : v < 60 ? 'var(--sky)' : v < 85 ? 'var(--warn)' : 'var(--tally)';
}
$('#dbg-sus').addEventListener('input', (e) => setSus(Number(e.target.value)));
document.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => { sim.min = Number(b.dataset.jump); }));

const drawer = $('#drawer');
$('#drawer-tab').addEventListener('click', () => {
  const open = drawer.classList.toggle('open');
  $('#drawer-tab').setAttribute('aria-expanded', String(open));
});
if (innerWidth >= 900) { drawer.classList.add('open'); $('#drawer-tab').setAttribute('aria-expanded', 'true'); }

// ---------- 手牌预览 ----------
const hand = $('#hand-cards');
PREVIEW_HAND.forEach((c, i) => {
  const card = el('div', 'card');
  card.dataset.cat = c.cat;
  card.style.setProperty('--r', `${(i - 1.5) * 4}deg`);
  card.append(el('span', 'stamp', c.stamp), el('b', '', c.t), el('span', 'd', c.d), el('span', 'cost', `${c.cost} 万`));
  hand.append(card);
});

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
  else if (e.key === ' ') { e.preventDefault(); setSpeed(sim.speed === 0 ? 1 : 0); }
  else if (['1', '2', '3'].includes(e.key)) setSpeed([1, 2, 4][Number(e.key) - 1]);
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
let hudT = 0;
let frames = 0, frameMs = 0;
window.__perf = () => ({ frames, avgMs: frames ? frameMs / frames : 0 });
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  sim.update(dt);
  for (const ev of sim.events.splice(0)) if (ev.type === 'say') addBubble(ev.agent, ev.text, ev.thought);
  world.update(dt, now);
  world.render(crtRect());
  updateLabels(dt);
  hudT -= dt;
  if (hudT <= 0) { hudT = 0.25; updateHud(); }
  frames++; frameMs += performance.now() - t0;
  requestAnimationFrame(frame);
}
setSus(sim.sus);
updateHud();
requestAnimationFrame((now) => { last = now; frame(now); $('#loading').hidden = true; window.__booted = true; });
