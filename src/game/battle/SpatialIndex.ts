import type { BattleUnit } from './BattleTypes';

/**
 * 一维空间索引：每个阵营维护按 Y 排序的存活单位数组。
 * 每个逻辑帧用插入排序维护（单位几乎有序，近似 O(n)），
 * 范围查询使用二分查找，避免每帧两两遍历。
 */
export class SpatialIndex {
  sorted: BattleUnit[] = [];

  rebuild(units: BattleUnit[]) {
    const arr = this.sorted;
    arr.length = 0;
    for (const u of units) if (u.alive) arr.push(u);
    for (let i = 1; i < arr.length; i++) {
      const cur = arr[i];
      let j = i - 1;
      while (j >= 0 && arr[j].y > cur.y) {
        arr[j + 1] = arr[j];
        j--;
      }
      arr[j + 1] = cur;
    }
  }

  /** 第一个 y >= v 的下标 */
  lowerBound(v: number): number {
    let lo = 0;
    let hi = this.sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sorted[mid].y < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  forRange(y0: number, y1: number, cb: (u: BattleUnit) => void) {
    const arr = this.sorted;
    for (let i = this.lowerBound(y0); i < arr.length && arr[i].y <= y1; i++) {
      if (arr[i].alive) cb(arr[i]);
    }
  }

  inRange(y0: number, y1: number, filter?: (u: BattleUnit) => boolean): BattleUnit[] {
    const out: BattleUnit[] = [];
    this.forRange(y0, y1, (u) => {
      if (!filter || filter(u)) out.push(u);
    });
    return out;
  }

  countRange(y0: number, y1: number): number {
    return Math.max(0, this.lowerBound(y1 + 0.0001) - this.lowerBound(y0));
  }

  /** 最近的可被攻击单位 */
  nearest(y: number, ok: (u: BattleUnit) => boolean): BattleUnit | null {
    const arr = this.sorted;
    if (!arr.length) return null;
    let r = this.lowerBound(y);
    let l = r - 1;
    while (l >= 0 || r < arr.length) {
      const dl = l >= 0 ? y - arr[l].y : Infinity;
      const dr = r < arr.length ? arr[r].y - y : Infinity;
      if (dl <= dr) {
        if (ok(arr[l])) return arr[l];
        l--;
      } else {
        if (ok(arr[r])) return arr[r];
        r++;
      }
    }
    return null;
  }

  first(ok: (u: BattleUnit) => boolean): BattleUnit | null {
    for (const u of this.sorted) if (ok(u)) return u;
    return null;
  }

  last(ok: (u: BattleUnit) => boolean): BattleUnit | null {
    for (let i = this.sorted.length - 1; i >= 0; i--) if (ok(this.sorted[i])) return this.sorted[i];
    return null;
  }
}
