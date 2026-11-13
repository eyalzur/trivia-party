export type GameStatus = "lobby" | "playing" | "ended";
export type RoundStatus = "asking" | "question" | "done";

export const QUESTION_DURATION_MS = 10000;
export const DEFAULT_TOTAL_QUESTIONS = 6;

export interface GameDoc {
  code: string;
  name: string;
  hostUid: string;
  status: GameStatus;
  topics: string[];
  order: string[];
  turnIndex: number;
  usedQuestions: string[];
  totalQuestions: number;
  questionDurationMs: number;
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
  categoryKey: string | null;
  questionId: string | null;
  choices: string[] | null;
  correctIndex: number | null;
  status: RoundStatus;
  openedAt: unknown | null;
}

export interface AnswerDoc {
  name: string;
  choiceIndex: number;
  elapsedMs: number;
  at: unknown;
}

export interface Player extends PlayerDoc {
  uid: string;
}

export interface Answer extends AnswerDoc {
  uid: string;
}
