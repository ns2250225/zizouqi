"""素材下载脚本：读取 asset_sources.json，下载合法授权素材到本地缓存 .asset_cache/。

只下载许可证在白名单内的资源；下载结果与授权信息写入 .asset_cache/sources.lock.json。
用法：python3 scripts/asset_downloader.py
"""
import json
import pathlib
import subprocess
import time
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / ".asset_cache"
ALLOWED_LICENSES = {"CC0 1.0"}
UA = "OneLineBattle-AssetFetcher/1.0 (+local dev)"


def fetch(url: str, dest: pathlib.Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  cached {dest.name}")
        return
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
            f.write(r.read())
    except Exception:
        # 部分 Python 发行版缺少系统证书，回退到 curl
        dest.unlink(missing_ok=True)
        subprocess.run(["curl", "-fsSL", "-A", UA, "-o", str(dest), url], check=True, timeout=300)
    print(f"  downloaded {dest.name} ({dest.stat().st_size} bytes)")
    time.sleep(0.5)  # 礼貌访问间隔


def main() -> None:
    sources = json.loads((ROOT / "scripts" / "asset_sources.json").read_text("utf-8"))["sources"]
    CACHE.mkdir(exist_ok=True)
    lock = []
    for s in sources:
        if s["license"] not in ALLOWED_LICENSES:
            print(f"skip {s['id']}: license {s['license']} not allowed")
            continue
        print(f"[{s['id']}]")
        name = s["url"].rsplit("/", 1)[-1]
        dest = CACHE / "raw" / s["id"] / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            fetch(s["url"], dest)
        except Exception as e:  # 单个资源失败不影响其他资源，游戏有程序化兜底
            print(f"  FAILED {e}")
            continue
        if s["type"] == "zip":
            out = CACHE / "extracted" / s["id"]
            if not out.exists():
                with zipfile.ZipFile(dest) as z:
                    for m in z.namelist():
                        p = pathlib.PurePosixPath(m)
                        if p.is_absolute() or ".." in p.parts:
                            continue
                        z.extract(m, out)
        lock.append({**s, "file": str(dest.relative_to(ROOT))})
    (CACHE / "sources.lock.json").write_text(json.dumps(lock, ensure_ascii=False, indent=2), "utf-8")
    print(f"done: {len(lock)}/{len(sources)} sources")


if __name__ == "__main__":
    main()
