import "./style.css";
import { waitForUid } from "./firebase";
import {
  createGame,
  endRoundNoWinner,
  getGameOnce,
  joinGame,
  judgeBuzz,
  openBuzzing,
  setTopics,
  startGame,
  subscribeBuzzes,
  subscribeGame,
  subscribePlayers,
  subscribeRound,
  submitBuzz,
} from "./game";
import type { Buzz, GameDoc, Player, RoundDoc } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;

const LS_NAME = "trivia.name";
const LS_CODE = "trivia.code";

let myUid = "";
let myName = localStorage.getItem(LS_NAME) ?? "";

let code: string | null = localStorage.getItem(LS_CODE);
let game: GameDoc | null = null;
let players: Player[] = [];
let round: RoundDoc | null = null;
let buzzes: Buzz[] = [];
let localTopicChoice: string | null = null;
let joinError = "";

let unsubGame: (() => void) | null = null;
let unsubPlayers: (() => void) | null = null;
let unsubRound: (() => void) | null = null;
let unsubBuzzes: (() => void) | null = null;

function teardown(): void {
  unsubGame?.();
  unsubPlayers?.();
  unsubRound?.();
  unsubBuzzes?.();
  unsubGame = unsubPlayers = unsubRound = unsubBuzzes = null;
  round = null;
  buzzes = [];
}

function teardownRound(): void {
  unsubRound?.();
  unsubBuzzes?.();
  unsubRound = null;
  unsubBuzzes = null;
  buzzes = [];
}

function watchGame(c: string): void {
  teardown();
  let lastTurnIndex = -1;
  unsubGame = subscribeGame(c, (g) => {
    game = g;
    if (!g) {
      leaveGame();
      return;
    }
    if (g.status === "playing" && g.turnIndex !== lastTurnIndex) {
      lastTurnIndex = g.turnIndex;
      localTopicChoice = null;
      teardownRound();
      unsubRound = subscribeRound(c, g.turnIndex, (r) => {
        round = r;
        render();
      });
      unsubBuzzes = subscribeBuzzes(c, g.turnIndex, (b) => {
        buzzes = b;
        render();
      });
    }
    render();
  });
  unsubPlayers = subscribePlayers(c, (p) => {
    players = p;
    render();
  });
}

function leaveGame(): void {
  teardown();
  code = null;
  game = null;
  players = [];
  localStorage.removeItem(LS_CODE);
  render();
}

function setCode(c: string): void {
  code = c;
  localStorage.setItem(LS_CODE, c);
  watchGame(c);
}

