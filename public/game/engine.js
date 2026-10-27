// 实时模拟：游戏时钟、路网寻路、按日程走动的角色、路过时的寒暄。
// 这一层不碰渲染，3D 和 HUD 都只读它的状态。
import {
  DEG, RING_R, SPOT_R, GROUND_Y, PIER_Y, BRIDGE_Y, LOCS, FILLERS, CAST, CAST_PLANS, EXTRA_COLORS,
  trumanPlan, GREET, REPLY, STARE, ARRIVE,
} from './data.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pick = a => a[Math.floor(Math.random() * a.length)];
export function polar(a, r) { return { x: Math.cos(a * DEG) * r, z: Math.sin(a * DEG) * r }; }
export const fmtClock = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
export function periodOf(min) {
  const h = min / 60;
  return h < 5 ? '深夜' : h < 11 ? '早上' : h < 18 ? '下午' : h < 22 ? '晚上' : '深夜';
}
export const suspicionLevel = s => (s < 35 ? 0 : s < 65 ? 1 : 2);

// ---------- 路网 ----------
export function buildNav() {
  const nodes = new Map();
  const adj = new Map();
  const add = (id, a, r, y = GROUND_Y) => { const p = polar(a, r); nodes.set(id, { id, x: p.x, z: p.z, y }); adj.set(id, new Set()); };
  const link = (a, b) => { adj.get(a).add(b); adj.get(b).add(a); };

  const angles = new Set();
  for (let a = 0; a < 360; a += 15) angles.add(a);
  for (const l of Object.values(LOCS)) angles.add(l.a);
  for (const f of FILLERS) angles.add(f.a);
  const ring = [...angles].sort((x, y) => x - y);
  ring.forEach(a => add(`R${a}`, a, RING_R));
  ring.forEach((a, i) => link(`R${a}`, `R${ring[(i + 1) % ring.length]}`));

  for (const a of [0, 90, 180, 270]) { add(`P${a}`, a, 6.5); link(`P${a}`, `R${a}`); }
  link('P0', 'P90'); link('P90', 'P180'); link('P180', 'P270'); link('P270', 'P0');
  add('广场', 45, 6.5); link('广场', 'P0'); link('广场', 'P90');

  for (const name of ['小酒馆', '报刊亭', '家', '保险公司']) { add(name, LOCS[name].a, SPOT_R); link(name, `R${LOCS[name].a}`); }
  FILLERS.forEach((f, i) => { add(`h${i}`, f.a, SPOT_R); link(`h${i}`, `R${f.a}`); });

  add('B1', 320, 33); link('B1', 'R320'); add('海滩', 320, 40); link('海滩', 'B1');
  add('D1', 275, 40); link('D1', 'R275'); add('D2', 275, 45, PIER_Y); link('D2', 'D1'); add('码头', 275, 53, PIER_Y); link('码头', 'D2');
  add('G1', 225, 39); link('G1', 'R225'); add('G2', 225, 43.5, BRIDGE_Y); link('G2', 'G1');
  add('大桥', 225, 51, BRIDGE_Y); link('大桥', 'G2'); add('出口', 225, 67.5, BRIDGE_Y); link('出口', '大桥');

  function route(from, to) {
    if (from === to) return [];
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const open = new Set([from]);
    while (open.size) {
      let u = null, best = Infinity;
      for (const n of open) { const d = dist.get(n); if (d < best) { best = d; u = n; } }
      open.delete(u);
      if (u === to) break;
      const pu = nodes.get(u);
      for (const v of adj.get(u)) {
        const pv = nodes.get(v);
        const nd = best + Math.hypot(pu.x - pv.x, pu.z - pv.z);
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); open.add(v); }
      }
    }
    if (!prev.has(to)) return [];
    const path = [];
    for (let c = to; c !== from; c = prev.get(c)) path.unshift(c);
    return path;
  }
  return { nodes, adj, route };
}

// ---------- 角色 ----------
export class Agent {
  constructor(sim, o) {
    this.id = o.id;
    this.name = o.name || null;
    this.color = o.color;
    this.hair = o.hair || '#3b3542';
    this.pants = o.pants || '#3b3542';
    this.speed = o.speed || 3.4;
    this.plan = o.plan || null;
    this.home = o.home || o.start;
    this.prop = o.prop || null;
    const n = sim.nav.nodes.get(o.start);
    this.node = o.start;
    this.goal = o.start;
    this.place = o.start;
    this.x = n.x; this.z = n.z; this.y = n.y;
    this.path = [];
    this.edge = null;
    this.inside = !!o.inside;
    this.act = o.act || '';
    this.pendingAct = this.act;
    this.pendingInside = this.inside;
    this.heading = Math.random() * Math.PI * 2;
    this.walking = false;
    this.phase = Math.random() * 6;
    this.wait = Math.random() * 10;
    this.pause = 0;
    this.chatCd = 0;
    this.hold = false; // 拍戏时定在原地，不按日程走
  }

