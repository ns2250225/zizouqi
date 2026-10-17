import type { Container } from 'pixi.js';

/** 虚拟相机：屏幕震动、冲击放大、慢动作、击杀特写与胜利拉远 */
export class CameraManager {
  private shakePower = 0;
  private zoom = 1;
  private zoomTarget = 1;
  private zoomHold = 0;
  private focus: { x: number; y: number } | null = null;
  private slowT = 0;
  private slowScale = 1;
  shakeEnabled = true;
  offsetX = 0;
  offsetY = 0;

  constructor(private world: Container, private getSize: () => { w: number; h: number }) {}

  shake(power: number) {
    if (!this.shakeEnabled) return;
    this.shakePower = Math.min(22, Math.max(this.shakePower, power));
  }

  punch(amount: number, hold = 0.08, focus?: { x: number; y: number }) {
    this.zoomTarget = Math.max(this.zoomTarget, 1 + amount);
    this.zoomHold = Math.max(this.zoomHold, hold);
    if (focus) this.focus = focus;
  }

  /** 持续的镜头设定（击杀特写/胜利拉远） */
  setZoom(z: number, focus: { x: number; y: number } | null, hold: number) {
    this.zoomTarget = z;
    this.zoomHold = hold;
    this.focus = focus;
  }

  slowmo(duration: number, scale: number) {
    this.slowT = Math.max(this.slowT, duration);
    this.slowScale = Math.min(this.slowT > 0 ? this.slowScale : 1, scale);
  }

  /** 当前时间缩放（慢动作） */
  get timeScale(): number {
    return this.slowT > 0 ? this.slowScale : 1;
  }

  reset() {
    this.shakePower = 0;
    this.zoom = this.zoomTarget = 1;
    this.zoomHold = 0;
    this.focus = null;
    this.slowT = 0;
    this.slowScale = 1;
    this.apply();
  }

  update(realDt: number) {
    if (this.slowT > 0) {
      this.slowT -= realDt;
      if (this.slowT <= 0) this.slowScale = 1;
    }
    if (this.zoomHold > 0) this.zoomHold -= realDt;
    else {
      this.zoomTarget += (1 - this.zoomTarget) * Math.min(1, realDt * 6);
      if (Math.abs(this.zoomTarget - 1) < 0.002) {
        this.zoomTarget = 1;
        this.focus = null;
      }
    }
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, realDt * 12);
    this.shakePower *= Math.max(0, 1 - realDt * 9);
    if (this.shakePower < 0.2) this.shakePower = 0;
    this.offsetX = (Math.random() * 2 - 1) * this.shakePower;
    this.offsetY = (Math.random() * 2 - 1) * this.shakePower;
    this.apply();
  }

  private apply() {
    const { w, h } = this.getSize();
    const fx = this.focus?.x ?? w / 2;
    const fy = this.focus?.y ?? h / 2;
    this.world.pivot.set(fx, fy);
    this.world.position.set(fx + (w / 2 - fx) * (this.zoom - 1) * 0.3 + this.offsetX, fy + this.offsetY);
    this.world.scale.set(this.zoom);
  }
}
