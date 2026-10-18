import type { ClientMsg, ServerMsg } from './protocol';

/** PvP WebSocket 客户端：同源 /ws 端点（开发模式下由 vite 代理到本地服务器） */
export class PvpClient {
  private ws: WebSocket | null = null;
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: () => void = () => {};

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    this.close();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        settled = true;
        resolve();
      };
      ws.onmessage = (e) => {
        try {
          this.onMessage(JSON.parse(e.data));
        } catch {
          /* 忽略非法消息 */
        }
      };
      ws.onclose = () => {
        this.ws = null;
        if (!settled) reject(new Error('无法连接 PvP 服务器'));
        else this.onClose();
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('无法连接 PvP 服务器'));
        }
      };
    });
  }

  send(msg: ClientMsg) {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }
}