  goTo(sim, goal, act, inside) {
    if (goal === this.goal) {
      if (!this.path.length) { this.act = act; this.inside = !!inside; }
      else { this.pendingAct = act; this.pendingInside = !!inside; }
      return;
    }
    this.goal = goal;
    this.pendingAct = act;
    this.pendingInside = !!inside;
    const start = this.path.length ? this.path[0] : this.node;
    const r = sim.nav.route(start, goal);
    this.path = this.path.length ? [this.path[0], ...r.filter(id => id !== this.path[0])] : r;
    this.inside = false;
    this.act = `前往${labelOf(goal)}`;
    if (!this.path.length) this.arrive(sim);
  }

  arrive(sim) {
    this.place = this.goal;
    this.inside = this.pendingInside;
    this.act = this.pendingAct;
    sim.onArrive(this);
  }

  decide(sim) {
    if (this.hold) return;
    if (this.plan) {
      const entries = typeof this.plan === 'function' ? this.plan(sim.day) : this.plan;
      let cur = entries[0];
      for (const e of entries) if (sim.min >= e.t) cur = e;
      this.goTo(sim, cur.at, cur.act, cur.inside);
      return;
    }
    // 群演：晚上回家，白天在镇上随便逛
    const night = sim.min >= 21 * 60 + 30 || sim.min < 6 * 60 + 30;
    if (night) { this.goTo(sim, this.home, '睡觉', true); return; }
    if (this.path.length || this.wait > 0) return;
    this.goTo(sim, pick(sim.wanderSpots), '闲逛', false);
    this.wait = 8 + Math.random() * 26;
  }

  step(sim, dts) {
    this.chatCd = Math.max(0, this.chatCd - dts);
    if (this.pause > 0) { this.pause -= dts; this.walking = false; return; }
    if (!this.path.length) {
      this.walking = false;
      if (this.wait > 0) this.wait -= dts;
      return;
    }
    const nx = sim.nav.nodes.get(this.path[0]);
    if (!this.edge || this.edge.to !== this.path[0]) {
      this.edge = { to: this.path[0], fy: this.y, len: Math.max(0.001, Math.hypot(nx.x - this.x, nx.z - this.z)) };
    }
    const dx = nx.x - this.x, dz = nx.z - this.z;
    const d = Math.hypot(dx, dz);
    const s = this.speed * dts;
    if (d <= s) {
      this.x = nx.x; this.z = nx.z; this.y = nx.y;
      this.node = this.path.shift();
      this.edge = null;
      if (!this.path.length) { this.walking = false; this.arrive(sim); return; }
    } else {
      this.x += dx / d * s;
      this.z += dz / d * s;
      const t = clamp(1 - (d - s) / this.edge.len, 0, 1);
      this.y = this.edge.fy + (nx.y - this.edge.fy) * t;
      this.heading = Math.atan2(dx, dz);
    }
    this.walking = true;
    this.phase += Math.min(dts, 0.25) * 8;
  }
}

function labelOf(id) {
  if (LOCS[id]) return id;
  if (/^h\d+$/.test(id)) return '住处';
  return '街上';
}

