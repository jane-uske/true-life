// 导演层：收视、经费、手牌、待拍的戏、拍摄流程和结算。规则大多沿用 v0.1 的 applyEnd / advance。
import { CARD, DECK, CAST, LOCS, SPONSOR_PAY, sponsorOf, trumanPlan } from './data.js';
import { fmtClock, clamp, pick } from './engine.js';
import { buildPrompt, callAI, offlineScene, offlineEnd, offlineMind, ERR, PERMANENT_WHY, ai, aiReady, clean, buildDiaryPrompt, sanitizeStops, offlineDiary } from './story.js';

const SAVE_KEY = 'truelife.3d.v2';
const wait = ms => new Promise(r => setTimeout(r, ms));
const int = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const sgn = n => (n > 0 ? '+' : '') + n;
const noop = () => {};
const ESCAPE_SPEED = 4.4;

function fresh(crew = 'quick') {
  return {
    v: 2, day: 1, min: 6 * 60 + 35, sus: 12,
    ratings: 820, hist: [742, 768, 790, 805, 820], dayRatings: [], total: 0, lastCat: null, sinceScene: 0,
    budget: 300, hand: ['promo', 'dog', 'ex', 'beer'], pending: [], seq: 1,
    clues: [], memos: ['第1天早上：对着镜子练习问去云屿群岛的船几点开'],
    minds: [{ d: '第 1 天 · 06:35', text: '又是晴天。晴港好像从来没下过一场像样的雨。有时候我觉得，整个镇子都在等我出门。' }],
    intent: '下班后去报刊亭，看看新到的旅行杂志',
    flags: { yu: false, dad: false }, used: [], pendingEscape: false, take: 0, crew,
    extraStops: {}, diaries: [], diaryDay: 0,
    escape: null, escapeRest: 0, finale: false, ended: null,
    log: [
      { k: 'day', text: '第 1 天' },
      { k: 'sys', text: '把手牌拖到小镇的地点上，林楚走到那里就会开拍；拖到林楚身上，马上开拍。' },
      { k: 'sys', text: `今日赞助商：${sponsorOf(1).n}。` },
    ],
  };
}

export class Director {
  constructor(sim, world) {
    this.sim = sim;
    this.world = world;
    this.hooks = { say: noop, caption: noop, shooting: noop, danmu: noop, toast: noop, changed: noop };
    this.busy = false;
    this.inFlight = false;
    this.skip = false;
    this.ctl = null;
    this.tok = 0;
    this.D = this.load() || fresh();
    const D = this.D;
    sim.day = D.day; sim.min = D.min; sim.sus = D.sus;
    sim.extraStops = D.extraStops;
    if (D.flags.yu) sim.spawnGuest('小雨');
    if (D.flags.dad) sim.spawnGuest('林父');
    sim.snapToPlans();
    if (D.escape) sim.truman.speed = ESCAPE_SPEED;
    world.syncPeople();
    for (const p of D.pending) if (p.target !== '林楚') world.addMarker(p.id, p.target);
  }

