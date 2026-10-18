import type { ArmySpec } from '../src/game/core/types';

/** server/rooms.mjs 的类型声明（供测试与工具使用） */

export const START_HP: number;
export const DRAFT_MS: number;
export const BATTLE_MS: number;
export const ROUND_SHOW_MS: number;
export const DISCONNECT_GRACE_MS: number;
export const LOBBY_TTL_MS: number;
export const CLOSED_TTL_MS: number;
export const MAX_ROOMS: number;
export const MAX_NAME_LEN: number;

export function newCode(): string;
export function newSeed(): number;
export function newSid(): string;
export function emptyArmy(): ArmySpec;
export function sanitizeName(raw: unknown): string;

export type RoomState = 'waiting' | 'draft' | 'battle' | 'roundEnd' | 'gameOver';
export type PvpWinner = 0 | 1 | 'draw';

export interface RoomPlayer {
  sid: string;
  name: string;
  ws: unknown;
  connected: boolean;
}

export interface RoomSnapshot {
  state: RoomState;
  round: number;
  hp: [number, number];
  names: { A: string; B: string };
  draftSeedA: number;
  draftSeedB: number;
  picks: { draws: { card: string; rerolls: number }[] };
  oppPickCount: number;
  armies: { A: ArmySpec | null; B: ArmySpec | null };
  battleSeed: number;
  lastRoundEnd: { round: number; winner: PvpWinner; hp: [number, number] } | null;
  gameOverInfo: { winner: PvpWinner; hp: [number, number]; reason: string } | null;
}

export interface FakeWebSocket {
  send(data: string): void;
}

export class Room {
  code: string;
  state: RoomState;
  round: number;
  hp: [number, number];
  players: { A: RoomPlayer | null; B: RoomPlayer | null };
  draftSeedA: number;
  draftSeedB: number;
  battleSeed: number;
  picks: { A: { cards: string[]; rerolls: number }; B: { cards: string[]; rerolls: number } };
  armies: { A: ArmySpec | null; B: ArmySpec | null };
  results: { A: PvpWinner | null; B: PvpWinner | null };
  lastRoundEnd: { round: number; winner: PvpWinner; hp: [number, number] } | null;
  gameOverInfo: { winner: PvpWinner; hp: [number, number]; reason: string } | null;
  rematch: { A: boolean; B: boolean };
  closed: boolean;

  constructor(code: string);
  attach(side: 'A' | 'B', ws: FakeWebSocket, name: string, sid: string): { rejoin: boolean };
  bindHost(ws: FakeWebSocket, name: string, sid: string): void;
  begin(): void;
  startRound(): void;
  startBattle(): void;
  endBattle(): void;
  disconnect(side: 'A' | 'B'): void;
  handle(side: 'A' | 'B', msg: Record<string, unknown>): void;
  send(side: 'A' | 'B', msg: Record<string, unknown>): void;
  broadcast(msg: Record<string, unknown>): void;
  snapshotFor(side: 'A' | 'B'): RoomSnapshot;
  destroy(): void;
}

export class RoomManager {
  rooms: Map<string, Room>;
  constructor();
  normalizeCode(code: unknown): string;
  create(): Room | null;
  get(code: unknown): Room | null;
  remove(code: string): void;
  sweep(): void;
  stop(): void;
}
