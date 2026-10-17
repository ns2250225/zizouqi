"""素材处理脚本：把 .asset_cache 中的原始素材裁剪、缩放、转换并打包到 public/assets。

- 单位 Sprite：复制 Tilesheet 作为 Pixi 图集，并按 units.json 导出每个兵种的放大图（图鉴/卡牌使用）
- 特效：挑选粒子、烟雾、爆炸帧，缩放后打包成 effects.png + effects.json（Pixi Spritesheet 格式）
- 投射物：基于像素绘制生成，打包进特效图集
- 背景：用 Tiny Town / Tiny Dungeon 瓦片拼出 5 个战场主题
- 音频：挑选音效，转码 mp3（兼容 Safari）并保留 ogg
用法：python3 scripts/sprite_packer.py
"""
import json
import math
import pathlib
import random
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
EX = ROOT / ".asset_cache" / "extracted"
RAW = ROOT / ".asset_cache" / "raw"
OUT = ROOT / "public" / "assets"

DUNGEON = EX / "tiny-dungeon" / "Tilemap" / "tilemap_packed.png"
ONEBIT = EX / "1-bit-pack" / "Tilesheet" / "colored-transparent_packed.png"
TOWN = EX / "tiny-town" / "Tilemap" / "tilemap_packed.png"
PARTICLES = EX / "particle-pack" / "PNG (Transparent)"
SMOKE = EX / "smoke-particles" / "PNG"


def ensure(p: pathlib.Path) -> pathlib.Path:
    p.mkdir(parents=True, exist_ok=True)
    return p


def tile(sheet: Image.Image, index: int, cols: int, size: int = 16) -> Image.Image:
    r, c = divmod(index, cols)
    return sheet.crop((c * size, r * size, c * size + size, r * size + size))


