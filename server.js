// 《真实人生》本地服务：提供静态页面，并把剧情请求转发给 DeepSeek。
// API key 只从 .env 或环境变量读取，不会发到浏览器。
// 需要 Node 18+，没有第三方依赖：node server.js
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
loadEnv(fileURLToPath(new URL('./.env', import.meta.url)));

const PORT = Number(process.env.PORT) || 5173;
const KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
const BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODELS = {
  quick: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  default: process.env.DEEPSEEK_MODEL_SMART || 'deepseek-reasoner',
};
const SYSTEM = '你是互动游戏《真实人生》的剧情引擎。严格按照用户给出的输出格式回答，不要输出格式以外的任何文字。';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('请求太大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(pathname, res) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return json(res, 400, { code: 'bad_path' }); }
  let file = normalize(join(ROOT, rel));
  if (file !== ROOT.slice(0, -1) && !file.startsWith(ROOT)) return json(res, 403, { code: 'forbidden' });
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    json(res, 404, { code: 'not_found', message: `找不到 ${rel.split(sep).join('/')}` });
  }
}

const UPSTREAM_CODE = { 400: 'invalid_request', 401: 'auth_failed', 402: 'no_balance', 422: 'invalid_request', 429: 'rate_limited' };

async function chat(req, res) {
  if (!KEY) return json(res, 503, { code: 'no_key', message: '没有配置 DEEPSEEK_API_KEY' });
  let body;
  try { body = JSON.parse(await readBody(req, 512 * 1024)); } catch { return json(res, 400, { code: 'invalid_request', message: '请求格式不对' }); }
  const prompt = String(body.prompt || '').slice(0, 60000);
  if (!prompt) return json(res, 400, { code: 'invalid_request', message: 'prompt 为空' });
  const model = MODELS[body.tier] || MODELS.quick;

  // 浏览器喊卡或关掉页面时，同时停掉对 DeepSeek 的请求，别浪费额度
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });

  let up;
  try {
    up = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: 2000,
        temperature: 1.1,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
      }),
      signal: ac.signal,
    });
  } catch (e) {
    if (ac.signal.aborted) return;
    return json(res, 502, { code: 'upstream_error', message: `连不上 DeepSeek：${e.message}` });
  }
  if (!up.ok) {
    const detail = (await up.text().catch(() => '')).slice(0, 300);
    const code = UPSTREAM_CODE[up.status] || 'upstream_error';
    console.warn(`[DeepSeek] ${up.status} ${detail}`);
    return json(res, up.status === 401 || up.status === 402 || up.status === 429 ? up.status : 502, { code, message: detail });
  }

  // 把 DeepSeek 的 SSE 拆开，只把正文增量原样写给浏览器
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  const reader = up.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const data = s.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) res.write(delta);
        } catch { /* 跳过不完整的行 */ }
      }
    }
  } catch { /* 浏览器断开 */ }
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/status') return json(res, 200, { ai: !!KEY, provider: 'DeepSeek', models: MODELS });
    if (url.pathname === '/api/chat') {
      if (req.method !== 'POST') return json(res, 405, { code: 'method_not_allowed' });
      return await chat(req, res);
    }
    return await serveStatic(url.pathname, res);
  } catch (e) {
    if (!res.headersSent) json(res, 500, { code: 'server_error', message: String(e.message || e) });
    else res.end();
  }
});

// 只监听本机，别让局域网里的人借你的 key
server.listen(PORT, '127.0.0.1', () => {
  console.log(`《真实人生》已启动：3D 版 http://localhost:${PORT}/  ·  2D 版 http://localhost:${PORT}/2d.html`);
  console.log(KEY ? `AI：DeepSeek（快速 ${MODELS.quick} / 精细 ${MODELS.default}）` : '没有找到 DEEPSEEK_API_KEY，只能用排练模式。复制 .env.example 为 .env 并填上 key。');
});
