/** 本地素材清单加载。所有路径都指向 public/assets，运行时不访问第三方服务器。 */
export interface AssetManifest {
  version: number;
  atlases: {
    units_dungeon: { image: string; tile: number; columns: number };
    units_onebit: { image: string; tile: number; columns: number };
    effects: { json: string; image: string; frames: string[] };
  };
  units: Record<string, string>;
  effects: Record<string, string[]>;
  backgrounds: Record<string, string>;
  ui: Record<string, string>;
  audio: { sfx: Record<string, string[]>; bgm: Record<string, string[]> };
  credits: { id: string; author: string; license: string; page: string; usage: string }[];
}

export const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

let manifest: AssetManifest | null = null;

export function assetUrl(rel: string): string {
  return ASSET_BASE + rel;
}

export async function loadManifest(): Promise<AssetManifest | null> {
  if (manifest) return manifest;
  try {
    const res = await fetch(assetUrl('manifest.json'));
    if (!res.ok) throw new Error(String(res.status));
    manifest = (await res.json()) as AssetManifest;
  } catch (e) {
    // 素材缺失不能导致白屏：返回 null，渲染层使用程序化图形兜底
    console.warn('[assets] manifest 加载失败，使用程序化兜底', e);
    manifest = null;
  }
  return manifest;
}

export function getManifest(): AssetManifest | null {
  return manifest;
}

export function unitImage(unitId: string): string {
  const rel = manifest?.units[unitId];
  return rel ? assetUrl(rel) : '';
}
