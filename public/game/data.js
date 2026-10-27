// 晴港的地理、角色和日程。所有角度单位是度，世界坐标 x = cos(a)·r，z = sin(a)·r。
export const DEG = Math.PI / 180;
export const ISLAND_R = 44;
export const SAND_R = 47.5;
export const DOME_R = 70;
export const RING_R = 22;
export const SPOT_R = 26.2;
export const GROUND_Y = 0.5;
export const PIER_Y = 1.0;
export const BRIDGE_Y = 1.6;

// r 是建筑中心到广场的距离；广场、海滩、码头、大桥的 r 就是站位点
export const LOCS = {
  广场: { a: 45, r: 6.5, cam: '喷泉摄像头', top: 5.5 },
  小酒馆: { a: 0, r: 31, cam: '啤酒龙头摄像头', top: 6.2 },
  报刊亭: { a: 50, r: 29.2, cam: '杂志架摄像头', top: 3.8 },
  家: { a: 100, r: 31.5, cam: '门铃摄像头', top: 7.4 },
  保险公司: { a: 160, r: 32.5, cam: '饮水机摄像头', top: 12.6 },
  大桥: { a: 225, r: 51, cam: '护栏摄像头', top: 4.6 },
  码头: { a: 275, r: 53, cam: '浮标摄像头', top: 3.6 },
  海滩: { a: 320, r: 40, cam: '救生椅摄像头', top: 4.4 },
};

// 群演和配角住的房子，节点 id 是 h0…h8
export const FILLERS = [
  { a: 22, wall: '#f6d6a8', roof: '#d98f5a', w: 5.4, h: 3.4 },
  { a: 75, wall: '#c9e4f5', roof: '#5f8fb8', w: 5.0, h: 3.2 },
  { a: 125, wall: '#f7c6d9', roof: '#c96a8a', w: 5.4, h: 5.6 },
  { a: 138, wall: '#d5e8c4', roof: '#7aa86a', w: 4.6, h: 3.2 },
  { a: 186, wall: '#e6d3f2', roof: '#9a7cc0', w: 5.4, h: 3.4 },
  { a: 201, wall: '#f6e3a1', roof: '#d0a040', w: 5.0, h: 5.4 },
  { a: 250, wall: '#c9e4f5', roof: '#d9787a', w: 5.4, h: 3.4 },
  { a: 298, wall: '#f5c3bc', roof: '#8a6bb0', w: 5.0, h: 3.2 },
  { a: 340, wall: '#d5e8c4', roof: '#d98f5a', w: 5.4, h: 5.4 },
];

export const CAST = {
  林楚: { color: '#f2a541', hair: '#3b3542', pants: '#3d4a66' },
  苏梅: { color: '#f08fb0', hair: '#5a3a2a', pants: '#6b4a6e' },
  老周: { color: '#5fc28f', hair: '#2b2b2b', pants: '#4a4a52' },
  林母: { color: '#b49be0', hair: '#d8d8d8', pants: '#5a5068' },
  孙伯: { color: '#d39a68', hair: '#ececec', pants: '#55627a' },
};

export const EXTRA_COLORS = ['#9fb7d9', '#e3c37a', '#c7a7d8', '#9fd1c5', '#e8a3a3', '#a8c98a', '#f0c9a0', '#8fb4c9', '#d6b3e0', '#b9d48f'];

export function trumanPlan(day) {
  const eve = day % 2 === 1 ? '小酒馆' : '海滩';
  return [
    { t: 0, at: '家', act: '睡觉', inside: true },
    { t: 6 * 60 + 40, at: '家', act: '起床洗漱', inside: true },
    { t: 7 * 60 + 20, at: '报刊亭', act: '买报纸，翻旅行杂志' },
    { t: 8 * 60 + 5, at: '保险公司', act: '上班', inside: true },
    { t: 12 * 60, at: '广场', act: '在喷泉边吃午饭' },
    { t: 12 * 60 + 55, at: '保险公司', act: '上班', inside: true },
    { t: 17 * 60 + 10, at: eve, act: eve === '小酒馆' ? '和老周喝一杯' : '在海边发呆' },
    { t: 18 * 60 + 40, at: '家', act: '和苏梅吃晚饭', inside: true },
    { t: 20 * 60 + 10, at: '码头', act: '看海（他怕水，却总忍不住来）' },
    { t: 21 * 60, at: '家', act: '准备睡觉', inside: true },
  ];
}

