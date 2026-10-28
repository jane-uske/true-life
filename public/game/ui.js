// 导演的操作界面：手牌拖放 / 点选、放置小窗、待拍名牌、右侧抽屉（林楚 / 场记 / 破绽）、
// 顶部数值、拍摄提示条、弹幕和提示。3D 名牌和对话气泡在 main.js 里，这里通过 labels 读它们的位置。
import { CARD, CAT, CAST, ROSTER, SPONSOR_PAY, sponsorOf, MINDS, ENDINGS } from './data.js';
import { fmtClock, periodOf } from './engine.js';
import { ai, level } from './story.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const colorOf = (who) => (CAST[who] && CAST[who].color) || '#c9d2e3';
const SNAP = 70;
const rankOf = avg => (avg >= 1000 ? 'S' : avg >= 900 ? 'A' : avg >= 780 ? 'B' : 'C');

export class UI {
  constructor({ sim, world, director, labels, addBubble }) {
    Object.assign(this, { sim, world, director, labels, addBubble });
    this.armed = null;
    this.drag = null;
    this.popOpen = false;
    this.pins = new Map();
    this.logKey = '';
    this.handKey = '';
    this.hudT = 0;
    this.toastT = 0;
    this.bind();
  }

  hooks() {
    return {
      say: (agent, text, life, thought) => this.addBubble(agent, text, thought, life),
      caption: (t) => { $('#shoot-cap').textContent = t; },
      shooting: (on, info) => this.setShooting(on, info),
      danmu: (list) => this.danmu(list),
      toast: (msg, bad) => this.toast(msg, bad),
      changed: () => { this.hudT = 0; },
    };
  }