// ---------- 世界 ----------
export class Sim {
  constructor() {
    this.nav = buildNav();
    this.day = 1;
    this.min = 6 * 60 + 35;
    this.speed = 1;
    this.sus = 12;
    this.nightFF = false;
    this.events = [];
    this.pending = [];
    this.chatCd = 0;
    this.wanderSpots = ['广场', '报刊亭', '小酒馆', '海滩', '码头', 'P0', 'P180', 'P270',
      ...[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(a => `R${a}`)];
    this.agents = [];

    const T = CAST.林楚;
    this.truman = this.add({ id: '林楚', name: '林楚', color: T.color, hair: T.hair, pants: T.pants, plan: trumanPlan, start: '家', inside: true, act: '睡觉', speed: 3.6 });
    const homes = { 苏梅: '家', 老周: 'h6', 孙伯: 'h1', 林母: 'h3' };
    for (const name of Object.keys(CAST_PLANS)) {
      const c = CAST[name];
      this.add({ id: name, name, color: c.color, hair: c.hair, pants: c.pants, plan: CAST_PLANS[name], start: homes[name], inside: true, act: '睡觉' });
    }
    const props = ['dog', 'stroller', null, null, 'dog', null, null, null, null, null];
    EXTRA_COLORS.forEach((color, i) => {
      const home = `h${i % FILLERS.length}`;
      this.add({ id: `x${i}`, color, hair: pick(['#3b3542', '#5a3a2a', '#2b2b2b', '#8a6a4a']), pants: pick(['#3d4a66', '#55627a', '#4a4a52']), start: home, home, inside: true, act: '睡觉', prop: props[i], speed: 2.8 + Math.random() * 1.2 });
    });
  }

  add(o) { const a = new Agent(this, o); this.agents.push(a); return a; }

  agent(id) { return this.agents.find(a => a.id === id) || null; }

  // 小雨、林父第一次出场时才加入小镇，之后按自己的家闲逛
  spawnGuest(name) {
    const existing = this.agent(name);
    if (existing) return existing;
    const c = CAST[name];
    if (!c) return null;
    return this.add({ id: name, name, color: c.color, hair: c.hair, pants: c.pants, start: c.home, home: c.home, inside: false, act: '登场' });
  }

  nearestNode(x, z) {
    let best = null, bd = Infinity;
    for (const n of this.nav.nodes.values()) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n.id; }
    }
    return best;
  }

  // 把演员放到林楚面前，两人面对面。slot 决定站位，避免几个演员叠在一起
  teleportNear(a, T, slot = 0) {
    const spots = [[1.9, 0], [1.5, 1.6], [1.5, -1.6], [2.8, 0.8]];
    const [f, r] = spots[slot % spots.length];
    const h = T.heading;
    a.x = T.x + Math.sin(h) * f + Math.cos(h) * r;
    a.z = T.z + Math.cos(h) * f - Math.sin(h) * r;
    a.y = T.y;
    a.path = []; a.edge = null; a.walking = false; a.inside = false;
    a.node = this.nearestNode(a.x, a.z);
    a.goal = a.node; a.place = a.node;
    a.wait = 6;
    a.heading = Math.atan2(T.x - a.x, T.z - a.z);
  }

  // 读档后让有日程的角色直接站到该在的地方，不必从家里走过去
  snapToPlans() {
    for (const a of this.agents) {
      if (!a.plan) continue;
      const entries = typeof a.plan === 'function' ? a.plan(this.day) : a.plan;
      let cur = entries[0];
      for (const e of entries) if (this.min >= e.t) cur = e;
      const n = this.nav.nodes.get(cur.at);
      Object.assign(a, { x: n.x, y: n.y, z: n.z, node: cur.at, goal: cur.at, place: cur.at, path: [], edge: null, inside: !!cur.inside, act: cur.act, walking: false });
    }
  }

  emit(type, data) { this.events.push({ type, ...data }); }

  say(agent, text, thought = false) { this.emit('say', { agent, text, thought }); }

  currentPlan() {
    const entries = trumanPlan(this.day);
    let i = 0;
    entries.forEach((e, k) => { if (this.min >= e.t) i = k; });
    return { entries, index: i };
  }

  onArrive(a) {
    if (a !== this.truman || a.inside) return;
    const lines = ARRIVE[a.place];
    if (!lines) return;
    const [who, text] = pick(lines);
    const speaker = this.agents.find(x => x.id === who);
    if (!speaker || speaker.inside) return;
    if (speaker !== a && Math.hypot(speaker.x - a.x, speaker.z - a.z) > 7) return;
    this.say(speaker, text, who === '林楚');
  }

  update(dt) {
    // 林楚在家睡觉时自动夜间快进
    const T = this.truman;
    this.nightFF = this.speed > 0 && T.inside && (this.min >= 21 * 60 + 45 || this.min < 6 * 60 + 30);
    const sp = this.speed === 0 ? 0 : this.nightFF ? 24 : this.speed;
    const dts = dt * sp;
    const prev = this.min;
    this.min += dts * 2;
    if (this.min >= 1440) { this.min -= 1440; this.day++; this.emit('day', { day: this.day }); }
    if (Math.floor(prev / 60) !== Math.floor(this.min / 60)) this.emit('hour', { h: Math.floor(this.min / 60) });
    if (periodOf(prev) !== periodOf(this.min)) this.emit('period', { name: periodOf(this.min) });
    for (const a of this.agents) { a.decide(this); a.step(this, dts); }
    if (sp > 0 && !this.nightFF) this.chatter(dt, dts);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) { this.pending.splice(i, 1); if (!p.agent.inside) this.say(p.agent, p.text, p.thought); }
    }
  }

  chatter(dt, dts) {
    const T = this.truman;
    this.chatCd -= dt;
    if (T.inside) return;
    // 怀疑值高时，他会突然停下来盯着天空
    if (T.walking && this.sus >= 50 && T.pause <= 0 && Math.random() < dts * (this.sus - 45) / 1600) {
      T.pause = 5;
      this.say(T, pick(STARE), true);
      this.chatCd = 6;
      return;
    }
    if (this.chatCd > 0) return;
    const period = periodOf(this.min);
    for (const a of this.agents) {
      if (a === T || a.inside || a.chatCd > 0) continue;
      if (Math.hypot(a.x - T.x, a.z - T.z) > 3.2) continue;
      a.chatCd = 60;
      this.chatCd = 5;
      this.say(a, pick(GREET[period] || GREET.下午));
      if (Math.random() < 0.6) this.pending.push({ t: 1.4, agent: T, text: pick(REPLY[suspicionLevel(this.sus)]) });
      break;
    }
  }
}