function nameOf(uid: string): string {
  return players.find((p) => p.uid === uid)?.name ?? "?";
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function render(): void {
  if (!code || !game) {
    renderHome();
  } else if (game.status === "lobby") {
    renderLobby();
  } else if (game.status === "playing") {
    renderPlaying();
  } else {
    renderEnded();
  }
}

function renderHome(): void {
  const urlCode = new URLSearchParams(location.search).get("code") ?? "";
  app.innerHTML = `
    <div class="screen home">
      <h1>🎉 מסיבת טריוויה</h1>
      <label>השם שלך</label>
      <input id="name" maxlength="20" value="${escapeHtml(myName)}" placeholder="לדוגמה: דנה" />

      <div class="card">
        <h2>התחילו משחק חדש</h2>
        <button id="create">צור משחק</button>
      </div>

      <div class="card">
        <h2>הצטרפו למשחק</h2>
        <input id="joinCode" maxlength="5" value="${escapeHtml(urlCode)}" placeholder="קוד" class="code-input" />
        <button id="join">הצטרף</button>
        ${joinError ? `<p class="error">${escapeHtml(joinError)}</p>` : ""}
      </div>
    </div>
  `;

  const nameInput = app.querySelector<HTMLInputElement>("#name")!;
  nameInput.addEventListener("input", () => {
    myName = nameInput.value;
    localStorage.setItem(LS_NAME, myName);
  });

  app.querySelector("#create")!.addEventListener("click", async () => {
    if (!myName.trim()) return alert("קודם תכניסו שם");
    const c = await createGame(myUid, myName.trim());
    history.replaceState(null, "", location.pathname);
    setCode(c);
  });

  app.querySelector("#join")!.addEventListener("click", async () => {
    if (!myName.trim()) return alert("קודם תכניסו שם");
    const input = app.querySelector<HTMLInputElement>("#joinCode")!;
    const c = input.value.trim().toUpperCase();
    if (!c) return;
    const existing = await getGameOnce(c);
    if (!existing) {
      joinError = "לא נמצא משחק עם הקוד הזה";
      render();
      return;
    }
    joinError = "";
    await joinGame(c, myUid, myName.trim());
    history.replaceState(null, "", location.pathname);
    setCode(c);
  });
}

function renderLobby(): void {
  const g = game!;
  const isHost = g.hostUid === myUid;
  app.innerHTML = `
    <div class="screen lobby">
      <h1>לובי</h1>
      <div class="join-code">${g.code}</div>
      <p class="hint">שתפו את הקוד הזה — כולם מצטרפים עם אותו קוד.</p>

      <h2>שחקנים (${players.length})</h2>
      <ul class="players">
        ${players.map((p) => `<li>${escapeHtml(p.name)}${p.uid === g.hostUid ? " 👑" : ""}</li>`).join("")}
      </ul>

      <h2>נושאים</h2>
      <ul class="topics">
        ${g.topics
          .map(
            (t, i) =>
              `<li>${escapeHtml(t)}${isHost ? `<button data-idx="${i}" class="remove-topic">✕</button>` : ""}</li>`,
          )
          .join("") || "<li class='muted'>עדיין אין נושאים</li>"}
      </ul>
      ${
        isHost
          ? `<div class="add-topic">
              <input id="newTopic" placeholder="לדוגמה: סרטים" maxlength="30" />
              <button id="addTopic">הוסף</button>
            </div>
            <button id="startGame" ${players.length < 2 ? "disabled" : ""}>התחל משחק</button>
            ${players.length < 2 ? "<p class='hint'>צריך לפחות 2 שחקנים</p>" : ""}`
          : "<p class='hint'>ממתינים שהמארח יתחיל…</p>"
      }
      <button id="leave" class="secondary">עזוב</button>
    </div>
  `;

  if (isHost) {
    app.querySelector("#addTopic")!.addEventListener("click", async () => {
      const input = app.querySelector<HTMLInputElement>("#newTopic")!;
      const t = input.value.trim();
      if (!t) return;
      await setTopics(g.code, [...g.topics, t]);
    });
    app.querySelectorAll<HTMLButtonElement>(".remove-topic").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.dataset.idx);
        await setTopics(g.code, g.topics.filter((_, i) => i !== idx));
      });
    });
    app.querySelector("#startGame")!.addEventListener("click", async () => {
      const order = players.map((p) => p.uid);
      await startGame(g.code, order);
    });
  }

  app.querySelector("#leave")!.addEventListener("click", leaveGame);
}

