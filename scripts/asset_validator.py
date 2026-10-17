"""素材校验：检查 manifest 中所有文件存在、格式正确、授权记录齐全。

用法：python3 scripts/asset_validator.py   （失败时退出码为 1）
"""
import json
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets"
ALLOWED = {"CC0 1.0"}


def walk(node, acc):
    if isinstance(node, str) and node.split(".")[-1] in ("png", "json", "mp3", "ogg"):
        acc.append(node)
    elif isinstance(node, dict):
        for v in node.values():
            walk(v, acc)
    elif isinstance(node, list):
        for v in node:
            walk(v, acc)


def main() -> int:
    manifest = json.loads((OUT / "manifest.json").read_text("utf-8"))
    errors = []
    files = []
    walk({k: v for k, v in manifest.items() if k != "credits"}, files)
    for rel in files:
        p = OUT / rel
        if not p.exists() or p.stat().st_size == 0:
            errors.append(f"missing or empty: {rel}")
            continue
        if p.suffix == ".png":
            try:
                with Image.open(p) as im:
                    im.verify()
            except Exception as e:
                errors.append(f"bad image {rel}: {e}")
    for c in manifest["credits"]:
        if c["license"] not in ALLOWED:
            errors.append(f"license not allowed: {c['id']} {c['license']}")
    units = json.loads((ROOT / "src" / "data" / "units.json").read_text("utf-8"))["units"]
    for u in units:
        if u["id"] not in manifest["units"]:
            errors.append(f"unit sprite missing: {u['id']}")
    if not (ROOT / "licenses" / "ASSET_CREDITS.md").exists():
        errors.append("licenses/ASSET_CREDITS.md missing")
    print(f"checked {len(files)} files, {len(manifest['credits'])} credits")
    for e in errors:
        print("ERROR", e)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
