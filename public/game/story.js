// 剧情引擎：拼提示词、调用本地 /api/chat（再转给 DeepSeek）、解析逐行 JSON、AI 不可用时的排练剧本。
// 大部分内容搬自 v0.1（public/index.html），只把“时段”换成了具体时间和地点。
import { CAST, MINDS, INTENTS, DANMU } from './data.js';
import { pick, clamp } from './engine.js';

const pickN = (a, n) => a.slice().sort(() => Math.random() - 0.5).slice(0, n);
export const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
export const level = s => (s < 30 ? 0 : s < 60 ? 1 : s < 85 ? 2 : 3);

const BIBLE = `【世界设定】
主角林楚，33岁，在海边小镇"晴港"出生长大，从没离开过。他不知道：晴港是一座巨型穹顶摄影棚，天空是画出来的，太阳是一盏灯，镇上所有人都是演员，全世界在24小时直播他的人生，已经播了一万多天。
林楚是晴港海湾保险公司的理赔员。7岁那年父亲在海上"遇难"，从此他怕水。他一直梦想去南方的云屿群岛，常在报刊亭翻旅行杂志；忘不了大学时的初恋小雨，她当年突然"随家人搬走"了。性格温和、幽默、有礼貌，骨子里好奇，一旦起疑会刨根问底。
演员表（括号里是演员的私心，林楚不知道）：
- 苏梅：林楚的妻子，护士。（敬业，但早就厌倦了这份工作；念植入广告时特别生硬）
- 老周：林楚从小到大的好兄弟。（老戏骨，即兴能力最强，最会安抚林楚；其实真把他当兄弟）
- 林母：林楚的妈妈。（爱煽情，常记错台词）
- 小雨：林楚的初恋。（当年想告诉他真相，被节目组送走；一直同情他，容易说漏嘴）
- 孙伯：报刊亭老板，小镇万事通。（爱加戏，嘴碎）
- 林父：林楚"遇难"的父亲。（只在"父亲归来"之后出现，演技拙劣）
地点：家、报刊亭、保险公司、广场、小酒馆、海滩、码头、大桥（大桥是离开晴港的唯一道路）。`;

const RULES = `【写作要求】
写一场5到8个镜头的短戏。林楚是有自由意志的真人，反应要真实、具体、带点幽默，不一定按导演的剧本走。怀疑值越高他越敏感：30以上会留意巧合，60以上会主动试探（突然改路线、盯着人追问），85以上一心想离开晴港。演员会犯错、加戏、露马脚。
delta是这场戏后怀疑值的变化：平淡温馨的戏-8到+2；有明显巧合或广告念得生硬+3到+10；舞台事故、演员说漏嘴+10到+25；真诚有效的安抚-5到-12。
drama是观众觉得这场戏多好看（1到10）：平淡1到3，有冲突或感情5到7，大事件或事故8到10。
【输出格式】只输出若干行，每行一个完整的JSON对象，不要代码块，不要任何别的文字：
第1行：{"k":"scene","cam":"这场用的隐藏摄像头，比如纽扣摄像头、路灯摄像头、后视镜摄像头"}
接着5到8行：{"k":"beat","who":"林楚、演员名、群演或旁白","say":"台词，没有就填空字符串","act":"动作或画面，没有就填空字符串"}
接着1行：{"k":"mind","text":"林楚此刻的内心独白，第一人称，40到90字"}
最后1行：{"k":"end","delta":整数,"drama":整数,"noticed":"他这场新注意到的破绽，没有就填空字符串","intent":"他接下来想做什么，15字以内","escape":布尔值（他现在是否打算离开晴港）,"memo":"从林楚的视角一句话总结这场戏，30字以内","actor_note":"演员的失误或私心，没有就填空字符串","danmu":["4到6条观众弹幕，网络口吻，每条15字以内"]}
每条台词和动作都不超过40个字。全部用简体中文。`;