def tint(img: Image.Image, hex_color: str | None) -> Image.Image:
    if not hex_color:
        return img
    h = hex_color.lstrip("#")
    tr, tg, tb = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    px = img.load()
    out = img.copy()
    po = out.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            po[x, y] = (r * tr // 255, g * tg // 255, b * tb // 255, a)
    return out


# ---------------------------------------------------------------- units
def unit_category(u: dict) -> str:
    if u["rarity"] in ("LEGENDARY", "MYTHIC") or u["unitClass"] == "legend":
        return "legendary"
    if u["faction"] == "mech":
        return "mechanical"
    if u["unitClass"] == "mage":
        return "magic"
    if u.get("projectile") and u["role"] != "front":
        return "ranged"
    return "melee"


def pack_units() -> dict:
    atlases = ensure(OUT / "atlases")
    shutil.copy(DUNGEON, atlases / "units_dungeon.png")
    shutil.copy(ONEBIT, atlases / "units_onebit.png")
    sheets = {
        "dungeon": (Image.open(DUNGEON).convert("RGBA"), 12),
        "onebit": (Image.open(ONEBIT).convert("RGBA"), 49),
    }
    units = json.loads((ROOT / "src" / "data" / "units.json").read_text("utf-8"))["units"]
    result = {}
    for u in units:
        sp = u["sprite"]
        sheet, cols = sheets[sp["sheet"]]
        img = tint(tile(sheet, sp["index"], cols), sp.get("tint"))
        img = img.resize((64, 64), Image.NEAREST)
        cat = unit_category(u)
        dest = ensure(OUT / "units" / cat) / f"{u['id']}.png"
        img.save(dest, optimize=True)
        result[u["id"]] = f"units/{cat}/{u['id']}.png"
    return result


# ---------------------------------------------------------------- effects
EFFECT_GROUPS = {
    "fire": ["fire_01", "fire_02", "flame_01", "flame_02", "flame_03", "flame_04", "flame_05", "flame_06", "scorch_01", "scorch_02"],
    "lightning": ["spark_01", "spark_02", "spark_03", "spark_04", "spark_05", "spark_06", "spark_07", "trace_01", "trace_02", "trace_04"],
    "slash": ["slash_01", "slash_02", "slash_03", "slash_04", "scratch_01"],
    "particles": ["circle_01", "circle_02", "circle_03", "circle_05", "dirt_01", "dirt_02", "dirt_03", "flare_01", "light_01", "light_02",
                  "light_03", "magic_01", "magic_02", "magic_03", "magic_04", "magic_05", "muzzle_01", "muzzle_02", "smoke_01", "smoke_02",
                  "smoke_04", "smoke_07", "star_01", "star_04", "star_06", "star_07", "symbol_01", "symbol_02", "twirl_01", "twirl_02", "twirl_03"],
}


def ice_crystal(size: int = 96) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = size / 2
    for k in range(6):
        a = k * math.pi / 3
        x, y = c + math.cos(a) * c * 0.92, c + math.sin(a) * c * 0.92
        d.line((c, c, x, y), fill=(255, 255, 255, 255), width=max(2, size // 20))
        for t in (0.45, 0.7):
            bx, by = c + math.cos(a) * c * t, c + math.sin(a) * c * t
            for s in (-1, 1):
                aa = a + s * math.pi / 4
                d.line((bx, by, bx + math.cos(aa) * c * 0.22, by + math.sin(aa) * c * 0.22), fill=(255, 255, 255, 230), width=max(1, size // 32))
    return img.filter(ImageFilter.GaussianBlur(0.6))


def ice_shard(size: int = 64) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(size / 2, 0), (size * 0.72, size * 0.55), (size / 2, size), (size * 0.28, size * 0.55)], fill=(255, 255, 255, 235))
    d.line((size / 2, 4, size / 2, size - 4), fill=(255, 255, 255, 255), width=2)
    return img


def projectile_images() -> dict[str, Image.Image]:
    """像素风投射物（16px 网格，放大 2 倍），程序化绘制，颜色运行时着色。"""
    P: dict[str, Image.Image] = {}

    def canvas(w=16, h=16):
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        return im, ImageDraw.Draw(im)

    im, d = canvas(4, 16)  # arrow (pointing up)
    d.rectangle((1, 3, 2, 13), fill=(200, 160, 110, 255))
    d.polygon([(1.5, 0), (3, 3), (0, 3)], fill=(230, 230, 240, 255))
    d.rectangle((0, 13, 3, 15), fill=(240, 240, 240, 255))
    P["proj_arrow"] = im
    im, d = canvas(4, 10)
    d.rectangle((1, 2, 2, 9), fill=(160, 120, 80, 255))
    d.polygon([(1.5, 0), (3, 2), (0, 2)], fill=(220, 220, 230, 255))
    P["proj_bolt"] = im
    im, d = canvas(4, 6)
    d.rectangle((1, 0, 2, 5), fill=(255, 240, 180, 255))
    d.rectangle((0, 2, 3, 4), fill=(255, 200, 80, 200))
    P["proj_bullet"] = im
    im, d = canvas(4, 20)
    d.rectangle((1, 3, 2, 19), fill=(170, 130, 90, 255))
    d.polygon([(1.5, 0), (3, 4), (0, 4)], fill=(210, 210, 220, 255))
    P["proj_javelin"] = im
    im, d = canvas(8, 8)
    d.ellipse((0, 0, 7, 7), fill=(60, 60, 70, 255))
    d.ellipse((2, 1, 4, 3), fill=(150, 150, 160, 255))
    P["proj_shell"] = im
    im, d = canvas(6, 14)
    d.rectangle((1, 2, 4, 11), fill=(220, 220, 225, 255))
    d.polygon([(2.5, 0), (5, 3), (0, 3)], fill=(230, 70, 60, 255))
    d.rectangle((0, 10, 5, 12), fill=(230, 70, 60, 255))
    d.rectangle((2, 12, 3, 13), fill=(255, 200, 60, 255))
    P["proj_rocket"] = im
    im, d = canvas(10, 10)
    d.ellipse((0, 0, 9, 9), fill=(255, 255, 255, 120))
    d.ellipse((2, 2, 7, 7), fill=(255, 255, 255, 255))
    P["proj_orb"] = im
    im, d = canvas(16, 16)  # 地面阴影
    d.ellipse((0, 5, 15, 11), fill=(0, 0, 0, 110))
    P["shadow"] = im
    return {k: v.resize((v.width * 2, v.height * 2), Image.NEAREST) for k, v in P.items()}


def pixel_explosion_frames() -> list[Image.Image]:
    sheet = Image.open(RAW / "explosion-animations" / "explosion3.png").convert("RGBA")
    bg = sheet.getpixel((3, 3))
    frames = []
    for row in range(2):
        for col in range(5):
            x0, y0 = col * 92 + 1, row * 92 + 1
            f = sheet.crop((x0, y0, x0 + 89, y0 + 89))
            px = f.load()
            for y in range(f.height):
                for x in range(f.width):
                    p = px[x, y]
                    if abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2]) < 24:
                        px[x, y] = (0, 0, 0, 0)
            frames.append(f.resize((96, 96), Image.NEAREST))
    return frames


def shelf_pack(images: dict[str, Image.Image], width: int = 2048, pad: int = 2):
    items = sorted(images.items(), key=lambda kv: -kv[1].height)
    x = y = shelf_h = 0
    pos = {}
    for name, im in items:
        if x + im.width + pad > width:
            x, y, shelf_h = 0, y + shelf_h + pad, 0
        pos[name] = (x, y)
        x += im.width + pad
        shelf_h = max(shelf_h, im.height)
    height = 1 << math.ceil(math.log2(max(1, y + shelf_h)))
    atlas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    frames = {}
    for name, im in items:
        px, py = pos[name]
        atlas.paste(im, (px, py))
        frames[name] = {
            "frame": {"x": px, "y": py, "w": im.width, "h": im.height},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": im.width, "h": im.height},
            "sourceSize": {"w": im.width, "h": im.height},
        }
    return atlas, frames


def pack_effects() -> dict:
    images: dict[str, Image.Image] = {}
    exported: dict[str, list[str]] = {}
    for group, names in EFFECT_GROUPS.items():
        folder = ensure(OUT / "effects" / group)
        for n in names:
            src = PARTICLES / f"{n}.png"
            if not src.exists():
                continue
            im = Image.open(src).convert("RGBA").resize((128, 128), Image.LANCZOS)
            images[n] = im
            im.save(folder / f"{n}.png", optimize=True)
            exported.setdefault(group, []).append(f"effects/{group}/{n}.png")
    ice_folder = ensure(OUT / "effects" / "ice")
    for name, im in (("ice_crystal", ice_crystal()), ("ice_shard", ice_shard())):
        images[name] = im
        im.save(ice_folder / f"{name}.png")
        exported.setdefault("ice", []).append(f"effects/ice/{name}.png")
    exp_folder = ensure(OUT / "effects" / "explosions")
    for i in range(9):
        for kind in ("explosion", "flash"):
            src = SMOKE / kind.capitalize() / f"{kind}{i:02d}.png"
            if src.exists():
                im = Image.open(src).convert("RGBA")
                im.thumbnail((144, 144), Image.LANCZOS)
                images[f"smoke_{kind}_{i:02d}"] = im
                im.save(exp_folder / f"smoke_{kind}_{i:02d}.png", optimize=True)
    for i in range(3):
        src = SMOKE / "Black smoke" / f"blackSmoke{i * 6:02d}.png"
        if src.exists():
            im = Image.open(src).convert("RGBA")
            im.thumbnail((112, 112), Image.LANCZOS)
            images[f"black_smoke_{i}"] = im
    for i, f in enumerate(pixel_explosion_frames()):
        images[f"pixel_explosion_{i:02d}"] = f
        f.save(exp_folder / f"pixel_explosion_{i:02d}.png")
    exported["explosions"] = sorted(f"effects/explosions/{p.name}" for p in exp_folder.glob("*.png"))
    proj_folder = ensure(OUT / "projectiles")
    for name, im in projectile_images().items():
        images[name] = im
        im.save(proj_folder / f"{name}.png")
    atlas, frames = shelf_pack(images)
    atlas.save(OUT / "atlases" / "effects.png", optimize=True)
    meta = {"app": "one-line-battle sprite_packer", "image": "effects.png", "format": "RGBA8888",
            "size": {"w": atlas.width, "h": atlas.height}, "scale": "1"}
    (OUT / "atlases" / "effects.json").write_text(json.dumps({"frames": frames, "meta": meta}), "utf-8")
    return exported


# ---------------------------------------------------------------- backgrounds
def make_backgrounds() -> list[str]:
    town = Image.open(TOWN).convert("RGBA")
    dun = Image.open(DUNGEON).convert("RGBA")
    W, H = 12, 26
    out = []
    themes = {
        "grassland": dict(sheet=town, base=[0, 0, 0, 1, 2], deco=[4, 5, 16, 28, 29, 17], tint=None),
        "desert": dict(sheet=dun, base=[48, 49, 50, 51, 48, 48], deco=[24, 12, 64], tint=None),
        "dungeon": dict(sheet=dun, base=[0, 0, 0, 0, 12, 24], deco=[64, 65], tint="#9aa0c8"),
        "snow": dict(sheet=town, base=[0, 0, 1, 2], deco=[4, 28, 16], tint="#e8f4ff"),
        "volcano": dict(sheet=dun, base=[48, 49, 50, 51], deco=[24, 12], tint="#ff7a58"),
    }
    folder = ensure(OUT / "backgrounds")
    for name, t in themes.items():
        rnd = random.Random(name)
        cols = t["sheet"].width // 16
        img = Image.new("RGBA", (W * 16, H * 16), (0, 0, 0, 255))
        for y in range(H):
            for x in range(W):
                img.alpha_composite(tile(t["sheet"], rnd.choice(t["base"]), cols), (x * 16, y * 16))
        # 中央战线（土路）
        if name in ("grassland", "snow"):
            for y in range(H):
                for x in (5, 6):
                    img.alpha_composite(tile(town, 25 if rnd.random() > 0.2 else 40, 12), (x * 16, y * 16))
        for _ in range(26):
            if not t["deco"]:
                break
            x = rnd.choice([0, 1, 2, 9, 10, 11])
            y = rnd.randrange(H)
            img.alpha_composite(tile(t["sheet"], rnd.choice(t["deco"]), cols), (x * 16, y * 16))
        img = tint(img, t["tint"])
        if name == "snow":
            img = Image.blend(img, Image.new("RGBA", img.size, (235, 245, 255, 255)), 0.35)
        if name == "dungeon":
            d = ImageDraw.Draw(img)
            for _ in range(30):
                x, y = rnd.randrange(img.width), rnd.randrange(img.height)
                d.rectangle((x, y, x + 1, y + 1), fill=(40, 40, 60, 255))
        if name == "volcano":
            d = ImageDraw.Draw(img)
            for _ in range(18):
                x, y = rnd.randrange(img.width), rnd.randrange(img.height)
                d.line((x, y, x + rnd.randint(-10, 10), y + rnd.randint(6, 20)), fill=(255, 140, 40, 255), width=1)
        img.convert("RGB").save(folder / f"{name}.png", optimize=True)
        out.append(f"backgrounds/{name}.png")
    return out


# ---------------------------------------------------------------- ui
def make_ui() -> list[str]:
    one = Image.open(ONEBIT).convert("RGBA")
    folder = ensure(OUT / "ui")
    icons = {"heart": (529, None), "heart_empty": (532, "#55556a"), "skull": (577, None), "crown": (141, None),
             "sword": (375, "#e0e0f0"), "shield": (186, None), "potion": (669, None), "card_back_emblem": (1069, "#ffd76a")}
    out = []
    for name, (idx, col) in icons.items():
        im = tint(tile(one, idx, 49), col).resize((48, 48), Image.NEAREST)
        im.save(folder / f"{name}.png")
        out.append(f"ui/{name}.png")
    # 卡背：地牢砖块 + 暗色
    dun = Image.open(DUNGEON).convert("RGBA")
    back = Image.new("RGBA", (64, 96), (0, 0, 0, 255))
    for y in range(6):
        for x in range(4):
            back.alpha_composite(tile(dun, 40, 12), (x * 16, y * 16))
    back = Image.blend(back, Image.new("RGBA", back.size, (30, 20, 70, 255)), 0.55)
    back.alpha_composite(tint(tile(one, 1069, 49), "#ffd76a").resize((32, 32), Image.NEAREST), (16, 32))
    back.resize((128, 192), Image.NEAREST).save(ensure(OUT / "cards") / "card_back.png")
    out.append("cards/card_back.png")
    return out


# ---------------------------------------------------------------- audio
SFX = {
    "draw_flip": "rpg-audio/Audio/bookFlip2.ogg",
    "card_hover": "interface-sounds/Audio/select_002.ogg",
    "card_pick": "interface-sounds/Audio/confirmation_001.ogg",
    "card_shatter": "interface-sounds/Audio/glass_002.ogg",
    "reroll": "interface-sounds/Audio/switch_003.ogg",
    "click": "interface-sounds/Audio/click_002.ogg",
    "tick": "interface-sounds/Audio/tick_002.ogg",
    "battle_start": "music-jingles/Audio/Steel jingles/jingles_STEEL07.ogg",
    "melee_hit": "impact-sounds/Audio/impactPunch_medium_000.ogg",
    "melee_hit2": "impact-sounds/Audio/impactMetal_light_001.ogg",
    "melee_heavy": "impact-sounds/Audio/impactPlate_heavy_000.ogg",
    "bow_shot": "rpg-audio/Audio/knifeSlice2.ogg",
    "gun_shot": "sci-fi-sounds/Audio/laserRetro_002.ogg",
    "cannon_shot": "sci-fi-sounds/Audio/impactMetal_002.ogg",
    "explosion": "sci-fi-sounds/Audio/explosionCrunch_000.ogg",
    "explosion_big": "sci-fi-sounds/Audio/lowFrequency_explosion_000.ogg",
    "lightning": "digital-audio/Audio/zap1.ogg",
    "magic_cast": "digital-audio/Audio/phaserUp3.ogg",
    "fire_cast": "sci-fi-sounds/Audio/thrusterFire_001.ogg",
    "frost_cast": "impact-sounds/Audio/impactGlass_heavy_000.ogg",
    "heal": "digital-audio/Audio/powerUp2.ogg",
    "summon": "digital-audio/Audio/phaseJump2.ogg",
    "laser": "sci-fi-sounds/Audio/laserLarge_001.ogg",
    "stomp": "sci-fi-sounds/Audio/lowFrequency_explosion_001.ogg",
    "death": "impact-sounds/Audio/impactSoft_heavy_001.ogg",
    "revive": "digital-audio/Audio/powerUp7.ogg",
    "legend_appear": "music-jingles/Audio/Steel jingles/jingles_STEEL02.ogg",
    "mythic_appear": "music-jingles/Audio/Hit jingles/jingles_HIT16.ogg",
    "combo": "digital-audio/Audio/threeTone2.ogg",
    "victory": "music-jingles/Audio/Steel jingles/jingles_STEEL03.ogg",
    "defeat": "music-jingles/Audio/Steel jingles/jingles_STEEL06.ogg",
    "hp_loss": "impact-sounds/Audio/impactBell_heavy_000.ogg",
    "rage": "digital-audio/Audio/lowThreeTone.ogg",
}
BGM = {
    "menu": RAW / "town-theme" / "TownTheme.mp3",
    "battle": RAW / "battle-theme-a" / "battleThemeA.mp3",
    "rage": RAW / "battle-theme-b" / "battleThemeB.mp3",
}


def process_audio() -> dict:
    sfx_dir = ensure(OUT / "audio" / "sfx")
    bgm_dir = ensure(OUT / "audio" / "bgm")
    has_ffmpeg = shutil.which("ffmpeg") is not None
    sfx = {}
    for key, rel in SFX.items():
        src = EX / rel
        if not src.exists():
            print("  missing sfx", rel)
            continue
        ogg = sfx_dir / f"{key}.ogg"
        shutil.copy(src, ogg)
        files = [f"audio/sfx/{key}.ogg"]
        if has_ffmpeg:
            mp3 = sfx_dir / f"{key}.mp3"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-b:a", "96k", str(mp3)], check=True)
            files.insert(0, f"audio/sfx/{key}.mp3")
        sfx[key] = files
    bgm = {}
    for key, src in BGM.items():
        if not src.exists():
            continue
        dest = bgm_dir / f"{key}.mp3"
        if has_ffmpeg:
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-b:a", "112k", str(dest)], check=True)
        else:
            shutil.copy(src, dest)
        bgm[key] = [f"audio/bgm/{key}.mp3"]
    return {"sfx": sfx, "bgm": bgm}


def main() -> None:
    ensure(OUT)
    print("units...")
    units = pack_units()
    print("effects...")
    effects = pack_effects()
    print("backgrounds...")
    backgrounds = make_backgrounds()
    print("ui...")
    ui = make_ui()
    print("audio...")
    audio = process_audio()
    index = {"units": units, "effects": effects, "backgrounds": backgrounds, "ui": ui, "audio": audio}
    (ROOT / ".asset_cache" / "packed.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), "utf-8")
    print("packed:", len(units), "unit sprites,", sum(len(v) for v in effects.values()), "effect files,",
          len(audio["sfx"]), "sfx,", len(audio["bgm"]), "bgm")


if __name__ == "__main__":
    main()
