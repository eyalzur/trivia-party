import {
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
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Buzz, BuzzDoc, GameDoc, Player, PlayerDoc, RoundDoc } from "./types";

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
function buzzesCol(code: string, turnIndex: number) {
  return collection(db, "games", code, "rounds", String(turnIndex), "buzzes");
}
function buzzRef(code: string, turnIndex: number, uid: string) {
  return doc(db, "games", code, "rounds", String(turnIndex), "buzzes", uid);
}

export async function createGame(hostUid: string, name: string, avatar: string): Promise<string> {
  let code = randomCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const snap = await getDoc(gameRef(code));
    if (!snap.exists()) break;
    code = randomCode();
  }
  const game: GameDoc = {
    code,
    hostUid,
    status: "lobby",
    topics: [],
    order: [],
    turnIndex: 0,
    createdAt: serverTimestamp(),
  };
  await setDoc(gameRef(code), game);
  await joinGame(code, hostUid, name, avatar);
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

export function subscribeBuzzes(
  code: string,
  turnIndex: number,
  cb: (buzzes: Buzz[]) => void,
): Unsubscribe {
  return onSnapshot(query(buzzesCol(code, turnIndex), orderBy("at", "asc")), (snap) => {
    cb(
      snap.docs.map((d) => {
        const data = d.data() as BuzzDoc;
        const at = data.at as Timestamp | null;
        return { uid: d.id, ...data, atMs: at ? at.toMillis() : null };
      }),
    );
  });
}

export async function setTopics(code: string, topics: string[]): Promise<void> {
  await updateDoc(gameRef(code), { topics });
}

export async function startGame(code: string, order: string[]): Promise<void> {
  await setDoc(roundRef(code, 0), {
    askerUid: order[0],
    topic: null,
    status: "asking",
    openedAt: null,
  } satisfies RoundDoc);
  await updateDoc(gameRef(code), { status: "playing", order, turnIndex: 0 });
}

export async function openBuzzing(code: string, turnIndex: number, topic: string | null): Promise<void> {
  await updateDoc(roundRef(code, turnIndex), {
    topic,
    status: "buzzing",
    openedAt: serverTimestamp(),
  });
}

export async function submitBuzz(
  code: string,
  turnIndex: number,
  uid: string,
  name: string,
): Promise<void> {
  const buzz: BuzzDoc = { name, at: serverTimestamp(), judgement: "pending" };
  await setDoc(buzzRef(code, turnIndex, uid), buzz);
}

async function advanceTurn(code: string, game: GameDoc): Promise<void> {
  const nextIndex = game.turnIndex + 1;
  if (nextIndex >= game.order.length) {
    await updateDoc(gameRef(code), { status: "ended" });
    return;
  }
  await setDoc(roundRef(code, nextIndex), {
    askerUid: game.order[nextIndex],
    topic: null,
    status: "asking",
    openedAt: null,
  } satisfies RoundDoc);
  await updateDoc(gameRef(code), { turnIndex: nextIndex });
}

export async function judgeBuzz(
  code: string,
  game: GameDoc,
  buzzUid: string,
  correct: boolean,
): Promise<void> {
  await updateDoc(buzzRef(code, game.turnIndex, buzzUid), {
    judgement: correct ? "correct" : "wrong",
  });
  if (correct) {
    await updateDoc(playerRef(code, buzzUid), { score: increment(1) });
    await updateDoc(roundRef(code, game.turnIndex), { status: "done" });
    await advanceTurn(code, game);
  }
}

export async function endRoundNoWinner(code: string, game: GameDoc): Promise<void> {
  await updateDoc(roundRef(code, game.turnIndex), { status: "done" });
  await advanceTurn(code, game);
}
