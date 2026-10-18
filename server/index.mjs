import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { MAX_NAME_LEN, RoomManager, newSid, sanitizeName } from './rooms.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.disable('x-powered-by');

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, rooms: manager.rooms.size, uptime: process.uptime() });
});

// 生产环境托管前端构建产物（SPA：/?pvp=CODE 邀请链接直接回落到 index.html）
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const manager = new RoomManager();

/** 每个连接的简单限流：5 秒窗口内最多 30 条消息 */
const RATE_LIMIT = { windowMs: 5_000, max: 30 };

function safeParse(raw) {
  if (raw.length > 128 * 1024) return null;
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  let bound = null; // { room, side }
  let rate = { count: 0, resetAt: Date.now() + RATE_LIMIT.windowMs };

  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    const now = Date.now();
    if (now > rate.resetAt) rate = { count: 0, resetAt: now + RATE_LIMIT.windowMs };
    if (++rate.count > RATE_LIMIT.max) return;

    const msg = safeParse(raw);
    if (!msg || typeof msg.t !== 'string') return;

    // 已绑定房间的游戏消息
    if (bound) {
      bound.room.handle(bound.side, msg);
      return;
    }

    if (msg.t === 'create') {
      const room = manager.create();
      if (!room) return ws.send(JSON.stringify({ t: 'error', msg: '服务器房间已满，请稍后再试' }));
      const sid = newSid();
      room.bindHost(ws, sanitizeName(msg.name).slice(0, MAX_NAME_LEN), sid);
      bound = { room, side: 'A' };
      ws.send(JSON.stringify({ t: 'created', code: room.code, sid, role: 'A', name: room.players.A.name }));
      return;
    }

    if (msg.t === 'join') {
      const room = manager.get(msg.code);
      if (!room) return ws.send(JSON.stringify({ t: 'error', msg: '房间不存在或已解散' }));
      const sid = typeof msg.sid === 'string' ? msg.sid.slice(0, 64) : newSid();
      const name = sanitizeName(msg.name);
      let side = null;
      let rejoin = false;
      if (room.players.A?.sid === sid) side = 'A';
      else if (room.players.B?.sid === sid) side = 'B';
      else if (!room.players.A) side = 'A';
      else if (!room.players.B) side = 'B';
      else return ws.send(JSON.stringify({ t: 'error', msg: '房间已满' }));

      if (room.players[side]?.sid === sid) rejoin = true;
      room.attach(side, ws, name, sid);
      bound = { room, side };
      ws.send(JSON.stringify({
        t: 'joined',
        code: room.code,
        sid,
        role: side,
        rejoin,
        name,
        snapshot: room.snapshotFor(side),
      }));
      if (!rejoin && side === 'B' && room.state === 'waiting' && room.bothConnected()) {
        room.begin();
      }
      return;
    }

    ws.send(JSON.stringify({ t: 'error', msg: '请先创建或加入房间' }));
  });

  const cleanup = () => {
    if (bound) {
      bound.room.disconnect(bound.side);
      bound = null;
    }
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

// 心跳：30 秒一次，两次未响应则断开（触发房间断线流程）
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
heartbeat.unref();

server.listen(PORT, () => {
  console.log(`[zizouqi] PvP 服务器已启动: http://localhost:${PORT} (WebSocket: /ws)`);
  if (!fs.existsSync(DIST_DIR)) console.log('[zizouqi] 未找到 dist/，仅提供 API 与 WebSocket（开发模式请配合 vite 代理）');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    manager.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  });
}
