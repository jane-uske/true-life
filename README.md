# 真实人生 True Life

AI 版《模拟人生》+《楚门的世界》。

你是一档 24 小时直播真人秀的导演。主角林楚从出生起就活在一座巨型穹顶摄影棚里，镇上所有人都是演员，只有他不知道。你要安排事件、给演员递耳麦指令、植入广告，把收视率做上去，同时别让他起疑。林楚的反应由大模型实时生成，你预测不了他会怎么做。

## 本地运行

需要 [Node.js](https://nodejs.org/) 18 或更新版本，不需要 `npm install`。

```bash
git clone https://github.com/jane-uske/true-life.git
cd true-life
cp .env.example .env      # 然后打开 .env，填上 DEEPSEEK_API_KEY
npm start                 # 打开 http://localhost:5173
```

没有 key 也能玩：页面会自动切到“排练模式”，用预写剧本代替 AI。

## 页面

| 地址 | 内容 |
|---|---|
| `/` | 可玩版：2D 导演控制室，回合制，接 DeepSeek |
| `/3d.html` | 3D 像素样机（开发中）：穹顶小镇、昼夜、实时日程、偷拍画中画 |

## AI 怎么接的

- 浏览器只请求本地的 `/api/chat`，由 `server.js` 带上 key 转发给 DeepSeek，再把生成的文字流式传回页面。key 不会出现在浏览器里。
- 服务只监听 `127.0.0.1`，局域网里的其他设备访问不到。
- 导演组的“快速”用 `deepseek-chat`，“精细”用 `deepseek-reasoner`，可以在 `.env` 里改。
- DeepSeek 出错时页面会提示原因：key 无效、余额不足、限流等。剧情只生成到一半时，剩下的部分由排练剧本补完。

## 目录

```
server.js            本地服务 + DeepSeek 转发（无依赖）
public/index.html    可玩版
public/3d.html       3D 样机入口
public/game/         3D 样机的模块：数据、模拟、渲染、界面
public/fonts/        Fusion Pixel 12px 简体中文像素字体
public/vendor/       three.js
```

## 第三方

- [three.js](https://threejs.org/) r160，MIT License
- [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)，作者 TakWolf，SIL Open Font License 1.1