function renderPlaying(): void {
  const g = game!;
  const r = round;
  const myScore = players.find((p) => p.uid === myUid)?.score ?? 0;
  const amAsker = r?.askerUid === myUid;
  const iAlreadyBuzzed = buzzes.some((b) => b.uid === myUid);
  const topBuzz = buzzes.find((b) => b.judgement === "pending");

  const scoreboard = `
    <ul class="scoreboard">
      ${players
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((p) => `<li${p.uid === myUid ? ' class="me"' : ""}>${escapeHtml(p.name)} — ${p.score}</li>`)
        .join("")}
    </ul>
  `;

  let main = "";
  if (!r) {
    main = "<p>טוען סיבוב…</p>";
  } else if (r.status === "asking") {
    if (amAsker) {
      const topicOptions = g.topics.length
        ? g.topics.map((t) => `<button class="pick-topic" data-topic="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("")
        : "";
      main = `
        <h1>התור שלך לשאול!</h1>
        <p class="hint">בחרו נושא (לא חובה), ואז שאלו את השאלה בקול.</p>
        <div class="topic-picker">${topicOptions}</div>
        ${localTopicChoice ? `<p>נושא: <b>${escapeHtml(localTopicChoice)}</b></p>` : ""}
        <button id="openBuzzing" class="primary big">שאלתי — פתחו את הבאזרים!</button>
      `;
    } else {
      main = `
        <h1>${escapeHtml(nameOf(r.askerUid))} שואל/ת…</h1>
        <p class="hint">התכוננו ללחוץ!</p>
      `;
    }
  } else if (r.status === "buzzing") {
    if (amAsker) {
      main = `
        <h1>מי לחץ ראשון?</h1>
        ${r.topic ? `<p class="hint">נושא: ${escapeHtml(r.topic)}</p>` : ""}
        ${renderBuzzList(buzzes, topBuzz)}
        <button id="noWinner" class="secondary">אף אחד לא ידע — לתור הבא</button>
      `;
    } else {
      main = `
        <h1>${escapeHtml(nameOf(r.askerUid))} שאל/ה שאלה</h1>
        ${r.topic ? `<p class="hint">נושא: ${escapeHtml(r.topic)}</p>` : ""}
        <button id="buzz" class="buzz-btn" ${iAlreadyBuzzed ? "disabled" : ""}>
          ${iAlreadyBuzzed ? "לחצת!" : "לחץ!"}
        </button>
        ${renderBuzzList(buzzes, topBuzz)}
      `;
    }
  }

  app.innerHTML = `
    <div class="screen playing">
      <div class="topbar">
        <span>קוד ${g.code}</span>
        <span>אתה: ${myScore}</span>
      </div>
      <div class="main">${main}</div>
      <h2>טבלת ניקוד</h2>
      ${scoreboard}
    </div>
  `;

  app.querySelectorAll<HTMLButtonElement>(".pick-topic").forEach((btn) => {
    btn.addEventListener("click", () => {
      localTopicChoice = btn.dataset.topic ?? null;
      render();
    });
  });

  app.querySelector("#openBuzzing")?.addEventListener("click", async () => {
    await openBuzzing(g.code, g.turnIndex, localTopicChoice);
  });

  app.querySelector("#buzz")?.addEventListener("click", async () => {
    await submitBuzz(g.code, g.turnIndex, myUid, myName);
  });

  app.querySelector("#noWinner")?.addEventListener("click", async () => {
    await endRoundNoWinner(g.code, g);
  });

  app.querySelectorAll<HTMLButtonElement>(".judge-correct").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await judgeBuzz(g.code, g, btn.dataset.uid!, true);
    });
  });
  app.querySelectorAll<HTMLButtonElement>(".judge-wrong").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await judgeBuzz(g.code, g, btn.dataset.uid!, false);
    });
  });
}

function renderBuzzList(list: Buzz[], top: Buzz | undefined): string {
  if (!list.length) return "<p class='hint'>ממתינים ללחיצות…</p>";
  return `
    <ol class="buzz-list">
      ${list
        .map((b) => {
          const isTop = b.uid === top?.uid;
          const judgeButtons =
            isTop && b.judgement === "pending"
              ? `<button class="judge-correct" data-uid="${b.uid}">✔ נכון</button>
                 <button class="judge-wrong" data-uid="${b.uid}">✘ לא נכון</button>`
              : "";
          const tag = b.judgement === "correct" ? " ✔" : b.judgement === "wrong" ? " ✘" : "";
          return `<li class="${isTop ? "top" : ""}">${escapeHtml(b.name)}${tag}${judgeButtons}</li>`;
        })
        .join("")}
    </ol>
  `;
}

function renderEnded(): void {
  const sorted = players.slice().sort((a, b) => b.score - a.score);
  app.innerHTML = `
    <div class="screen ended">
      <h1>🏆 המשחק נגמר!</h1>
      <ol class="final-scoreboard">
        ${sorted.map((p) => `<li>${escapeHtml(p.name)} — ${p.score}</li>`).join("")}
      </ol>
      <button id="again">משחק חדש</button>
    </div>
  `;
  app.querySelector("#again")!.addEventListener("click", leaveGame);
}

async function boot(): Promise<void> {
  try {
    myUid = await waitForUid();
  } catch (err) {
    app.innerHTML = `<div class="screen"><p class="error">לא הצלחנו להתחבר ל-Firebase. בדקת את קובץ ה-.env? (${escapeHtml(String(err))})</p></div>`;
    return;
  }
  if (code) watchGame(code);
  render();
}

void boot();