  // ---------- 绑定一次性的控件 ----------
  bind() {
    const { sim, director } = this;
    document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => { if (!director.locked) this.setSpeed(Number(b.dataset.speed)); }));
    $('#finale-go').addEventListener('click', () => {
      const w = $('#finale-words').value.trim();
      if (!w) { this.toast('先写点什么；不想说话就点“保持沉默”。', true); $('#finale-words').focus(); return; }
      director.runFinale(w);
    });
    $('#finale-silent').addEventListener('click', () => director.runFinale(''));
    $('#end-restart').addEventListener('click', () => director.reset());
    $('#endbar-restart').addEventListener('click', () => director.reset());
    $('#end-log').addEventListener('click', () => {
      director.D.ended.hidden = true;
      director.save();
      $('#drawer').classList.add('open');
      $('#drawer-tab').setAttribute('aria-expanded', 'true');
      this.showTab('log');
      this.hudT = 0;
    });
    $('#endbar-show').addEventListener('click', () => { delete director.D.ended.hidden; director.save(); this.hudT = 0; });
    $('#crew').addEventListener('change', (e) => { director.D.crew = e.target.value; director.save(); this.hudT = 0; });
    $('#skip').addEventListener('click', () => director.fastForward());
    $('#cut').addEventListener('click', () => director.cut());
    document.querySelectorAll('[role="tab"]').forEach(t => t.addEventListener('click', () => this.showTab(t.dataset.tab)));
    $('#dbg-sus').addEventListener('input', (e) => { sim.sus = Number(e.target.value); this.hudT = 0; });
    document.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => { sim.min = Number(b.dataset.jump); }));
    const rs = $('#restart');
    rs.addEventListener('click', () => {
      if (rs.dataset.armed) { director.reset(); return; }
      rs.dataset.armed = '1'; rs.textContent = '确定重开？';
      setTimeout(() => { delete rs.dataset.armed; rs.textContent = '重开'; }, 3000);
    });
    addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.popOpen) this.closePopover();
      else if (this.armed) this.disarm();
    });
    $('#hand-cards').addEventListener('pointerdown', (e) => {
      const card = e.target.closest('.card');
      if (card && !card.disabled) this.cardDown(e, card.dataset.id, card);
    });
  }

  setSpeed(s) {
    this.sim.speed = s;
    document.querySelectorAll('[data-speed]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s)));
  }

  showTab(name) {
    document.querySelectorAll('[role="tab"]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    document.querySelectorAll('[role="tabpanel"]').forEach(p => { p.hidden = p.dataset.tab !== name; });
    if (name === 'log') { const box = $('#log'); box.scrollTop = box.scrollHeight; }
  }

  // ---------- 手牌 ----------
  renderHand() {
    const D = this.director.D;
    const box = $('#hand-cards');
    box.replaceChildren();
    D.hand.forEach((id, i) => {
      const c = CARD[id];
      if (!c) return;
      const b = el('button', 'card');
      b.type = 'button';
      b.dataset.cat = c.cat;
      b.dataset.id = id;
      b.style.setProperty('--r', `${(i - (D.hand.length - 1) / 2) * 4}deg`);
      const n = Math.ceil(c.drama / 2);
      const risk = c.risk > 0 ? `风险${'▲'.repeat(c.risk)}` : c.risk < 0 ? `降疑${'▼'.repeat(-c.risk)}` : '风险—';
      b.append(el('span', 'stamp', CAT[c.cat]), el('b', '', c.t), el('span', 'd', c.d), el('span', 'meta', `收视${'●'.repeat(n)}${'○'.repeat(5 - n)} ${risk}`), el('span', 'cost', c.cost ? `${c.cost} 万` : '免费'));
      const poor = c.cost > D.budget;
      b.disabled = poor;
      b.title = poor ? '经费不够' : '拖到小镇的地点上；也可以点一下，再点地点';
      if (this.armed === id) b.classList.add('armed');
      box.append(b);
    });
    $('#hand-note').textContent = D.hand.length ? '拖到亮起来的地点上，或者点卡再点地点' : '手牌用完了，早上、中午、晚上各补一张';
  }

  cardDown(e, id, btn) {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let dragging = false;
    const move = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) { dragging = true; this.beginDrag(id, btn); }
      if (dragging) this.moveDrag(ev.clientX, ev.clientY);
    };
    const done = (ev, cancelled) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      if (dragging) this.endDrag(ev.clientX, ev.clientY, cancelled);
      else if (!cancelled) this.toggleArm(id);
    };
    const up = (ev) => done(ev, false);
    const cancel = (ev) => done(ev, true);
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
  }

  beginDrag(id, btn) {
    this.disarm();
    const ghost = btn.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.disabled = true;
    document.getElementById('game').append(ghost);
    btn.classList.add('lifted');
    this.drag = { id, btn, ghost, hot: null };
    this.markTargets(id);
  }

  moveDrag(x, y) {
    const d = this.drag;
    // 卡片影子浮在指针上方，别挡住要放的地点
    d.ghost.style.transform = `translate(${x - 58}px, ${y - 196}px) rotate(-4deg) scale(.85)`;
    const hot = this.nearestTarget(x, y, CARD[d.id].where);
    if (hot !== d.hot) { d.hot = hot; this.markTargets(d.id, hot && hot.name); }
  }

  endDrag(x, y, cancelled) {
    const d = this.drag;
    this.drag = null;
    d.ghost.remove();
    d.btn.classList.remove('lifted');
    this.markTargets(null);
    const t = cancelled ? null : this.nearestTarget(x, y, CARD[d.id].where);
    if (t) this.openPopover(d.id, t.name, t.x, t.y);
    else if (!cancelled) this.toast('没放到地点上。拖到亮起来的地点名牌附近再松手。');
  }

  toggleArm(id) {
    if (this.armed === id) { this.disarm(); return; }
    this.armed = id;
    this.markTargets(id);
    const c = CARD[id];
    this.toast(`点亮起来的地点放下「${c.t}」${c.where.includes('林楚') ? '，也可以点林楚的名牌' : ''}。再点一次卡片取消。`);
    this.renderHand();
  }

  disarm() {
    if (!this.armed) return;
    this.armed = null;
    this.markTargets(null);
    this.renderHand();
  }

  // 被点到的地点名牌或林楚名牌（来自 main.js）
  dropOn(name) {
    if (!this.armed) return false;
    const c = CARD[this.armed];
    if (!c.where.includes(name)) { this.toast(`「${c.t}」不能放在${name === '林楚' ? '林楚身上' : name}。`, true); return true; }
    const pos = name === '林楚' ? this.labels.truman : this.labels.loc[name];
    const id = this.armed;
    this.disarm();
    this.openPopover(id, name, pos ? pos.x : innerWidth / 2, pos ? pos.y : innerHeight / 2);
    return true;
  }

  nearestTarget(x, y, where) {
    let best = null, bd = SNAP;
    const consider = (name, p) => {
      if (!p || p.hidden) return;
      const d = Math.hypot(p.x - x, p.y - 12 - y);
      if (d < bd) { bd = d; best = { name, x: p.x, y: p.y }; }
    };
    for (const name of where) consider(name, name === '林楚' ? this.labels.truman : this.labels.loc[name]);
    return best;
  }

  markTargets(id, hot) {
    const where = id ? CARD[id].where : null;
    for (const [name, t] of Object.entries(this.labels.locEls)) {
      t.classList.toggle('ok', !!where && where.includes(name));
      t.classList.toggle('dim', !!where && !where.includes(name));
      t.classList.toggle('hot', hot === name);
    }
    const tt = this.labels.trumanEl;
    tt.classList.toggle('ok', !!where && where.includes('林楚'));
    tt.classList.toggle('hot', hot === '林楚');
    document.getElementById('game').classList.toggle('placing', !!id);
  }

  // ---------- 放置小窗 ----------
  openPopover(id, target, x, y) {
    const { director, sim } = this;
    const D = director.D, c = CARD[id];
    this.closePopover();
    this.popOpen = true;
    this.popSpeed = sim.speed;
    if (!director.busy) sim.speed = 0; // 选演员的时候先暂停，跟《模拟人生》一样
    const pop = $('#pop');
    pop.replaceChildren();
    const eta = director.eta(target);
    const head = el('div', 'pop-head');
    const stamp = el('span', 'stamp', CAT[c.cat]);
    stamp.dataset.cat = c.cat;
    head.append(stamp, el('b', '', c.t));
    const where = el('p', eta.never ? 'pop-where warn' : 'pop-where', target === '林楚' ? '放在林楚身上 · 马上开拍' : `放在${target} · ${eta.text}`);
    pop.append(head, el('p', 'pop-desc', c.d), where);

    let actor = c.lock ? c.actor : (c.actor && director.actorAvailable(c.actor) ? c.actor : null);
    const chips = el('div', 'chips');
    const names = ROSTER.filter(n => n !== '林父' || D.flags.dad || c.actor === '林父').concat([null]);
    const renderChips = () => {
      chips.replaceChildren();
      for (const name of names) {
        const b = el('button', 'achip');
        b.type = 'button';
        const avail = name ? director.actorAvailable(name) || (c.lock && c.actor === name) : true;
        b.disabled = !avail || (c.lock && c.actor !== name);
        b.setAttribute('aria-pressed', String(actor === name));
        const dot = el('i');
        dot.style.background = name ? CAST[name].color : '#8f9cb7';
        b.append(dot, el('span', '', name || '只用群演'));
        if (name && !avail) b.title = name === '小雨' ? '小雨还没回到晴港' : '还没登场';
        b.addEventListener('click', () => { actor = name; renderChips(); note.textContent = noteOf(); });
        chips.append(b);
      }
    };
    const noteOf = () => (actor ? `${actor} · ${CAST[actor].note}` : '群演只会按路线走来走去，不会主动推动剧情。') + (c.lock ? '（这张卡指定了演员）' : '');
    const note = el('p', 'pop-note', '');
    renderChips();
    note.textContent = noteOf();

    const wl = el('label', 'pop-label', '耳麦指令（可选。演员会照做……尽量）');
    wl.htmlFor = 'pop-whisper';
    const whisper = el('input');
    whisper.id = 'pop-whisper';
    whisper.maxLength = 80;
    whisper.autocomplete = 'off';
    whisper.placeholder = '例：让他不经意提起，下周要去外地出差';
    const sp = sponsorOf(sim.day);
    const sl = el('label', 'pop-sponsor');
    const sponsor = el('input');
    sponsor.type = 'checkbox';
    sponsor.id = 'pop-sponsor';
    sl.append(sponsor, el('span', '', `植入今日赞助：${sp.n}（+${SPONSOR_PAY} 万，台词会很生硬）`));
    const cost = el('p', 'pop-cost', `花费 ${c.cost} 万 · 现有 ${D.budget} 万`);
    const btns = el('div', 'pop-btns');
    const cancel = el('button', 'pbtn', '取消');
    cancel.type = 'button';
    const ok = el('button', 'pbtn primary', target === '林楚' || eta.now ? '开拍' : '放下');
    ok.type = 'button';
    btns.append(cancel, ok);
    pop.append(el('p', 'pop-label', '派谁上场'), chips, note, wl, whisper, sl, cost, btns);
    cancel.addEventListener('click', () => this.closePopover());
    ok.addEventListener('click', () => {
      const opts = { actor, whisper: whisper.value, sponsor: sponsor.checked };
      this.closePopover();
      if (director.place(id, target, opts)) this.renderHand();
    });
    whisper.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });

    pop.hidden = false;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, x + 24))}px`;
    pop.style.top = `${Math.max(80, Math.min(innerHeight - h - 12, y - h / 2))}px`;
    ok.focus();
  }

  closePopover() {
    if (!this.popOpen) return;
    this.popOpen = false;
    $('#pop').hidden = true;
    if (!this.director.busy) this.sim.speed = this.popSpeed ?? this.sim.speed;
    this.setSpeed(this.sim.speed);
  }

  // ---------- 拍摄状态 ----------
  setShooting(on, info) {
    $('#shoot').hidden = !on;
    document.getElementById('game').classList.toggle('shooting', on);
    if (on) $('#shoot-title').textContent = `场 ${info.n} · ${info.place} · ${info.title}`;
    else this.setSpeed(this.sim.speed);
    this.hudT = 0;
  }

  danmu(list) {
    if (!list.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = $('#danmu');
    list.forEach((txt, i) => {
      setTimeout(() => {
        const s = el('span', '', txt);
        s.style.top = `${4 + (i % 4) * 24}px`;
        box.append(s);
        const dist = box.clientWidth + s.offsetWidth + 24;
        s.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-dist}px)` }], { duration: 7000 + Math.random() * 3000, easing: 'linear' }).onfinish = () => s.remove();
      }, i * 650 + Math.random() * 400);
    });
  }

  toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.hidden = false;
    this.toastT = bad ? 6 : 4.5;
  }

  // ---------- 每帧 ----------
  frame(dt) {
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('#toast').hidden = true; }
    this.updatePins();
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.25; this.updateHud(); }
  }

  updatePins() {
    const D = this.director.D;
    const live = new Set();
    for (const p of D.pending) {
      if (p.target === '林楚') continue;
      live.add(p.id);
      let pin = this.pins.get(p.id);
      if (!pin) {
        pin = el('div', 'pin');
        const x = el('button', 'pin-x', '×');
        x.type = 'button';
        x.title = '撤回这张卡，经费全退';
        x.addEventListener('click', () => this.director.withdraw(p.id));
        pin.append(el('b', '', `待拍 · ${CARD[p.card].t}`), el('small', '', ''), x);
        this.labels.layer.append(pin);
        this.pins.set(p.id, pin);
      }
      const m = this.world.markerPos(p.id);
      if (!m) { pin.hidden = true; continue; }
      const eta = this.director.eta(p.target);
      if (pin.lastChild.previousSibling.textContent !== eta.text) pin.lastChild.previousSibling.textContent = eta.text;
      const s = this.world.project(m.x, m.y + 3.2, m.z);
      pin.hidden = false;
      pin.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
    }
    for (const [id, pin] of this.pins) if (!live.has(id)) { pin.remove(); this.pins.delete(id); }
  }

  updateHud() {
    const { sim, director } = this;
    const D = director.D, T = sim.truman;
    $('#clock-day').textContent = `第 ${sim.day} 天`;
    $('#clock-time').textContent = fmtClock(sim.min);
    const per = $('#clock-period');
    per.textContent = D.ended ? '已收播' : D.finale && !director.busy ? '最终幕' : director.busy ? '拍摄中' : sim.gated || director.diaryBusy ? '写日记' : sim.nightFF ? '夜间快进' : sim.speed === 0 ? '暂停' : periodOf(sim.min);
    per.classList.toggle('ff', sim.nightFF || !!director.diaryBusy);
    $('#showday').textContent = `直播第 ${(12409 + sim.day).toLocaleString('zh-CN')} 天`;

    $('#rate').textContent = D.ratings.toLocaleString('zh-CN');
    $('#rate').classList.toggle('low', D.ratings < 600);
    $('#budget').textContent = D.budget.toLocaleString('zh-CN');
    const s = sim.sus;
    $('#sus-val').textContent = s;
    const bar = $('#sus-bar');
    bar.style.width = `${s}%`;
    bar.style.backgroundColor = s < 30 ? 'var(--calm)' : s < 60 ? 'var(--sky)' : s < 85 ? 'var(--warn)' : 'var(--tally)';
    if (document.activeElement !== $('#dbg-sus')) $('#dbg-sus').value = s;
    $('#dbg-sus-v').textContent = s;
    this.spark(D.hist);

    const crew = $('#crew');
    if (document.activeElement !== crew) crew.value = D.crew;
    $('#ai-status').textContent = D.crew === 'offline' ? '排练模式：预写剧本，不花 AI 额度'
      : !ai.checked ? '正在连接 AI…'
        : ai.blocked ? ai.blocked
          : !ai.ok ? '没连上 DeepSeek，先用排练剧本'
            : `DeepSeek 在线 · ${D.crew === 'default' ? ai.models.default : ai.models.quick}`;

    document.querySelectorAll('[data-speed]').forEach(b => { b.disabled = director.locked; });
    const game = document.getElementById('game');
    game.classList.toggle('finale-on', D.finale && !D.ended);
    game.classList.toggle('ended-on', !!D.ended);
    const fin = $('#finale');
    const showFin = D.finale && !D.ended && !director.busy;
    if (fin.hidden === showFin) { fin.hidden = !showFin; if (showFin && innerWidth >= 760) $('#finale-words').focus(); }
    $('#endbar').hidden = !D.ended || !D.ended.hidden;
    if (D.ended) $('#endbar-t').textContent = `本季已结束：${ENDINGS[D.ended.type].title}`;
    this.renderOverlay();
    $('#cut').hidden = !director.inFlight;
    $('#skip').hidden = !director.busy || director.inFlight;

    const esc = $('#alert-esc');
    const run = !!D.escape;
    esc.hidden = (!D.pendingEscape && !run) || D.finale || !!D.ended;
    esc.classList.toggle('run', run);
    if (run) esc.textContent = `林楚正在逃离！他${T.override && T.override.at === '出口' ? '已经过了大桥，正走向出口' : T.override && T.override.at === '码头' ? '正去码头找船' : '正朝大桥跑去'}。往大桥或码头放阻拦卡拦住他。`;
    else if (D.pendingEscape) esc.textContent = `警报：林楚打算离开晴港（${D.intent}）。日程一有空档他就会动身；下一场不出阻拦卡，怀疑值额外 +15。`;

    // 林楚面板
    $('#t-place').textContent = T.gone ? '穹顶外面' : T.path.length ? '路上' : /^h\d/.test(T.place) ? '别人家' : T.place;
    $('#t-act').textContent = T.gone ? '已经离开了晴港' : director.busy ? '拍戏中' : T.act || '—';
    const plan = sim.planFor(sim.day);
    let idx = 0;
    plan.forEach((e, k) => { if (sim.min >= e.t) idx = k; });
    const next = plan[idx + 1];
    $('#t-next').textContent = D.finale || D.ended ? '—' : next ? `${fmtClock(next.t)} ${next.at} · ${next.act}` : '明天 06:40 起床';
    $('#t-intent').textContent = D.intent || '暂时没什么打算';
    const mind = D.minds[0];
    $('#t-mind-d').textContent = mind ? mind.d : '';
    $('#t-mind').textContent = `「${mind ? mind.text : MINDS[level(s)][0]}」`;
    const diary = D.diaries[0];
    $('#t-diary-d').textContent = diary ? `第 ${diary.day} 天` : '';
    $('#t-diary').textContent = director.diaryBusy ? '（他正在写……）' : diary ? diary.text : '还没写。每晚 23:00 他回家后会写一篇。';
    const schedKey = `${sim.day}:${idx}:${plan.length}`;
    if (schedKey !== this.schedKey) {
      this.schedKey = schedKey;
      const ol = $('#t-sched');
      ol.replaceChildren();
      plan.forEach((e, i) => {
        if (i === 0) return;
        const li = el('li', i === idx ? 'now' : i < idx ? 'done' : '');
        if (e.extra) li.classList.add('extra');
        li.append(el('time', '', fmtClock(e.t)), el('span', '', `${e.at} · ${e.act}${e.extra ? '（日记）' : ''}`));
        ol.append(li);
      });
    }

    // 场记和破绽：内容有变化才重画
    const last = D.log[D.log.length - 1];
    const logKey = `${D.log.length}:${last ? last.text || last.say || last.act || last.title : ''}`;
    if (logKey !== this.logKey) { this.logKey = logKey; this.renderLog(); this.renderClues(); }
    const handKey = `${D.hand.join(',')}:${D.budget}:${this.armed}`;
    if (handKey !== this.handKey) { this.handKey = handKey; this.renderHand(); }
  }

  // ---------- 结局弹窗 ----------
  renderOverlay() {
    const D = this.director.D, E = D.ended;
    const ov = $('#overlay');
    const key = E && !E.hidden ? `${E.type}:${E.day}` : '';
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    if (!key) { ov.hidden = true; return; }
    let text;
    if (E.type === 'leave') text = `林楚最后说：“${E.last}”然后他对着天空鞠了一躬，推开门，走进了门外的光里。全世界的观众愣了几秒，然后有人开始换台。`;
    else if (E.type === 'stay') text = `“${E.last}”门在他面前慢慢关上。第二天早上，晴港照常天晴。节目还在继续。`;
    else if (E.type === 'cancel') text = '收视连续三小时低于 600 万，电视台撤下了《真实人生》。第二天早上，林楚推开家门，发现整条街空无一人。他犹豫了一下，朝大桥走去。';
    else {
      const r = rankOf(E.avg);
      const lines = { S: '林楚什么都没发现，观众却离不开他了。电视台当场给你续约三季。', A: '一季好戏。林楚还在晴港，观众还在追，赞助商排着队。', B: '平稳的一季。林楚偶尔会盯着天空发呆，但他还在。', C: '平平无奇的一季。他没发现，观众也没怎么看。' };
      text = `平均收视 ${E.avg.toLocaleString('zh-CN')} 万，评级 ${r}。${lines[r]}`;
    }
    $('#end-eyebrow').textContent = `本季结局 · 第 ${E.day} 天`;
    $('#end-title').textContent = ENDINGS[E.type].title;
    $('#end-rank').hidden = E.type !== 'season';
    $('#end-rank').textContent = E.type === 'season' ? rankOf(E.avg) : '';
    $('#end-text').textContent = text;
    const dl = $('#end-stats');
    dl.replaceChildren();
    for (const [k, v] of [['播出', `${E.day} 天`], ['拍了', `${D.take} 场`], ['平均收视', `${E.avg.toLocaleString('zh-CN')} 万`], ['最终怀疑', this.sim.sus], ['破绽', `${D.clues.length} 条`]]) {
      const d = el('div');
      d.append(el('dt', '', k), el('dd', '', String(v)));
      dl.append(d);
    }
    ov.hidden = false;
    $('#end-restart').focus();
  }

  spark(h) {
    const W = 64, H = 22, lo = Math.min(300, ...h), hi = Math.max(1250, ...h);
    const X = i => (h.length < 2 ? W : (i / (h.length - 1)) * (W - 4) + 2);
    const Y = v => H - 3 - ((v - lo) / (hi - lo)) * (H - 6);
    const pts = h.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const ly = Y(600).toFixed(1);
    $('#spark').innerHTML = `<line x1="0" x2="${W}" y1="${ly}" y2="${ly}" stroke="rgba(255,182,72,.6)" stroke-dasharray="2 2" stroke-width="1"/><polyline points="${pts}" fill="none" stroke="#8fd3ff" stroke-width="1.6"/><rect x="${(X(h.length - 1) - 2).toFixed(1)}" y="${(Y(h[h.length - 1]) - 2).toFixed(1)}" width="4" height="4" fill="#8fd3ff"/>`;
  }

  renderLog() {
    const box = $('#log');
    const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.replaceChildren();
    for (const L of this.director.D.log.slice(-140)) {
      let n;
      if (L.k === 'day') n = el('div', 'l-day', L.text);
      else if (L.k === 'take') { n = el('div', 'l-take'); n.append(el('span', 'slate', `场 ${L.n}`), el('span', '', `第${L.day}天 ${L.time} · ${L.place}`), el('em', '', L.title)); }
      else if (L.k === 'dir') n = el('div', 'l-dir', L.text);
      else if (L.k === 'beat') {
        if (L.say) {
          n = el('div', 'l-beat');
          const w = el('span', 'who', L.who);
          w.style.color = colorOf(L.who);
          const body = el('span');
          body.append(el('span', '', L.say));
          if (L.act) body.append(el('span', 'act', `（${L.act}）`));
          n.append(w, body);
        } else n = el('div', 'l-act', L.who && L.who !== '旁白' ? `${L.who}${L.act}` : L.act);
      } else if (L.k === 'note') n = el('div', 'l-note', `场务备注：${L.text}`);
      else if (L.k === 'diary') { n = el('div', 'l-diary'); n.append(el('span', 'slate', `日记 · 第${L.day}天`), el('p', '', L.text)); }
      else if (L.k === 'res') n = el('div', 'l-res', L.text);
      else n = el('div', 'l-sys', L.text);
      box.append(n);
    }
    if (stick) box.scrollTop = box.scrollHeight;
    const takes = this.director.D.take;
    $('#tab-log-n').textContent = takes ? String(takes) : '';
  }

  renderClues() {
    const D = this.director.D;
    const ul = $('#clues');
    ul.replaceChildren();
    $('#tab-clue-n').textContent = D.clues.length ? String(D.clues.length) : '';
    if (!D.clues.length) { ul.append(el('li', 'empty', '还没有。他目前对一切深信不疑。')); return; }
    for (const c of D.clues.slice().reverse()) { const li = el('li'); li.append(el('time', '', c.d), el('span', '', c.t)); ul.append(li); }
  }
}