function riskHint(r) {
  return r <= -2 ? '这是安抚戏，演得好能明显降低怀疑' : r < 0 ? '偏温和，略能降低怀疑' : r === 0 ? '很安全' : r <= 2 ? '有点巧合，可能引起注意' : '风险很高，很容易露馅';
}

// S：当前状态快照 { day, clock, sus, intent, clues, memos, activity }
export function buildPrompt(ctx, S) {
  const L = ['你是互动游戏《真实人生》的剧情引擎。玩家扮演一档24小时直播真人秀的导演，你负责根据导演的安排写出这一场戏。', BIBLE];
  L.push(`【当前状态】第${S.day}天 ${S.clock}。林楚的怀疑值 ${S.sus}/100（0=深信不疑，100=确信世界是假的）。`);
  L.push(`林楚此刻：在${ctx.place}，${S.activity || '闲着'}。`);
  L.push(`林楚的打算：${S.intent || '无'}`);
  L.push(`他之前注意到的破绽：${S.clues.slice(-6).map(c => c.t).join('；') || '暂无'}`);
  L.push(`最近发生的事：${S.memos.slice(-6).join('；') || '这是第一场戏'}`);
  if (ctx.escapeBefore) {
    L.push(ctx.card.cat === 'block'
      ? '注意：林楚之前决定离开晴港，导演这一场用阻拦事件拦他。他可能被拦住，也可能因此更起疑。'
      : '注意：林楚之前决定离开晴港，导演这一场没有阻拦。描写他找机会朝大桥或码头去，离出口更近了。');
  }
  L.push('【导演对这场戏的安排】');
  L.push(`地点：${ctx.place}${ctx.onTruman ? '（导演把戏直接安排在林楚身边，事件要自然地找上他）' : ''}`);
  L.push(`事件：${ctx.card.t}——${ctx.card.d}`);
  L.push(`派出演员：${ctx.actor ? `${ctx.actor}（${CAST[ctx.actor].role}）` : '无，只有群演'}`);
  L.push(`耳麦指令：${ctx.whisper ? `「${ctx.whisper}」（导演悄悄告诉演员的话。演员会尽力执行，但可能演得生硬，或按自己的私心发挥）` : '无'}`);
  L.push(`植入广告：${ctx.sponsor ? `${ctx.sponsor.n}，广告词「${ctx.sponsor.s}」。演员必须在戏里生硬地念出来，这是笑点。` : '无'}`);
  L.push(`本场事件的风险提示：${riskHint(ctx.card.risk)}`);
  L.push(RULES);
  return L.join('\n');
}

export function parseLine(line, onObj) {
  let s = line.trim();
  if (!s) return;
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  if (s.startsWith('[')) { try { const a = JSON.parse(s); if (Array.isArray(a)) a.forEach(onObj); } catch { /* skip */ } return; }
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return;
  try { onObj(JSON.parse(s.slice(i, j + 1))); } catch { /* 跳过坏行 */ }
}

// ---------- AI 调用 ----------
export const ERR = {
  rate_limited: 'DeepSeek 限流了，稍等一会儿再拍。经费已退回，卡也还给你了。',
  invalid_request: 'DeepSeek 拒绝了这次请求，换个安排再试试。经费已退回。',
  cancelled: '喊卡！这场不算，经费已退回，卡也还给你了。',
  empty_completion: '导演组交了白卷，换个安排再试试。经费已退回。',
  upstream_error: '信号中断（连不上 DeepSeek），这场没拍成。经费已退回，可以重新放卡。',
};
// 这些错误重试也没用：切到排练模式，并说明原因
export const PERMANENT_WHY = {
  no_key: '本地服务没有配置 DEEPSEEK_API_KEY，先用排练剧本',
  auth_failed: 'DeepSeek 说 key 无效，检查 .env 后重启服务',
  no_balance: 'DeepSeek 余额不足，充值后刷新页面',
};

export const ai = { ok: false, checked: false, blocked: '', models: { quick: 'deepseek-chat', default: 'deepseek-reasoner' } };
export const aiReady = fetch('/api/status', { cache: 'no-store' })
  .then(r => r.json())
  .then(s => { ai.ok = !!(s && s.ai); if (s && s.models) ai.models = s.models; })
  .catch(() => { ai.ok = false; })
  .finally(() => { ai.checked = true; });

