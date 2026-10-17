# 素材来源与授权（ASSET CREDITS）

本项目所有第三方素材均在开发阶段由 `scripts/asset_downloader.py` 下载，
经 `scripts/sprite_packer.py` 处理后保存在 `public/assets/`，运行时不访问任何第三方服务器。
所有采用的素材均为 **CC0 1.0（公共领域）** 授权，可商用、可修改、无需署名；以下署名出于尊重。

| 素材 | 作者 | 许可证 | 来源 | 用途 |
| --- | --- | --- | --- | --- |
| tiny-dungeon | Kenney | CC0 1.0 | https://kenney.nl/assets/tiny-dungeon | 单位角色 Sprite |
| 1-bit-pack | Kenney | CC0 1.0 | https://kenney.nl/assets/1-bit-pack | 传奇单位、图标 |
| particle-pack | Kenney | CC0 1.0 | https://kenney.nl/assets/particle-pack | 粒子与技能特效 |
| smoke-particles | Kenney | CC0 1.0 | https://kenney.nl/assets/smoke-particles | 烟雾与爆炸 |
| tiny-town | Kenney | CC0 1.0 | https://kenney.nl/assets/tiny-town | 战场地面瓦片 |
| impact-sounds | Kenney | CC0 1.0 | https://kenney.nl/assets/impact-sounds | 打击音效 |
| interface-sounds | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds | 界面音效 |
| rpg-audio | Kenney | CC0 1.0 | https://kenney.nl/assets/rpg-audio | 翻牌、武器音效 |
| sci-fi-sounds | Kenney | CC0 1.0 | https://kenney.nl/assets/sci-fi-sounds | 爆炸、激光、雷电音效 |
| digital-audio | Kenney | CC0 1.0 | https://kenney.nl/assets/digital-audio | 魔法音效 |
| music-jingles | Kenney | CC0 1.0 | https://kenney.nl/assets/music-jingles | 胜利/失败短乐 |
| battle-theme-a | cynicmusic | CC0 1.0 | https://opengameart.org/content/battle-theme-a | 战斗 BGM |
| battle-theme-b | cynicmusic | CC0 1.0 | https://opengameart.org/content/battle-theme-b-for-rpg | 狂暴阶段 BGM |
| town-theme | cynicmusic | CC0 1.0 | https://opengameart.org/content/town-theme-rpg | 主菜单/抽卡 BGM |
| explosion-animations | OpenGameArt contributor | CC0 1.0 | https://opengameart.org/content/explosion-animations | 爆炸 Sprite Sheet |

## 程序化生成的素材

- 投射物（箭矢、弩箭、子弹、标枪、炮弹、火箭、法球）、冰晶、地面阴影：由 `sprite_packer.py` 使用 Pillow 绘制。
- 战场背景：由 Kenney Tiny Town / Tiny Dungeon 瓦片拼接、着色生成。
- 闪电、光束、冲击波、法阵等技能特效：运行时由 PixiJS 程序化绘制。
- 卡牌框、界面：CSS 绘制。

## 参考但未使用的素材

PRD 中的视觉风格参考图片仅作参考，未下载、未使用。
