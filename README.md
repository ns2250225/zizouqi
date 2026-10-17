# 一线决战（One Line Battle）

单条竖直战线 + 三选一卡牌构筑 + 自动战斗 + 回合扣血 + Roguelike 成长的网页策略游戏，适配 PC 与移动端浏览器。

## 快速开始

```bash
npm install
npm run dev        # 本地开发
npm run build      # 类型检查 + 生产构建，输出到 dist/
npm run preview    # 预览构建结果
```

`dist/` 为纯静态文件，可直接部署到 Nginx 或任意静态托管（`base` 为相对路径，可放在任意子目录）。

## 素材管线

所有第三方素材在开发阶段获取并保存到 `public/assets/`，运行时不访问任何第三方素材服务器。

```bash
npm run assets
```

依次执行：

| 脚本 | 作用 |
| --- | --- |
| `scripts/asset_downloader.py` | 读取 `scripts/asset_sources.json`，只下载白名单许可证（CC0）的素材到 `.asset_cache/` |
| `scripts/sprite_packer.py` | 裁剪、缩放、着色、打包：单位图集与图鉴图、特效图集（Pixi Spritesheet）、投射物、战场背景、音效转码（ogg + mp3） |
| `scripts/generate_manifest.py` | 生成 `public/assets/manifest.json` 与 `licenses/ASSET_CREDITS.md` |
| `scripts/asset_validator.py` | 校验文件完整性、图片格式与授权记录 |

素材来源：Kenney（Tiny Dungeon、1-Bit Pack、Particle Pack、Smoke Particles、Tiny Town、多套音效包）与 OpenGameArt（cynicmusic 的 BGM、爆炸序列帧），全部为 CC0，详见 `licenses/ASSET_CREDITS.md`。素材缺失时渲染层会使用程序化图形兜底，不会白屏。

## 功能对照（PRD）

- **部队继承**：每回合选择的兵种卡永久加入军队，下一回合继续参战（`balance.json` 中 `armyCarryOver` 可关闭）；敌方战力预算按回合累积增长（`budgetCarryOver`），超出单位上限时编队合并显示。
- **标准模式难度**：敌军属性额外 ×1.3，并每回合再递增 4%（`balance.json` 中 `standardStatMult` / `standardGrowthPerRound`）。
- **核心循环**：双方 8 格生命；每回合 3 次抽卡、每次 3 选 1；选完 3 秒倒计时后自动战斗；败方扣 1 格（Boss 回合胜利扣敌方 2 格），平局各扣 1 格。
- **单战线战斗**：一维逻辑坐标（0–1000），敌上我下；固定步长（30Hz）模拟，与渲染解耦并插值；可复现随机种子；单位状态机（生成/待机/移动/寻敌/攻击/施法/眩晕/击退/死亡）；7 种目标策略；地面阻挡、飞行单位越过阻挡；按 Y 排序的空间索引与二分查找，避免两两遍历。
- **超时规则**：60 秒后进入狂暴阶段（伤害递增、音乐切换、红色警示），90 秒按剩余生命比例判定。
- **内容**：60 种兵种 + 5 种召唤物、58 个配置驱动技能、100 张卡牌（60 兵种卡 + 40 战术卡）、5 级稀有度、8 个阵营羁绊、6 个职业羁绊、9 个卡牌组合进化、同类连选奖励、前置条件卡、抽卡权重修改卡、幸运三连事件。
- **敌方 AI**：按回合区间（1–3 / 4–6 / 7–10 / 11–15 / 16–20 / 21–25 / 26+）选择战术倾向与稀有度上限，按战力预算生成阵容，自动组成羁绊、附加强化；“混合军团”会针对玩家上一回合阵容；每 10 回合为 Boss 回合。
- **表现**：8 层渲染；14 类技能特效（斩击、暴击、冲锋残影、箭雨、爆炸、火焰、冰霜、闪电、陨石、龙息、践踏、凤凰重生、激光、大招慢动作）；镜头震动、冲击放大、慢动作、击杀特写、胜利拉远；粒子与投射物对象池；按设备自动分级并在低帧率时降级。
- **抽卡交互**：卡牌飞出翻转、稀有度特效（白色粒子 / 蓝色光晕 / 紫色闪电 / 金色爆发 + 震屏 / 红色空间裂缝）、选中放大发光、其余卡牌碎裂；长按或 ⓘ 查看详情，不依赖悬停。
- **音频**：抽卡、选卡、开战、近战、弓箭、炮击、爆炸、雷电、魔法、传奇卡、胜负、扣血、背景音乐（抽卡/战斗/狂暴动态切换），同一音效并发数限制。
- **系统**：主菜单、继续游戏（IndexedDB 安全存档点，刷新后恢复）、兵种图鉴、卡牌图鉴（含羁绊与组合说明）、战绩统计、本地排行榜、设置（音量、震动、闪光、伤害数字、画质、默认倍速、自动下一回合）、制作人员与素材授权。
- **扩展模式**：无尽模式（敌军强度每回合精确为上回合的 1.5 倍，`balance.json` 中 `endlessGrowth` 可调）、每日挑战（按日期种子 + 每日规则）、四档自定义难度、5 种随回合切换的战场主题、战斗录像回放、对局码分享（相同种子开局）。
- **移动端**：竖屏优先窄长战场；横屏（宽 ≥ 820）切换为居中战线 + 左侧敌情/阵容 + 右侧卡牌面板；所有按钮满足触控尺寸；支持全屏。

未实现：PRD 中标为“可选”的 PvP 异步对战（需要后端）。

## 目录结构

```
src/
  components/   Card、CardSelection、HealthBar、BattleHUD、RoundResult 等
  views/        MainMenu、GameView、CardCollection、Settings、StatsView、Credits
  game/
    core/       类型、随机数、GameManager（回合/阶段/胜负）
    battle/     BattleSim（固定步长战斗模拟）、空间索引
    cards/      抽卡（CardDraw）、卡牌效果与军队构建（CardEffect）
    units/      属性修正
    skills/     技能系统
    synergies/  羁绊与组合
    enemy/      敌方阵容生成与难度
    effects/    特效库
    renderer/   PixiJS 渲染、粒子、动画、相机、纹理
    audio/      Howler 音频管理
    data/       配置加载、存档、素材清单
  data/         units / cards / skills / synergies / balance（JSON 配置）
  stores/       Pinia：game、settings、stats
scripts/        素材下载、处理、清单、校验
licenses/       ASSET_CREDITS.md
tests/          Vitest 逻辑测试
```

数值全部位于 `src/data/*.json`，新增兵种只需添加配置与技能条目，无需修改战斗引擎。