export const CAST_PLANS = {
  苏梅: [
    { t: 0, at: '家', act: '睡觉', inside: true },
    { t: 8 * 60 + 30, at: '广场', act: '晨练' },
    { t: 9 * 60 + 40, at: '家', act: '在家', inside: true },
    { t: 15 * 60 + 50, at: '报刊亭', act: '买东西' },
    { t: 17 * 60, at: '家', act: '做晚饭', inside: true },
  ],
  老周: [
    { t: 0, at: 'h6', act: '睡觉', inside: true },
    { t: 8 * 60 + 30, at: '码头', act: '钓鱼' },
    { t: 13 * 60, at: '广场', act: '闲逛' },
    { t: 14 * 60 + 30, at: '小酒馆', act: '喝酒' },
    { t: 22 * 60 + 30, at: 'h6', act: '睡觉', inside: true },
  ],
  孙伯: [
    { t: 0, at: 'h1', act: '睡觉', inside: true },
    { t: 6 * 60 + 20, at: '报刊亭', act: '看摊' },
    { t: 19 * 60, at: '小酒馆', act: '喝一杯' },
    { t: 21 * 60 + 30, at: 'h1', act: '睡觉', inside: true },
  ],
  林母: [
    { t: 0, at: 'h3', act: '睡觉', inside: true },
    { t: 9 * 60, at: '广场', act: '散步' },
    { t: 10 * 60 + 30, at: 'h3', act: '在家', inside: true },
    { t: 15 * 60, at: '报刊亭', act: '和孙伯聊天' },
    { t: 16 * 60 + 10, at: 'h3', act: '在家', inside: true },
  ],
};

export const GREET = {
  早上: ['早啊，林楚！', '早上好！', '今天天气真好！', '又是个大晴天！'],
  下午: ['下午好！', '吃了吗？', '林楚，忙着呢？', '天气真好啊！'],
  晚上: ['晚上好！', '早点回家哦！', '今晚月亮真圆。'],
};
export const REPLY = [
  ['早！', '你好呀！', '是啊，天气真好。', '嗯嗯！'],
  ['……你好。', '嗯，好。', '你昨天也这么说。'],
  ['你到底是谁？', '……我们见过吗？', '别笑了，没什么好笑的。'],
];
export const STARE = ['（天上那条缝……之前就有吗？）', '（为什么每个人都知道我的名字？）', '（这个人，我今天好像见过三次了。）', '（太阳刚刚是不是闪了一下？）'];
export const ARRIVE = {
  报刊亭: [['孙伯', '新到的旅行杂志！云屿群岛专题！'], ['孙伯', '今天的报纸，拿好！']],
  小酒馆: [['老周', '老规矩？'], ['老周', '来来来，坐！']],
  码头: [['林楚', '（海那边，是什么样子呢？）']],
  广场: [['林楚', '（又到午饭时间了。）']],
  海滩: [['林楚', '（风好像从来不会换方向。）']],
};

export const MINDS = [
  '又是晴天。晴港好像从来没下过一场像样的雨。日子平静得像一杯温水。',
  '今天的事有点太巧了。不过巧合每天都在发生，对吧？',
  '他们的笑容都太准时了，像排练过一样。',
  '我必须离开晴港。不管桥那头是什么，我都要亲眼看看。',
];

export const PREVIEW_HAND = [
  { cat: 'drama', stamp: '剧情', t: '小雨回到晴港', d: '初恋小雨突然出现在镇上，说只待三天。', cost: 60 },
  { cat: 'calm', stamp: '安抚', t: '老周的深夜啤酒', d: '老周拎着啤酒来找林楚谈心。', cost: 10 },
  { cat: 'block', stamp: '阻拦', t: '鲨鱼出没', d: '电台紧急播报：所有船只禁止出海。', cost: 20 },
  { cat: 'drama', stamp: '剧情', t: '父亲"归来"', d: '当年"遇难"的父亲被渔船救起。', cost: 90 },
];
