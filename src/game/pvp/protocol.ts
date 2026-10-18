import type { ArmySpec, Team } from '../core/types';

/** PvP 服务器协议（与 server/rooms.mjs 中的消息一一对应） */

export type PvpRole = 'A' | 'B';
export type PvpWinner = Team | 'draw';

export interface PvpSnapshot {
  state: 'waiting' | 'draft' | 'battle' | 'roundEnd' | 'gameOver';
  round: number;
  hp: [number, number];
  names: { A: string; B: string };
  draftSeedA: number;
  draftSeedB: number;
  /** 每次抽卡的选卡记录（含选卡前的重抽次数，用于重连后按位置精确回放） */
  picks: { draws: { card: string; rerolls: number }[] };
  oppPickCount: number;
  armies: { A: ArmySpec | null; B: ArmySpec | null };
  battleSeed: number;
  lastRoundEnd: { round: number; winner: PvpWinner; hp: [number, number] } | null;
  gameOverInfo: { winner: PvpWinner; hp: [number, number]; reason: string } | null;
}

export type ClientMsg =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string; sid?: string }
  | { t: 'pick'; round: number; draw: number; card: string }
  | { t: 'reroll'; round: number }
  | { t: 'army'; round: number; army: ArmySpec }
  | { t: 'result'; round: number; winner: PvpWinner }
  | { t: 'rematch' }
  | { t: 'leave' };

export type ServerMsg =
  | { t: 'created'; code: string; sid: string; role: 'A'; name: string }
  | { t: 'joined'; code: string; sid: string; role: PvpRole; rejoin: boolean; name: string; snapshot: PvpSnapshot }
  | { t: 'start'; names: { A: string; B: string } }
  | { t: 'round'; round: number; draftSeedA: number; draftSeedB: number; hp: [number, number]; fresh: boolean }
  | { t: 'peerPick'; round: number; draw: number }
  | { t: 'peerReroll'; round: number }
  | { t: 'battle'; round: number; battleSeed: number; armyA: ArmySpec; armyB: ArmySpec }
  | { t: 'peerResult'; round: number }
  | { t: 'roundEnd'; round: number; winner: PvpWinner; hp: [number, number] }
  | { t: 'gameOver'; winner: PvpWinner; hp: [number, number]; reason: string }
  | { t: 'rematchStart' }
  | { t: 'rematchOffer' }
  | { t: 'peerLeft'; grace: number }
  | { t: 'peerRejoined' }
  | { t: 'error'; msg: string };
