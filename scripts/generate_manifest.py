"""生成 public/assets/manifest.json 与 licenses/ASSET_CREDITS.md。

游戏运行时只读取 manifest.json 中的本地路径，不访问任何第三方素材服务器。
用法：python3 scripts/generate_manifest.py
"""
import datetime
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets"


def main() -> None:
    packed = json.loads((ROOT / ".asset_cache" / "packed.json").read_text("utf-8"))
    lock = json.loads((ROOT / ".asset_cache" / "sources.lock.json").read_text("utf-8"))
    effects_meta = json.loads((OUT / "atlases" / "effects.json").read_text("utf-8"))
    credits = [
        {"id": s["id"], "author": s["author"], "license": s["license"], "page": s["page"], "usage": s["usage"]}
        for s in lock
    ]
    manifest = {
        "version": 1,
        "generated": datetime.date.today().isoformat(),
        "atlases": {
            "units_dungeon": {"image": "atlases/units_dungeon.png", "tile": 16, "columns": 12},
            "units_onebit": {"image": "atlases/units_onebit.png", "tile": 16, "columns": 49},
            "effects": {"json": "atlases/effects.json", "image": "atlases/effects.png", "frames": sorted(effects_meta["frames"].keys())},
        },
        "units": packed["units"],
        "effects": packed["effects"],
        "backgrounds": {pathlib.Path(p).stem: p for p in packed["backgrounds"]},
        "ui": {pathlib.Path(p).stem: p for p in packed["ui"]},
        "audio": packed["audio"],
        "credits": credits,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), "utf-8")

    lines = [
        "# 素材来源与授权（ASSET CREDITS）",
        "",
        "本项目所有第三方素材均在开发阶段由 `scripts/asset_downloader.py` 下载，",
        "经 `scripts/sprite_packer.py` 处理后保存在 `public/assets/`，运行时不访问任何第三方服务器。",
        "所有采用的素材均为 **CC0 1.0（公共领域）** 授权，可商用、可修改、无需署名；以下署名出于尊重。",
        "",
        "| 素材 | 作者 | 许可证 | 来源 | 用途 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for c in credits:
        lines.append(f"| {c['id']} | {c['author']} | {c['license']} | {c['page']} | {c['usage']} |")
    lines += [
        "",
        "## 程序化生成的素材",
        "",
        "- 投射物（箭矢、弩箭、子弹、标枪、炮弹、火箭、法球）、冰晶、地面阴影：由 `sprite_packer.py` 使用 Pillow 绘制。",
        "- 战场背景：由 Kenney Tiny Town / Tiny Dungeon 瓦片拼接、着色生成。",
        "- 闪电、光束、冲击波、法阵等技能特效：运行时由 PixiJS 程序化绘制。",
        "- 卡牌框、界面：CSS 绘制。",
        "",
        "## 参考但未使用的素材",
        "",
        "PRD 中的视觉风格参考图片仅作参考，未下载、未使用。",
        "",
    ]
    (ROOT / "licenses").mkdir(exist_ok=True)
    (ROOT / "licenses" / "ASSET_CREDITS.md").write_text("\n".join(lines), "utf-8")
    print("manifest written:", len(manifest["units"]), "units,", len(credits), "credits")


if __name__ == "__main__":
    main()
