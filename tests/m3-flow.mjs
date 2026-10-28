// M3 验收：4 倍速跑完“拍一场戏 → 日记 → 第二天日程变化 → 出逃 → 没拦住 → 最终幕 → 结局弹窗”。
// 桌面 1360×900 用鼠标，手机 400×860 用触屏点按。默认用排练模式；加 --real 时日记和最终幕走真 DeepSeek。
//
//   npm start                        # 另开一个终端
//   PW=/path/to/node_modules/playwright/index.mjs node tests/m3-flow.mjs [--real] [--only=desktop|mobile]
//
// 仓库本身零依赖：Playwright 从 $PW 或全局安装的 playwright 加载。$CHROME 可以指定浏览器可执行文件。
const BASE = process.env.BASE || 'http://localhost:5173/';
const REAL = process.argv.includes('--real');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const OUT = process.env.OUT || 'tests/shots';
const { chromium } = await import(process.env.PW || 'playwright');
const { mkdirSync } = await import('node:fs');
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
function check(ok, what, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

async function run(name, { w, h, mobile }) {
  console.log(`\n== ${name} ${w}×${h}${REAL ? '（真 DeepSeek）' : '（排练模式）'} ==`);
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  const press = sel => (mobile ? page.tap(sel) : page.click(sel));
  const boot = async () => page.waitForFunction(() => window.__booted, null, { timeout: 120000 });

  await page.goto(BASE);
  await boot();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await boot();
  await page.selectOption('#crew', REAL ? 'quick' : 'offline');
  if (REAL) {
    const ok = await page.evaluate(async () => (await fetch('/api/status').then(r => r.json())).ai);
    check(ok, 'DeepSeek 已连上');
  }

  // 1. 中午在广场，用点卡 → 点林楚名牌的方式拍一场（排练模式，真 AI 模式也用排练拍这一场省额度）
  await page.evaluate(() => { const { sim, director } = window.__game; director.D.crew = 'offline'; sim.min = 12 * 60 + 2; sim.snapToPlans(); });
  await sleep(800);
  await press('#hand-cards .card[data-id="dog"]');
  await press('.tag.star');
  await page.waitForSelector('#pop:not([hidden])');
  await press('#pop .pbtn.primary');
  await page.waitForFunction(() => window.__game.director.D.take >= 1 && !window.__game.director.busy, null, { timeout: 60000 });
  check(true, '点卡 → 点林楚 → 开拍，拍完一场');
  if (REAL) await page.evaluate(() => { window.__game.director.D.crew = 'quick'; });

  // 2. 让他起疑到想走，跳到 22:50，4 倍速等日记
  await page.evaluate(() => { const { sim } = window.__game; sim.sus = 88; sim.min = 22 * 60 + 50; sim.snapToPlans(); });
  await press('[data-speed="4"]');
  await page.waitForFunction(() => window.__game.director.D.diaries.length > 0, null, { timeout: 120000 });
  const diary = await page.evaluate(() => {
    const { director } = window.__game, D = director.D;
    return { text: D.diaries[0].text, stops: D.extraStops[2] || [], escape: D.pendingEscape, inLog: D.log.some(l => l.k === 'diary') };
  });
  check(diary.text.length > 0 && diary.text.length <= 90, '23:00 写了日记', diary.text);
  check(diary.inLog, '日记写进了场记');
  check(diary.stops.length > 0, '日记给第二天加了行程', diary.stops.map(s => `${Math.floor(s.t / 60)}:${String(s.t % 60).padStart(2, '0')} ${s.at} ${s.act}`).join('；'));
  check(diary.escape, '日记决定出逃');
  await page.waitForFunction(() => window.__game.sim.day === 2, null, { timeout: 120000 });
  await sleep(600);
  const sched = await page.evaluate(() => [...document.querySelectorAll('#t-sched li.extra')].map(li => li.textContent));
  check(sched.length > 0, '第二天日程里出现日记加的站', sched.join(' / '));

  // 3. 第二天早上有空档就动身，没人拦，一路走到出口
  await page.waitForFunction(() => window.__game.director.D.escape, null, { timeout: 120000 });
  await sleep(500);
  const run1 = await page.evaluate(() => ({ tag: document.querySelector('.tag.star').textContent, alert: document.querySelector('#alert-esc').textContent, clock: document.querySelector('#clock-time').textContent }));
  check(run1.tag.includes('正在逃离') && run1.alert.includes('正在逃离'), `${run1.clock} 动身出逃，名牌和警报都提示了`);
  await page.screenshot({ path: `${OUT}/${name}-escape.png` });
  await page.waitForFunction(() => window.__game.director.D.finale, null, { timeout: 120000 });
  await page.waitForSelector('#finale:not([hidden])');
  check(true, '没拦住，走到出口，进入最终幕');
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/${name}-finale.png` });

  // 4. 最终幕：桌面说一段话，手机保持沉默
  if (mobile) await press('#finale-silent');
  else {
    await page.fill('#finale-words', '我看着你长大。外面没有剧本，也没有人会在你摔倒前铺好垫子。你想走，我不拦你。');
    await press('#finale-go');
  }
  await page.waitForSelector('#overlay:not([hidden])', { timeout: 180000 });
  await sleep(400);
  const end = await page.evaluate(() => ({
    title: document.querySelector('#end-title').textContent,
    text: document.querySelector('#end-text').textContent,
    beats: window.__game.director.D.log.filter(l => l.k === 'beat').slice(-6).map(l => `${l.who}：${l.say || l.act}`),
    hscroll: document.documentElement.scrollWidth > innerWidth,
  }));
  check(['他推开了那扇门', '他留了下来'].includes(end.title), '结局弹窗', `${end.title}｜${end.text}`);
  for (const b of end.beats) console.log(`      ${b}`);
  check(!end.hscroll, '页面没有横向滚动');
  await page.screenshot({ path: `${OUT}/${name}-ending.png` });

  // 5. 重新开播：存档清空，回到第 1 天
  await press('#end-restart');
  await boot();
  const restarted = await page.evaluate(() => ({ day: window.__game.sim.day, ended: window.__game.director.D.ended, ov: document.querySelector('#overlay').hidden }));
  check(restarted.day === 1 && !restarted.ended && restarted.ov, '“重新开播”回到第 1 天');

  check(errors.length === 0, '控制台没有报错', errors.join(' | '));
  await browser.close();
}

if (ONLY !== 'mobile') await run('desktop', { w: 1360, h: 900, mobile: false });
if (ONLY !== 'desktop') await run('mobile', { w: 400, h: 860, mobile: true });
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
