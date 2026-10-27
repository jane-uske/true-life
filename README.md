# 真实人生 True Life

AI 版《模拟人生》+《楚门的世界》。

你是一档 24 小时直播真人秀的导演。主角林楚从出生起就活在一座巨型穹顶摄影棚里，镇上所有人都是演员，只有他不知道。你要安排事件、给演员递耳麦指令、植入广告，把收视率做上去，同时别让他起疑。林楚的反应由大模型实时生成，你预测不了他会怎么做。

## 本地运行

需要 [Node.js](https://nodejs.org/) 18 或更新版本，不需要 `npm install`。

```bash
git clone https://github.com/jane-uske/true-life.git
cd true-life
cp .env.example .env      # 然后打开 .env，填上 DEEPSEEK_API_KEY
npm start                 # 打开 http://localhost:5173/3d.html
```

没有 key 也能玩：页面会自动切到“排练模式”，用预写剧本代替 AI。

## 页面

| 地址 | 内容 |
|---|---|
| `/3d.html` | 3D 版：穹顶小镇实时运转，拖卡安排剧情 |
| `/` | 2D 版：导演控制室，回合制 |

## 3D 版怎么玩

- 小镇一直在走时间，林楚按日程上班、吃饭、去报刊亭、晚上去码头看海。顶部可以暂停或切换 1x / 2x / 4x，空格键暂停。
- **把手牌拖到亮起来的地点名牌上**，林楚走到那里就会开拍；拖到林楚的名牌上，马上开拍。手机上点一下卡，再点地点。
- 放下前会弹出小窗：派哪个演员上场、给他们递一句耳麦指令、要不要植入今天的赞助广告。
- 开拍后时间自动暂停，台词以对话气泡出现在角色头顶。拍完后结算怀疑值、收视和经费，结果写进右侧的“导演笔记”（林楚 / 场记 / 破绽）。
- 没拍的戏会在地点上留一块场记板，名牌上写着预计开拍的时间，点 × 可以撤回并全额退款。
- 收视每小时结算一次，太久没戏看会下滑；每天零点按前一天的收视拨款，早上、中午、晚上各补一张牌。
- 进度自动存在浏览器里，“重开”会清空存档。
- 拖动画面平移，滚轮缩放，Q/E 旋转，F 跟拍林楚。

## AI 怎么接的

- 浏览器只请求本地的 `/api/chat`，由 `server.js` 带上 key 转发给 DeepSeek，再把生成的文字流式传回页面。key 不会出现在浏览器里。
- 服务只监听 `127.0.0.1`，局域网里的其他设备访问不到。
- 导演组的“快速”用 `deepseek-chat`，“精细”用 `deepseek-reasoner`，可以在 `.env` 里改。
- DeepSeek 出错时页面会提示原因：key 无效、余额不足、限流等。剧情只生成到一半时，剩下的部分由排练剧本补完。

## 目录

```
server.js            本地服务 + DeepSeek 转发（无依赖）
public/index.html    可玩版
public/3d.html       3D 版入口
public/game/
  data.js            地图、角色、日程、卡组、文案
  engine.js          时钟、寻路、按日程走动的角色
  story.js           提示词、DeepSeek 调用、排练剧本
  director.js        导演层：放卡、触发、拍戏、结算、存档
  world3d.js         Three.js 场景和像素化渲染
  ui.js / main.js    界面和主循环
public/fonts/        Fusion Pixel 12px 简体中文像素字体
public/vendor/       three.js
```

## 第三方

- [three.js](https://threejs.org/) r160，MIT License
- [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)，作者 TakWolf，SIL Open Font License 1.1