  // ---------- 存档 ----------
  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      // M2 的存档没有日记、出逃、结局这些字段，用新档的默认值补上
      if (s && s.v === 2 && Array.isArray(s.hand) && Array.isArray(s.log)) return Object.assign(fresh(s.crew), s);
    } catch { /* 存储不可用或内容损坏 */ }
    return null;
  }
  save() {
    const D = this.D;
    D.day = this.sim.day; D.min = this.sim.min; D.sus = this.sim.sus;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(D)); } catch { /* 隐私模式等 */ }
  }
  reset() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    location.reload();
  }

  pushLog(entry) {
    this.D.log.push(entry);
    if (this.D.log.length > 220) this.D.log.splice(0, 60);
  }
  pushHist(r) {
    this.D.hist.push(r);
    if (this.D.hist.length > 30) this.D.hist.shift();
  }

  mode() {
    if (this.D.crew === 'offline' || ai.blocked || !ai.ok) return 'offline';
    return this.D.crew === 'default' ? 'default' : 'quick';
  }

  actorAvailable(name) {
    if (name === '小雨') return this.D.flags.yu;
    if (name === '林父') return this.D.flags.dad;
    return !!CAST[name];
  }

  // ---------- 放卡 ----------
  eta(target) {
    const T = this.sim.truman;
    if (target === '林楚') return { now: true, text: '马上开拍' };
    if (T.place === target && !T.path.length) return { now: true, text: '他就在这儿，马上开拍' };
    if (T.goal === target) return { text: '他正在过去' };
    if (this.D.escape && target === '码头' && !this.D.escape.bridge) return { text: '他在逃，放阻拦卡他会改道来这里' };
    const e = this.sim.planFor(this.sim.day).find(x => x.t > this.sim.min && x.at === target);
    return e ? { text: `预计 ${fmtClock(e.t)} 后` } : { never: true, text: '他今天不会来这里' };
  }

  place(cardId, target, opts = {}) {
    const D = this.D, c = CARD[cardId];
    if (!c || !D.hand.includes(cardId) || !c.where.includes(target)) return false;
    if (c.cost > D.budget) { this.hooks.toast('经费不够了。', true); return false; }
    const actor = c.lock ? c.actor : (opts.actor && this.actorAvailable(opts.actor) ? opts.actor : null);
    const p = { id: D.seq++, card: cardId, target, actor, whisper: clean(opts.whisper, 80), sponsor: !!opts.sponsor, day: this.sim.day };
    D.budget += (p.sponsor ? SPONSOR_PAY : 0) - c.cost;
    D.hand.splice(D.hand.indexOf(cardId), 1);
    D.pending.push(p);
    const bits = [`安排「${c.t}」→ ${target === '林楚' ? '林楚身边' : target}`, actor || '只有群演'];
    if (p.whisper) bits.push(`耳麦「${p.whisper}」`);
    if (p.sponsor) bits.push(`植入 ${sponsorOf(p.day).n}`);
    this.pushLog({ k: 'dir', text: bits.join('｜') });
    if (target !== '林楚') this.world.addMarker(p.id, target);
    this.save();
    this.hooks.changed();
    this.checkTriggers();
    return true;
  }

  withdraw(id) {
    const D = this.D, p = D.pending.find(x => x.id === id);
    if (!p || this.busy) return;
    const c = CARD[p.card];
    D.pending = D.pending.filter(x => x !== p);
    D.budget += c.cost - (p.sponsor ? SPONSOR_PAY : 0);
    D.hand.push(p.card);
    this.world.removeMarker(p.id);
    this.pushLog({ k: 'dir', text: `撤回「${c.t}」，经费已退回` });
    this.save();
    this.hooks.changed();
  }

  // 每帧调用一次：拍戏触发、写日记
  tick() {
    this.checkTriggers();
    this.checkDiary();
    this.checkEscape();
  }

  snapshot() {
    const sim = this.sim, D = this.D;
    const tag = `第${sim.day}天`;
    return { day: sim.day, clock: fmtClock(sim.min), sus: sim.sus, intent: D.intent, clues: D.clues, memos: D.memos, activity: sim.truman.act, today: D.memos.filter(m => m.startsWith(tag)), escape: D.pendingEscape };
  }

  checkTriggers() {
    if (this.busy) return;
    const T = this.sim.truman;
    const p = this.D.pending.find(x => x.target === '林楚' || (!T.path.length && x.target === T.place));
    if (p) this.runScene(p);
  }

  placeOf(T) {
    if (!T.path.length && LOCS[T.place]) return T.place;
    let best = '广场', bd = Infinity;
    for (const name of Object.keys(LOCS)) {
      const n = this.sim.nav.nodes.get(name);
      const d = Math.hypot(n.x - T.x, n.z - T.z);
      if (d < bd) { bd = d; best = name; }
    }
    return bd < 6 ? best : `${best}附近的路上`;
  }

  // ---------- 拍戏 ----------
  async runScene(p) {
    const sim = this.sim, T = sim.truman, D = this.D, world = this.world;
    const card = CARD[p.card];
    this.busy = true;
    this.skip = false;
    D.pending = D.pending.filter(x => x !== p);
    world.removeMarker(p.id);
    this.prevSpeed = sim.speed || 1;
    sim.speed = 0;

    const place = p.target === '林楚' ? this.placeOf(T) : p.target;
    const ctx = { card, actor: p.actor, whisper: p.whisper, sponsor: p.sponsor ? sponsorOf(p.day) : null, escapeBefore: D.pendingEscape, place, onTruman: p.target === '林楚' };
    const S = { day: sim.day, clock: fmtClock(sim.min), sus: sim.sus, intent: D.intent, clues: D.clues, memos: D.memos, activity: T.act };

    // 布景：林楚走出来面朝广场，演员站到他面前
    T.hold = true;
    T.inside = false;
    T.pause = 0;
    if (T.path.length) { T.path = []; T.edge = null; T.node = sim.nearestNode(T.x, T.z); T.goal = null; }
    T.walking = false;
    T.heading = Math.atan2(-T.x, -T.z);
    const cast = [];
    const bring = (name) => {
      if (!name || name === '林楚' || !CAST[name]) return null;
      let a = sim.agent(name);
      if (!a) { a = sim.spawnGuest(name); world.syncPeople(); }
      if (!cast.includes(a)) { a.hold = true; sim.teleportNear(a, T, cast.length); cast.push(a); }
      return a;
    };
    bring(ctx.actor);
    world.focusScene();

    const before = D.log.length;
    this.pushLog({ k: 'take', n: D.take + 1, day: sim.day, time: S.clock, place, title: card.t });
    const mode = this.mode();
    this.hooks.shooting(true, { n: D.take + 1, place, title: card.t });
    this.hooks.caption(mode === 'offline' ? '排练组正在走位……' : '导演组正在写这场戏……');
    this.hooks.changed();

    const tok = ++this.tok;
    let chain = Promise.resolve();
    const q = fn => { chain = chain.then(() => (tok === this.tok ? fn() : undefined)); };
    const got = { beats: 0, mind: '', end: null };
    const onObj = (o) => {
      if (!o || typeof o !== 'object') return;
      if (o.k === 'scene') { const cam = clean(o.cam, 14); if (cam) world.camOverride = cam; }
      else if (o.k === 'beat') { if (got.beats < 10) { got.beats++; q(() => this.playBeat(o, bring)); } }
      else if (o.k === 'mind') got.mind = clean(o.text, 240);
      else if (o.k === 'end') got.end = o;
    };

    try {
      if (mode === 'offline') await offlineScene(ctx, onObj, sim.sus);
      else {
        this.ctl = new AbortController();
        this.inFlight = true;
        this.hooks.changed();
        await callAI(buildPrompt(ctx, S), mode, this.ctl.signal, onObj);
      }
    } catch (e) {
      const code = (e && e.code) || 'upstream_error';
      if (PERMANENT_WHY[code]) {
        ai.blocked = PERMANENT_WHY[code];
        this.pushLog({ k: 'sys', text: `${ai.blocked}。这场改用排练剧本。` });
        if (!got.beats) await offlineScene(ctx, onObj, sim.sus);
      } else if (code === 'invalid_request' || code === 'cancelled' || !got.beats) {
        // 这场不算：回滚场记，退钱，卡还回手里
        this.tok++;
        D.log.length = before;
        D.budget += card.cost - (p.sponsor ? SPONSOR_PAY : 0);
        D.hand.push(card.id);
        this.inFlight = false;
        this.ctl = null;
        this.finish(cast);
        this.hooks.toast(ERR[code] || ERR.upstream_error, true);
        return;
      } else {
        this.pushLog({ k: 'sys', text: '信号中断，后半场由排练组补完。' });
      }
    }
    this.inFlight = false;
    this.ctl = null;
    this.hooks.changed();
    await chain;
    if (!got.mind) got.mind = offlineMind(sim.sus);
    if (!got.end) got.end = offlineEnd(ctx, sim.sus);
    this.applyEnd(ctx, got);
    await wait(this.skip ? 200 : 1200);
    this.finish(cast);
  }

  async playBeat(o, bring) {
    const who = clean(o.who, 8) || '旁白', say = clean(o.say, 90), act = clean(o.act, 90);
    if (!say && !act) return;
    const T = this.sim.truman;
    const agent = who === '林楚' ? T : CAST[who] ? bring(who) : null;
    if (agent && agent !== T) agent.heading = Math.atan2(T.x - agent.x, T.z - agent.z);
    this.pushLog({ k: 'beat', who, say, act });
    const ms = this.skip ? 220 : clamp(1000 + (say.length + act.length) * 55, 1500, 4200);
    if (agent && say) {
      this.hooks.say(agent, say, ms / 1000 + 0.5, false);
      this.hooks.caption(act ? `${who}（${act}）` : '');
    } else {
      this.hooks.caption(`${who !== '旁白' ? `${who}：` : ''}${say || act}`);
    }
    this.hooks.changed();
    await wait(ms);
  }

  finish(cast) {
    const sim = this.sim;
    sim.truman.hold = false;
    for (const a of cast) a.hold = false;
    sim.speed = this.prevSpeed || 1;
    this.world.camOverride = null;
    this.busy = false;
    this.hooks.caption('');
    this.hooks.shooting(false);
    this.save();
    this.hooks.changed();
  }

  cut() { if (this.ctl) this.ctl.abort(); }
  fastForward() { this.skip = true; }

  applyEnd(ctx, got) {
    const sim = this.sim, D = this.D, e = got.end;
    const delta = clamp(int(e.delta), -12, 30);
    const esc = ctx.escapeBefore && ctx.card.cat !== 'block' ? 15 : 0;
    const s0 = sim.sus;
    sim.sus = clamp(s0 + delta + esc, 0, 100);
    const drama = clamp(int(e.drama) || ctx.card.drama, 1, 10);
    const tired = D.lastCat === ctx.card.cat;
    const target = 420 + drama * 85 - (tired ? 80 : 0) + Math.round(Math.random() * 60 - 30);
    const r = Math.max(120, Math.round(D.ratings * 0.5 + target * 0.5));
    D.ratings = r;
    this.pushHist(r);
    D.dayRatings.push(r);
    D.total += r;
    D.lastCat = ctx.card.cat;
    D.sinceScene = 0;
    D.take++;
    if (ctx.card.id === 'ex') D.flags.yu = true;
    if (ctx.card.id === 'father') D.flags.dad = true;
    if (ctx.card.once) D.used.push(ctx.card.id);
    const clock = fmtClock(sim.min);
    const noticed = clean(e.noticed, 60);
    if (noticed) D.clues.push({ d: `${sim.day}·${clock}`, t: noticed });
    const memo = clean(e.memo, 60);
    if (memo) { D.memos.push(`第${sim.day}天${clock}：${memo}`); if (D.memos.length > 12) D.memos.shift(); }
    const intent = clean(e.intent, 30);
    if (intent) D.intent = intent;
    D.pendingEscape = e.escape === true || e.escape === 'true' || sim.sus >= 85;
    D.minds.unshift({ d: `第 ${sim.day} 天 · ${clock}`, text: got.mind });
    D.minds.length = Math.min(D.minds.length, 3);
    const note = clean(e.actor_note, 70);
    if (note) this.pushLog({ k: 'note', text: note });
    this.pushLog({ k: 'res', text: `怀疑 ${s0} → ${sim.sus}（${sgn(delta)}${esc ? '，没拦住他 +15' : ''}） · 收视 ${r.toLocaleString('zh-CN')} 万${tired ? '（同类戏连播，观众腻了）' : ''}` });
    // 阻拦戏拦住了他：正在逃就送回家；还没动身的，这几个小时也先不走
    if (ctx.escapeBefore && ctx.card.cat === 'block') {
      D.escapeRest = sim.abs + 240;
      if (D.escape) this.stopEscape();
    }
    const dm = Array.isArray(e.danmu) ? e.danmu.map(x => clean(x, 24)).filter(Boolean).slice(0, 6) : [];
    this.hooks.danmu(dm);
  }

  // ---------- 实时出逃 ----------
  blockAt(place) { return this.D.pending.some(p => p.target === place && CARD[p.card].cat === 'block'); }

  // 他想走（escape 为真或怀疑值 ≥85）时，在日程空档动身：大桥 → 出口。
  // 码头上有阻拦卡、大桥上没有时，他会先绕去码头找船，被拦就照常开拍。
  checkEscape() {
    const sim = this.sim, T = sim.truman, D = this.D;
    if (this.busy || D.finale || D.ended) return;
    if (!D.escape) {
      if (T.override && sim.abs >= T.override.until) T.override = null;
      if (!D.pendingEscape || T.override || sim.abs < D.escapeRest) return;
      if (sim.min < 7 * 60 || sim.min >= 21 * 60) return;
      const { entries, index } = sim.currentPlan();
      if (entries[index].inside) return;
      this.startEscape();
    }
    const E = D.escape, here = T.path.length ? null : T.place;
    if (here === '出口') { this.enterFinale(); return; }
    if (here === '大桥') E.bridge = true;
    if (here === '码头') E.dock = true;
    const via = !E.bridge && !E.dock && this.blockAt('码头') && !this.blockAt('大桥') ? '码头' : null;
    const at = E.bridge ? '出口' : via || '大桥';
    const act = at === '出口' ? '走向出口' : at === '码头' ? '去码头找船' : '朝大桥跑去';
    if (!T.override || T.override.at !== at) T.override = { at, act, until: Infinity };
  }

  startEscape() {
    const sim = this.sim, T = sim.truman, D = this.D;
    D.escape = { since: sim.abs, dock: false, bridge: false };
    T.speed = ESCAPE_SPEED;
    T.pause = 0;
    this.hooks.say(T, '（就是现在。）', 3, true);
    this.pushLog({ k: 'sys', text: `${fmtClock(sim.min)} 林楚丢下手里的事，朝大桥走去。他要离开晴港。` });
    let extra = '';
    if (!D.hand.some(id => CARD[id].cat === 'block')) { const id = this.deal(); if (id) extra = `导演组紧急调来「${CARD[id].t}」。`; }
    this.hooks.toast(`林楚正在逃离！往大桥或码头放阻拦卡拦住他。${extra}`, true);
    this.save();
    this.hooks.changed();
  }

  stopEscape() {
    const sim = this.sim, T = sim.truman, D = this.D;
    D.escape = null;
    T.speed = 3.6;
    T.override = { at: '家', act: '被劝回家', until: sim.abs + 150 };
    this.pushLog({ k: 'sys', text: '拦住了。林楚垂头丧气地往家走。' });
  }

  enterFinale() {
    const sim = this.sim, T = sim.truman, D = this.D;
    D.escape = null;
    D.finale = true;
    T.speed = 3.6;
    T.override = { at: '出口', act: '站在门前', until: Infinity };
    T.hold = true;
    T.heading = Math.atan2(Math.cos(225 * Math.PI / 180), Math.sin(225 * Math.PI / 180));
    sim.speed = 0;
    this.pushLog({ k: 'sys', text: '林楚走到了大桥的尽头。天空原来是一面墙，墙上有一扇门。' });
    this.save();
    this.hooks.changed();
  }

  // ---------- 每晚日记 ----------
  // 23:00 以后林楚在家时写一次。写完之前，时间最多走到第二天 06:00
  checkDiary() {
    const sim = this.sim, T = sim.truman, D = this.D;
    if (this.diaryBusy || this.busy || D.diaryDay >= sim.day || sim.min < 23 * 60) return;
    if (T.place !== '家' || !T.inside || T.path.length) return;
    this.writeDiary();
  }

  async writeDiary() {
    const sim = this.sim, D = this.D, day = sim.day;
    this.diaryBusy = true;
    sim.gate = (day + 1) * 1440 + 6 * 60;
    this.hooks.changed();
    const S = this.snapshot();
    const got = { diary: null, plan: null };
    const onObj = (o) => {
      if (!o || typeof o !== 'object') return;
      if (o.k === 'diary' && !got.diary) got.diary = o;
      else if (o.k === 'plan' && !got.plan) got.plan = o;
    };
    await aiReady;
    if (this.mode() !== 'offline') {
      try {
        await callAI(buildDiaryPrompt(S, trumanPlan(day + 1)), 'quick', AbortSignal.timeout(45000), onObj);
      } catch (e) {
        const code = (e && e.code) || 'upstream_error';
        if (PERMANENT_WHY[code]) ai.blocked = PERMANENT_WHY[code];
        this.pushLog({ k: 'sys', text: `${PERMANENT_WHY[code] || 'DeepSeek 没交日记'}，这篇由排练组代写。` });
      }
    }
    const fb = offlineDiary(S);
    const text = clean(got.diary && got.diary.text, 90) || fb.diary.text;
    const plan = got.plan || fb.plan;
    const stops = sanitizeStops(plan.stops);
    const escape = plan.escape === true || plan.escape === 'true' || sim.sus >= 85;

    for (const k of Object.keys(D.extraStops)) if (Number(k) <= day) delete D.extraStops[k];
    D.extraStops[day + 1] = stops;
    D.diaryDay = day;
    const intent = clean(plan.intent, 30);
    if (intent) D.intent = intent;
    D.pendingEscape = escape;
    D.diaries.unshift({ day, text });
    D.diaries.length = Math.min(D.diaries.length, 7);
    this.pushLog({ k: 'diary', day, text });
    const what = stops.map(x => `${fmtClock(x.t)} ${x.at} · ${x.act}`).join('；');
    this.pushLog({ k: 'sys', text: `林楚给明天加了安排：${what || '没有，照常过'}${escape ? '。他决定离开晴港。' : '。'}` });
    sim.gate = null;
    this.diaryBusy = false;
    this.save();
    this.hooks.changed();
  }

  // ---------- 时间推进 ----------
  onClock(ev) {
    const D = this.D;
    if (ev.type === 'hour') {
      D.sinceScene++;
      if (D.sinceScene > 1) D.ratings = Math.max(300, D.ratings - 12);
      this.pushHist(D.ratings);
      D.dayRatings.push(D.ratings);
      this.save();
    } else if (ev.type === 'period' && ['早上', '下午', '晚上'].includes(ev.name)) {
      if (D.hand.length < 4) {
        const id = this.deal();
        if (id) this.hooks.toast(`${ev.name}了，补到一张牌：「${CARD[id].t}」`);
      }
    } else if (ev.type === 'day') {
      const avg = D.dayRatings.length ? Math.round(D.dayRatings.reduce((a, b) => a + b, 0) / D.dayRatings.length) : D.ratings;
      D.dayRatings = [];
      const income = clamp(Math.round(40 + (avg - 600) / 6), 20, 160);
      D.budget += income;
      const expired = D.pending.filter(p => p.target !== '林楚');
      for (const p of expired) {
        D.budget += Math.round(CARD[p.card].cost / 2);
        this.world.removeMarker(p.id);
      }
      D.pending = D.pending.filter(p => p.target === '林楚');
      this.pushLog({ k: 'day', text: `第 ${ev.day} 天` });
      this.pushLog({ k: 'sys', text: `电视台结算：昨天平均收视 ${avg.toLocaleString('zh-CN')} 万，拨款 +${income} 万。今日赞助商：${sponsorOf(ev.day).n}。${expired.length ? `昨天没拍成的 ${expired.length} 场作废，退回一半经费。` : ''}` });
      this.save();
    }
    this.hooks.changed();
  }

  deal() {
    const D = this.D;
    const pool = DECK.filter(c => !D.hand.includes(c.id) && !(c.once && D.used.includes(c.id)) && !(c.id === 'ex' && D.flags.yu));
    if (!pool.length) return null;
    const blocks = pool.filter(c => c.cat === 'block');
    const needBlock = D.pendingEscape && !D.hand.some(id => CARD[id].cat === 'block') && blocks.length;
    const c = needBlock ? pick(blocks) : pick(pool);
    D.hand.push(c.id);
    this.save();
    return c.id;
  }
}
