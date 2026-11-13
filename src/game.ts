import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Answer, AnswerDoc, GameDoc, Player, PlayerDoc, RoundDoc } from "./types";
import { DEFAULT_TOTAL_QUESTIONS, QUESTION_DURATION_MS } from "./types";
import { usedKey } from "./questions";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function gameRef(code: string) {
  return doc(db, "games", code);
}
function playersCol(code: string) {
  return collection(db, "games", code, "players");
}
function playerRef(code: string, uid: string) {
  return doc(db, "games", code, "players", uid);
}
function roundRef(code: string, turnIndex: number) {
  return doc(db, "games", code, "rounds", String(turnIndex));
}
function answersCol(code: string, turnIndex: number) {
  return collection(db, "games", code, "rounds", String(turnIndex), "answers");
}
function answerRef(code: string, turnIndex: number, uid: string) {
  return doc(db, "games", code, "rounds", String(turnIndex), "answers", uid);
}

export function calcPoints(elapsedMs: number, durationMs: number = QUESTION_DURATION_MS): number {
  const clamped = Math.max(0, Math.min(durationMs, elapsedMs));
  return 500 + Math.round(500 * (1 - clamped / durationMs));
}

export function buildOrder(playerUids: string[], totalQuestions: number): string[] {
  if (!playerUids.length) return [];
  const order: string[] = [];
  for (let i = 0; i < totalQuestions; i++) {
    order.push(playerUids[i % playerUids.length]);
  }
  return order;
}

export async function createGame(
  hostUid: string,
  playerName: string,
  avatar: string,
  gameName: string,
): Promise<string> {
  let code = randomCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const snap = await getDoc(gameRef(code));
    if (!snap.exists()) break;
    code = randomCode();
  }
  const game: GameDoc = {
    code,
    name: gameName,
    hostUid,
    status: "lobby",
    topics: [],
    order: [],
    turnIndex: 0,
    usedQuestions: [],
    totalQuestions: DEFAULT_TOTAL_QUESTIONS,
    questionDurationMs: QUESTION_DURATION_MS,
    createdAt: serverTimestamp(),
  };
  await setDoc(gameRef(code), game);
  await joinGame(code, hostUid, playerName, avatar);
  return code;
}

export async function joinGame(code: string, uid: string, name: string, avatar: string): Promise<void> {
  const player: PlayerDoc = { name, avatar, score: 0, joinedAt: serverTimestamp() };
  await setDoc(playerRef(code, uid), player, { merge: true });
}

export async function getGameOnce(code: string): Promise<GameDoc | null> {
  const snap = await getDoc(gameRef(code));
  return snap.exists() ? (snap.data() as GameDoc) : null;
}

export function subscribeGame(code: string, cb: (game: GameDoc | null) => void): Unsubscribe {
  return onSnapshot(gameRef(code), (snap) => cb(snap.exists() ? (snap.data() as GameDoc) : null));
}

export function subscribePlayers(code: string, cb: (players: Player[]) => void): Unsubscribe {
  return onSnapshot(query(playersCol(code), orderBy("joinedAt", "asc")), (snap) => {
    cb(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as PlayerDoc) })));
  });
}

export function subscribeRound(
  code: string,
  turnIndex: number,
  cb: (round: RoundDoc | null) => void,
): Unsubscribe {
  return onSnapshot(roundRef(code, turnIndex), (snap) => {
    cb(snap.exists() ? (snap.data() as RoundDoc) : null);
  });
}

export function subscribeAnswers(
  code: string,
  turnIndex: number,
  cb: (answers: Answer[]) => void,
): Unsubscribe {
  return onSnapshot(answersCol(code, turnIndex), (snap) => {
    cb(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as AnswerDoc) })));
  });
}

export async function setTopics(code: string, topics: string[]): Promise<void> {
  await updateDoc(gameRef(code), { topics });
}

export async function setGameSettings(
  code: string,
  totalQuestions: number,
  questionDurationMs: number,
): Promise<void> {
  await updateDoc(gameRef(code), { totalQuestions, questionDurationMs });
}

export async function startGame(code: string, order: string[]): Promise<void> {
  await setDoc(roundRef(code, 0), {
    askerUid: order[0],
    categoryKey: null,
    questionId: null,
    choices: null,
    correctIndex: null,
    status: "asking",
    openedAt: null,
  } satisfies RoundDoc);
  await updateDoc(gameRef(code), { status: "playing", order, turnIndex: 0 });
}

export async function startQuestion(
  code: string,
  turnIndex: number,
  categoryKey: string,
  questionId: string,
  choices: string[],
  correctIndex: number,
): Promise<void> {
  await updateDoc(roundRef(code, turnIndex), {
    categoryKey,
    questionId,
    choices,
    correctIndex,
    status: "question",
    openedAt: serverTimestamp(),
  });
  await updateDoc(gameRef(code), { usedQuestions: arrayUnion(usedKey(categoryKey, questionId)) });
}

export async function submitAnswer(
  code: string,
  turnIndex: number,
  uid: string,
  name: string,
  choiceIndex: number,
  elapsedMs: number,
  correct: boolean,
  durationMs: number,
): Promise<void> {
  const answer: AnswerDoc = { name, choiceIndex, elapsedMs, at: serverTimestamp() };
  await setDoc(answerRef(code, turnIndex, uid), answer);
  if (correct) {
    await updateDoc(playerRef(code, uid), { score: increment(calcPoints(elapsedMs, durationMs)) });
  }
}

export async function finishQuestion(code: string, turnIndex: number): Promise<void> {
  await updateDoc(roundRef(code, turnIndex), { status: "done" });
}

export async function advanceTurn(code: string, game: GameDoc): Promise<void> {
  const nextIndex = game.turnIndex + 1;
  if (nextIndex >= game.order.length) {
    await updateDoc(gameRef(code), { status: "ended" });
    return;
  }
  await setDoc(roundRef(code, nextIndex), {
    askerUid: game.order[nextIndex],
    categoryKey: null,
    questionId: null,
    choices: null,
    correctIndex: null,
    status: "asking",
    openedAt: null,
  } satisfies RoundDoc);
  await updateDoc(gameRef(code), { turnIndex: nextIndex });
}
