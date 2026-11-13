export type GameStatus = "lobby" | "playing" | "ended";
export type RoundStatus = "asking" | "buzzing" | "done";
export type BuzzJudgement = "pending" | "correct" | "wrong";

export interface GameDoc {
  code: string;
  hostUid: string;
  status: GameStatus;
  topics: string[];
  order: string[];
  turnIndex: number;
  createdAt: unknown;
}

export interface PlayerDoc {
  name: string;
  avatar: string;
  score: number;
  joinedAt: unknown;
}

export interface RoundDoc {
  askerUid: string;
  topic: string | null;
  status: RoundStatus;
  openedAt: unknown | null;
}

export interface BuzzDoc {
  name: string;
  at: unknown;
  judgement: BuzzJudgement;
}

export interface Player extends PlayerDoc {
  uid: string;
}

export interface Buzz extends BuzzDoc {
  uid: string;
  atMs: number | null;
}
