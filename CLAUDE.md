# 真实人生 True Life

AI 版《模拟人生》+《楚门的世界》。玩家是一档 24 小时直播真人秀的导演；主角林楚不知道自己活在一座穹顶摄影棚里，镇上所有人都是演员。导演安排事件、派演员、递耳麦指令、植入广告，林楚的反应由 DeepSeek 实时生成。

## 运行

- Node 18+，**没有依赖，没有构建步骤**。
- `cp .env.example .env`，填 `DEEPSEEK_API_KEY`，然后 `npm start`。
- 3D 版：`http://localhost:5173/3d.html`；2D 版：`http://localhost:5173/`。
- 没有 key 也能跑：页面会自动退回“排练模式”（预写剧本）。

## 架构

- `server.js`：静态文件服务，并把 `POST /api/chat`（`{prompt, tier}`）以流式纯文本转发给 DeepSeek。`tier` 为 `quick` 时用 `deepseek-chat`，为 `default` 时用 `deepseek-reasoner`。只监听 127.0.0.1，key 不会到浏览器。`GET /api/status` 返回 AI 是否可用。
- `public/3d.html` + `public/game/`（3D 版，纯 ES 模块）：
  - `data.js`：地图（`LOCS`、`FILLERS`）、日程（`trumanPlan`、`CAST_PLANS`）、卡组 `DECK`（`where` 字段决定能放在哪；`'林楚'` 表示可以直接放在他身上）、角色、文案池。
  - `engine.js`：
    - `Sim`：游戏时钟，1 倍速时现实 1 秒等于游戏 2 分钟；林楚在家睡觉时自动夜间快进。会发出 `hour` / `period` / `day` 事件。
    - 路网 `buildNav().route()`。
    - `Agent`：按日程或随机闲逛；`hold = true` 时拍戏定住，不按日程走。
    - `teleportNear`、`spawnGuest`（小雨、林父首次登场时生成）。
  - `story.js`：提示词（`BIBLE`、`RULES`、`buildPrompt`）、`callAI`（逐行解析 JSON）、`offlineScene` / `offlineEnd`、错误码文案。
  - `director.js`：导演层。`place` → `checkTriggers` → `runScene` → `applyEnd`；按小时 / 时段 / 天结算。存档放在 localStorage 的 `truelife.3d.v2`。
  - `world3d.js`：Three.js r160（`public/vendor/` 里的本地副本）。
    - 像素管线：低分辨率渲染目标 + 深度/法线描边 + 最近邻放大；相机吸附像素网格，小数部分在后处理里补偿。
    - 穹顶 shader：`uSus` 控制面板裂缝。
    - 方块小人、场记板标记、偷拍 CRT 画中画。
  - `ui.js`：手牌拖放 / 点选、放置小窗、待拍名牌、导演笔记抽屉（林楚 / 场记 / 破绽）、顶部数值、弹幕、提示。
  - `main.js`：启动、3D 名牌和对话气泡、镜头操作、主循环。
- `public/index.html`：2D 回合制版本，单文件。里面还有没搬到 3D 的代码可以直接复用：`buildFinalePrompt`、`runFinale`、`ENDINGS`、`renderOverlay`、`ACCIDENTS`、`drawAccident`。
- `public/fonts/`：Fusion Pixel 12px 简体（OFL）。

## 约定

- 保持零依赖、零构建，不引入打包工具和框架。
- 界面文案用简体中文，口吻直白。
- 像素字体只用 12px 或 24px，保证像素对齐。
- 每个 AI 功能都要有离线排练路径，AI 出错时游戏不能卡住。错误按 `story.js` 的 `ERR` / `PERMANENT_WHY` 分类处理：可恢复的错误退钱并回滚；永久性错误切到排练模式。
- AI 返回的文字一律用 `textContent` 写进页面，不用 `innerHTML`。
- 绝不提交 `.env`。提交前用 grep 确认仓库里没有 `sk-` 开头的 key。

## 测试

- 每个文件先跑 `node --check`（`package.json` 设了 `"type": "module"`）。
- 浏览器测试用 Playwright 无头 Chromium。WebGL 需要启动参数 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`；首次编译着色器很慢，等待时间要放宽到 90 秒以上。
- 页面暴露 `window.__booted`（已启动）、`window.__game = { sim, director, world, ui }`、`window.__perf()`，脚本可以用它们读状态、跳时间（`sim.min = …`）。
- 大部分流程用排练模式测（导演组选“排练”，或设 `director.D.crew = 'offline'`），只留一两场用真 DeepSeek，省额度。
- 每次测完截桌面 1360×900 和手机 400×860 各一张图，确认控制台无报错、页面无横向滚动。

## 已知坑

- 浮动名牌（`.labels > *`）不要用 CSS 的 `scale` / `rotate` 属性：它们会把 `transform` 里的定位偏移一起变换，名牌会被甩开。需要强调时，改用 padding 或描边。
- `html` / `body` / `#game` 必须是 `overflow: clip`。用 `hidden` 时，按钮获得焦点后浏览器会把整个画面滚走。
- `THREE.ColorManagement.enabled = false`，输出颜色空间是 Linear：十六进制颜色原样显示，不做 sRGB 转换。
- `renderer.shadowMap.autoUpdate = false`，每帧在主通道前设 `needsUpdate = true`。法线通道和 CRT 通道复用这张阴影图。
- 法线通道（描边用）要先隐藏穹顶和追踪光圈，否则穹顶近侧会盖住一切。
- 打断走路中的角色后，要设 `goal = null`，`node` 也要改成最近的节点，否则 `goTo` 会认为已经到达而不重新寻路。
- `pkill -f "node server.js"` 会把执行它的 shell 自己也杀掉，要用 `pkill -f '^node server\.js$'`。