async function llmStream(prompt, tier, signal, onText) {
  const fail = (code, message, text) => Object.assign({ code, message }, text ? { text } : {});
  let res;
  try {
    res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, tier }), signal });
  } catch (e) {
    throw fail(e && e.name === 'AbortError' ? 'cancelled' : 'upstream_error', String(e && e.message || e));
  }
  if (!res.ok) {
    let j = {};
    try { j = await res.json(); } catch { /* 不是 JSON */ }
    throw fail(j.code || 'upstream_error', j.message || res.statusText);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const delta = dec.decode(value, { stream: true });
      if (!delta) continue;
      text += delta;
      onText(delta);
    }
  } catch (e) {
    throw fail(e && e.name === 'AbortError' ? 'cancelled' : 'upstream_error', String(e && e.message || e), text);
  }
  if (!text.trim()) throw fail('empty_completion', 'DeepSeek 没有返回内容');
  return text;
}

export async function callAI(prompt, tier, signal, onObj) {
  let pending = '';
  await llmStream(prompt, tier, signal, (delta) => {
    const parts = (pending + delta).split('\n');
    pending = parts.pop();
    parts.forEach(l => parseLine(l, onObj));
  });
  if (pending.trim()) parseLine(pending, onObj);
}

// ---------- 排练剧本（不用 AI） ----------
const wait = ms => new Promise(r => setTimeout(r, ms));

export const offlineMind = sus => pick(MINDS[level(sus)]);

export function offlineEnd(ctx, sus) {
  const c = ctx.card;
  const delta = c.risk * 3 - 2 + (ctx.sponsor ? 4 : 0) + (ctx.whisper ? 2 : 0) + Math.round(Math.random() * 4 - 2);
  const after = sus + delta;
  const A = ctx.actor || '群演';
  return {
    delta, drama: clamp(c.drama + Math.round(Math.random() * 2 - 1), 1, 10),
    noticed: ctx.sponsor && Math.random() < 0.6 ? `${A}说话像在念广告词` : '',
    intent: pick(INTENTS[level(after)]), escape: after >= 80 && Math.random() < 0.7,
    memo: `在${ctx.place}：${c.t}`, actor_note: '', danmu: pickN(DANMU, 4),
  };
}

export async function offlineScene(ctx, onObj, sus) {
  const c = ctx.card, A = ctx.actor || '群演';
  onObj({ k: 'scene', cam: '' });
  const ad = ['这事儿我也是刚听说。', '你别多想，都是好事。', '哎呀，真巧啊！'];
  const beats = (c.fb || []).map(([who, say, act]) => {
    if (who === '{A}' && ctx.actor !== c.actor) return { k: 'beat', who: A, say: A === '群演' ? '' : pick(ad), act: A === '群演' ? '群演们面面相觑' : '' };
    return { k: 'beat', who: who.replace('{A}', A), say: say.replaceAll('{A}', A), act: act.replaceAll('{A}', A) };
  });
  if (ctx.whisper) beats.splice(1, 0, { k: 'beat', who: A, say: '', act: `按耳麦指示行事：${ctx.whisper}` });
  if (ctx.sponsor) beats.push({ k: 'beat', who: A === '群演' ? '旁白' : A, say: A === '群演' ? '' : ctx.sponsor.s, act: `突然举起一罐${ctx.sponsor.n}，对着空气微笑` });
  if (ctx.escapeBefore) beats.push(c.cat === 'block' ? { k: 'beat', who: '旁白', say: '', act: '林楚本想去大桥，却被拦了下来' } : { k: 'beat', who: '旁白', say: '', act: '林楚趁乱朝大桥走去，离出口更近了' });
  for (const b of beats) { onObj(b); await wait(60); }
  onObj({ k: 'mind', text: offlineMind(sus) });
  onObj(Object.assign({ k: 'end' }, offlineEnd(ctx, sus)));
}
