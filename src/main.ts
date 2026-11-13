import "./style.css";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { waitForUid } from "./firebase";
import {
  advanceTurn,
  buildOrder,
  calcPoints,
  createGame,
  finishQuestion,
  getGameOnce,
  joinGame,
  setGameSettings,
  setTopics,
  startGame,
  startQuestion,
  subscribeAnswers,
  subscribeGame,
  subscribePlayers,
  subscribeRound,
  submitAnswer,
} from "./game";
import type { Answer, GameDoc, Player, RoundDoc } from "./types";
import { DEFAULT_TOTAL_QUESTIONS, QUESTION_DURATION_MS } from "./types";

const SPEED_PRESETS = [
  { ms: 15000, label: "🐢 רגוע", sub: "15 שנ׳" },
  { ms: 10000, label: "⚡ רגיל", sub: "10 שנ׳" },
  { ms: 5000, label: "🔥 מהיר", sub: "5 שנ׳" },
];
import { CATEGORIES, getCategory, getQuestion, pickRandomQuestion, shuffledChoices } from "./questions";
import { CHANGELOG } from "./changelog";

const app = document.querySelector<HTMLDivElement>("#app")!;

const LS_NAME = "trivia.name";
const LS_CODE = "trivia.code";
const LS_AVATAR = "trivia.avatar";

const AVATARS = [
  "🦄", "🐸", "🐧", "🦊", "🐵", "🐶", "🐱", "🦁",
  "🐯", "🐨", "🐼", "🐷", "🐙", "🦖", "👽", "🤖",
  "🥷", "🧙", "🧛", "🧟",
];

let myUid = "";
let myName = localStorage.getItem(LS_NAME) ?? "";
let myAvatar = localStorage.getItem(LS_AVATAR) ?? AVATARS[0];
let hadSavedPlayer = !!myName.trim();

let code: string | null = localStorage.getItem(LS_CODE);
let game: GameDoc | null = null;
let players: Player[] = [];
let round: RoundDoc | null = null;
let answers: Answer[] = [];
let localQuestion:
  | { categoryKey: string; questionId: string; text: string; choices: string[]; correctIndex: number }
  | null = null;
let myPendingChoice: number | null = null;
let questionStartMs: number | null = null;
let questionTimerId: number | null = null;
let questionEndTriggered = false;
let currentQuestionDurationMs = QUESTION_DURATION_MS;
let joinError = "";
let celebratedThisRound = false;

type HomeStep = "profile" | "gameName" | "join";
let homeStep: HomeStep = "profile";
let homeInitialized = false;
let joinAutoOpenCamera = false;
let editingProfile = false;

let unsubGame: (() => void) | null = null;
let unsubPlayers: (() => void) | null = null;
let unsubRound: (() => void) | null = null;
let unsubAnswers: (() => void) | null = null;

function teardown(): void {
  unsubGame?.();
  unsubPlayers?.();
  unsubRound?.();
  unsubAnswers?.();
  unsubGame = unsubPlayers = unsubRound = unsubAnswers = null;
  round = null;
  answers = [];
  stopQuestionTimer();
}

function teardownRound(): void {
  unsubRound?.();
  unsubAnswers?.();
  unsubRound = null;
  unsubAnswers = null;
  answers = [];
  myPendingChoice = null;
  questionStartMs = null;
  questionEndTriggered = false;
  currentQuestionDurationMs = QUESTION_DURATION_MS;
  celebratedThisRound = false;
  stopQuestionTimer();
}

function stopQuestionTimer(): void {
  if (questionTimerId !== null) {
    clearInterval(questionTimerId);
    questionTimerId = null;
  }
}

function startQuestionTimer(c: string, turnIndex: number, durationMs: number): void {
  stopQuestionTimer();
  currentQuestionDurationMs = durationMs;
  questionTimerId = window.setInterval(() => {
    const elapsed = questionStartMs !== null ? Date.now() - questionStartMs : 0;
    if (elapsed >= durationMs && !questionEndTriggered) {
      questionEndTriggered = true;
      stopQuestionTimer();
      void finishQuestion(c, turnIndex);
    }
    render();
  }, 250);
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
      localQuestion = null;
      teardownRound();
      let prevStatus: RoundDoc["status"] | null = null;
      unsubRound = subscribeRound(c, g.turnIndex, (r) => {
        if (r && r.status === "question" && prevStatus !== "question") {
          questionStartMs = Date.now();
          questionEndTriggered = false;
          startQuestionTimer(c, g.turnIndex, g.questionDurationMs ?? QUESTION_DURATION_MS);
        }
        if (r && r.status !== "question") {
          stopQuestionTimer();
        }
        if (r && r.status === "done" && prevStatus !== "done" && !celebratedThisRound) {
          const anyCorrect = answers.some((ans) => ans.choiceIndex === r.correctIndex);
          if (anyCorrect) {
            celebratedThisRound = true;
            fireConfetti();
          }
        }
        prevStatus = r?.status ?? null;
        round = r;
        render();
      });
      unsubAnswers = subscribeAnswers(c, g.turnIndex, (a) => {
        answers = a;
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
  history.replaceState(null, "", location.pathname);
  homeInitialized = false;
  homeStep = "profile";
  editingProfile = false;
  joinError = "";
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

function avatarOf(uid: string): string {
  return players.find((p) => p.uid === uid)?.avatar ?? "❔";
}

function tagOf(uid: string): string {
  return `${avatarOf(uid)} ${escapeHtml(nameOf(uid))}`;
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function fireConfetti(): void {
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  const colors = ["#ff5c8a", "#ff8a5c", "#4cd6b4", "#45b3e0", "#ffd24c"];
  for (let i = 0; i < 70; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 0.3}s`;
    piece.style.animationDuration = `${1.1 + Math.random() * 0.9}s`;
    piece.style.setProperty("--rot", `${Math.random() * 360}deg`);
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 2300);
}

type TextAnim = "drop" | "write" | "explode";

let lastHeadingAnimKey = "";

function animateHeading(el: HTMLElement, variant: TextAnim): void {
  const text = el.textContent ?? "";
  el.textContent = "";
  el.classList.add("anim-host");
  const frag = document.createDocumentFragment();
  [...text].forEach((ch, i) => {
    const span = document.createElement("span");
    span.textContent = ch === " " ? " " : ch;
    span.className = `anim-char v-${variant}`;
    span.style.animationDelay = `${i * 0.04}s`;
    if (variant === "explode") {
      const dx = (Math.random() - 0.5) * 160;
      const dy = (Math.random() - 0.5) * 160 - 30;
      const rot = (Math.random() - 0.5) * 180;
      span.style.setProperty("--dx", `${dx}px`);
      span.style.setProperty("--dy", `${dy}px`);
      span.style.setProperty("--rot", `${rot}deg`);
    }
    frag.appendChild(span);
  });
  el.appendChild(frag);
}

function maybeAnimateHeading(key: string, selector: string, variant: TextAnim): void {
  if (key === lastHeadingAnimKey) return;
  lastHeadingAnimKey = key;
  const el = app.querySelector<HTMLElement>(selector);
  if (el) animateHeading(el, variant);
}

function spawnTapBurst(x: number, y: number): void {
  const colors = ["#ff5c8a", "#ff8a5c", "#2fd6c4", "#45b3e0", "#ffd24c"];
  for (let i = 0; i < 8; i++) {
    const particle = document.createElement("span");
    particle.className = "tap-burst-particle";
    const angle = (i / 8) * 360 + Math.random() * 20;
    const dist = 26 + Math.random() * 18;
    particle.style.left = `${x}px`;
    particle.style.top = `${y}px`;
    particle.style.background = colors[i % colors.length];
    particle.style.setProperty("--dx", `${Math.cos((angle * Math.PI) / 180) * dist}px`);
    particle.style.setProperty("--dy", `${Math.sin((angle * Math.PI) / 180) * dist}px`);
    document.body.appendChild(particle);
    setTimeout(() => particle.remove(), 450);
  }
}

document.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest("button");
  if (!target || target.hasAttribute("disabled")) return;
  spawnTapBurst(e.clientX, e.clientY);
});

function captureRects(selector: string): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  app.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const uid = el.dataset.uid;
    if (uid) map.set(uid, el.getBoundingClientRect());
  });
  return map;
}

function playFlip(selector: string, oldRects: Map<string, DOMRect>): void {
  app.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const uid = el.dataset.uid;
    const old = uid ? oldRects.get(uid) : undefined;
    if (!old) return;
    const now = el.getBoundingClientRect();
    const dy = old.top - now.top;
    if (Math.abs(dy) < 1) return;
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = "transform 0.4s cubic-bezier(.2,.8,.2,1)";
      el.style.transform = "";
    });
  });
}

function medal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `${rank}.`;
}

function renderScoreboardRows(list: Player[], highlightUid: string): string {
  const sorted = list.slice().sort((a, b) => b.score - a.score);
  return `
    <ul class="scoreboard">
      ${sorted
        .map((p, i) => {
          const rank = i + 1;
          return `
            <li class="score-row${p.uid === highlightUid ? " me" : ""} rank-${rank <= 3 ? rank : "other"}" data-uid="${p.uid}">
              <span class="rank">${medal(rank)}</span>
              <span class="avatar-circle">${p.avatar}</span>
              <span class="score-info">
                <span class="score-name">${escapeHtml(p.name)}</span>
                <span class="score-pts">${p.score}</span>
              </span>
            </li>`;
        })
        .join("")}
    </ul>
  `;
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

async function attemptJoin(c: string): Promise<boolean> {
  const existing = await getGameOnce(c);
  if (!existing) {
    joinError = "לא נמצא משחק עם הקוד הזה";
    return false;
  }
  joinError = "";
  await joinGame(c, myUid, myName.trim(), myAvatar);
  history.replaceState(null, "", location.pathname);
  setCode(c);
  return true;
}

async function autoJoinFlow(c: string): Promise<void> {
  app.innerHTML = `<div class="screen"><p class="hint">מצטרפים למשחק ${escapeHtml(c)}…</p></div>`;
  const ok = await attemptJoin(c);
  if (!ok) render();
}

function extractCode(text: string): string | null {
  try {
    const url = new URL(text);
    const fromUrl = url.searchParams.get("code");
    if (fromUrl) return fromUrl.toUpperCase();
  } catch {
    /* not a URL, fall through */
  }
  const trimmed = text.trim().toUpperCase();
  return /^[A-Z0-9]{4,6}$/.test(trimmed) ? trimmed : null;
}

function openQrScanner(onResult: (text: string) => void): void {
  const overlay = document.createElement("div");
  overlay.className = "scanner-overlay";
  overlay.innerHTML = `
    <p>כוונו את המצלמה לקוד ה-QR</p>
    <video playsinline muted></video>
    <button id="cancelScan" class="secondary">ביטול</button>
  `;
  document.body.appendChild(overlay);

  const video = overlay.querySelector("video")!;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  let stream: MediaStream | null = null;
  let rafId = 0;
  let stopped = false;

  function stop(): void {
    stopped = true;
    cancelAnimationFrame(rafId);
    stream?.getTracks().forEach((t) => t.stop());
    overlay.remove();
  }

  overlay.querySelector("#cancelScan")!.addEventListener("click", stop);

  function tick(): void {
    if (stopped) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(imageData.data, imageData.width, imageData.height);
      if (result?.data) {
        stop();
        onResult(result.data);
        return;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: "environment" } })
    .then((s) => {
      if (stopped) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      video.srcObject = s;
      void video.play();
      rafId = requestAnimationFrame(tick);
    })
    .catch(() => {
      stop();
      alert("לא ניתן לגשת למצלמה");
    });
}

function renderHome(): void {
  const urlCode = new URLSearchParams(location.search).get("code")?.toUpperCase() ?? "";

  if (!homeInitialized) {
    homeInitialized = true;
    if (myName.trim() && urlCode) {
      homeStep = "join";
      void autoJoinFlow(urlCode);
      return;
    }
    homeStep = "profile";
  }

  if (homeStep === "profile") return renderStepProfile();
  if (homeStep === "gameName") return renderStepGameName();
  return renderStepJoin(urlCode);
}

function renderStepProfile(): void {
  if (editingProfile) return renderProfileEditor();

  const canProceed = !!myName.trim();
  app.innerHTML = `
    <div class="screen home">
      <div class="wizard">
        <h1>🎉 מסיבת טריוויה</h1>
        ${
          canProceed
            ? `<div class="avatar-big">${myAvatar}</div><p class="hint">${escapeHtml(myName)}</p>`
            : ""
        }
        <div class="choice-grid">
          <button id="editProfile" class="choice-card profile">
            <span class="icon">🧑</span><span>${hadSavedPlayer ? "עדכן שחקן" : "צור שחקן"}</span>
          </button>
          <button id="startGame" class="choice-card create" ${canProceed ? "" : "disabled"}>
            <span class="icon">🎉</span><span>התחל משחק</span>
          </button>
          <button id="toJoin" class="choice-card join" ${canProceed ? "" : "disabled"}>
            <span class="icon">📷</span><span>הצטרף למשחק</span>
          </button>
        </div>
        <button id="openChangelog" class="secondary">📜 מה חדש?</button>
      </div>
    </div>
  `;
  maybeAnimateHeading("home", "h1", "explode");

  app.querySelector("#editProfile")!.addEventListener("click", () => {
    editingProfile = true;
    render();
  });
  app.querySelector("#startGame")!.addEventListener("click", () => {
    if (!myName.trim()) return;
    homeStep = "gameName";
    render();
  });
  app.querySelector("#toJoin")!.addEventListener("click", () => {
    if (!myName.trim()) return;
    joinAutoOpenCamera = true;
    homeStep = "join";
    render();
  });
  app.querySelector("#openChangelog")!.addEventListener("click", openChangelog);
}

function openChangelog(): void {
  const overlay = document.createElement("div");
  overlay.className = "changelog-overlay";
  overlay.innerHTML = `
    <div class="changelog-sheet">
      <div class="changelog-header">
        <h1>📜 מה חדש</h1>
        <button id="closeChangelog" class="secondary">סגירה</button>
      </div>
      <ul class="changelog-list">
        ${CHANGELOG.map(
          (v) => `
            <li>
              <span class="changelog-emoji">${v.emoji}</span>
              <div class="changelog-body">
                <div class="changelog-title">${escapeHtml(v.title)} <span class="changelog-version">v${v.version}</span></div>
                <p class="hint">${escapeHtml(v.desc)}</p>
              </div>
            </li>`,
        ).join("")}
      </ul>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#closeChangelog")!.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function renderProfileEditor(): void {
  app.innerHTML = `
    <div class="screen home">
      <div class="wizard">
        <h1>${hadSavedPlayer ? "עדכון שחקן" : "שחקן חדש"}</h1>
        <label>השם שלך</label>
        <input id="name" maxlength="20" value="${escapeHtml(myName)}" placeholder="לדוגמה: דנה" />
        <label>בחרו אווטאר</label>
        <div class="avatar-picker">
          ${AVATARS.map(
            (a) => `<button class="avatar-choice${a === myAvatar ? " selected" : ""}" data-avatar="${a}">${a}</button>`,
          ).join("")}
        </div>
        <button id="doneProfile" ${myName.trim() ? "" : "disabled"}>${hadSavedPlayer ? "שמור" : "צור שחקן"}</button>
      </div>
    </div>
  `;

  const input = app.querySelector<HTMLInputElement>("#name")!;
  const doneBtn = app.querySelector<HTMLButtonElement>("#doneProfile")!;

  input.addEventListener("input", () => {
    myName = input.value;
    localStorage.setItem(LS_NAME, myName);
    doneBtn.disabled = !myName.trim();
  });

  app.querySelectorAll<HTMLButtonElement>(".avatar-choice").forEach((btn) => {
    btn.addEventListener("click", () => {
      myAvatar = btn.dataset.avatar!;
      localStorage.setItem(LS_AVATAR, myAvatar);
      render();
    });
  });

  doneBtn.addEventListener("click", () => {
    if (!myName.trim()) return;
    localStorage.setItem(LS_NAME, myName);
    localStorage.setItem(LS_AVATAR, myAvatar);
    hadSavedPlayer = true;
    editingProfile = false;
    render();
  });
}

function renderStepGameName(): void {
  app.innerHTML = `
    <div class="screen home">
      <div class="wizard">
        <h1>🎉 משחק חדש</h1>
        <label>שם למשחק (לא חובה)</label>
        <input id="gameName" maxlength="40" placeholder="לדוגמה: ערב משחקים אצל דנה" />
        <label>קטגוריות בוחרים בלובי, אחרי היצירה.</label>
        <button id="createNow">צור משחק</button>
        <button id="back" class="secondary">חזרה</button>
      </div>
    </div>
  `;

  app.querySelector("#back")!.addEventListener("click", () => {
    homeStep = "profile";
    render();
  });
  app.querySelector("#createNow")!.addEventListener("click", async () => {
    const input = app.querySelector<HTMLInputElement>("#gameName")!;
    const gameName = input.value.trim() || `המשחק של ${myName.trim()}`;
    const c = await createGame(myUid, myName.trim(), myAvatar, gameName);
    history.replaceState(null, "", location.pathname);
    setCode(c);
  });
}

function renderStepJoin(urlCode: string): void {
  app.innerHTML = `
    <div class="screen home">
      <div class="wizard">
        <h1>הצטרפות למשחק</h1>
        <p class="hint">סרקו QR או הזינו קוד ידנית.</p>
        <input id="joinCode" maxlength="5" value="${escapeHtml(urlCode)}" placeholder="קוד" class="code-input" />
        <button id="join">הצטרף</button>
        <button id="scan" class="scan-btn">📷 סרקו קוד QR</button>
        ${joinError ? `<p class="error">${escapeHtml(joinError)}</p>` : ""}
        <button id="back" class="secondary">חזרה</button>
      </div>
    </div>
  `;

  app.querySelector("#back")!.addEventListener("click", () => {
    joinError = "";
    homeStep = "profile";
    render();
  });
  app.querySelector("#join")!.addEventListener("click", async () => {
    const input = app.querySelector<HTMLInputElement>("#joinCode")!;
    const c = input.value.trim().toUpperCase();
    if (!c) return;
    const ok = await attemptJoin(c);
    if (!ok) render();
  });
  const startScan = (): void => {
    openQrScanner((text) => {
      const c = extractCode(text);
      if (!c) return;
      void attemptJoin(c).then((ok) => {
        if (!ok) render();
      });
    });
  };
  app.querySelector("#scan")!.addEventListener("click", startScan);

  if (joinAutoOpenCamera) {
    joinAutoOpenCamera = false;
    startScan();
  }
}

function renderLobby(): void {
  const g = game!;
  const isHost = g.hostUid === myUid;
  app.innerHTML = `
    <div class="screen lobby">
      <div class="lobby-header">
        <h1>${escapeHtml(g.name) || "לובי"}</h1>
        <button id="openShare" class="share-btn">📤 שתפו</button>
      </div>
      <div class="code-chip">קוד: <b>${g.code}</b></div>

      <div class="player-chips">
        ${players.map((p) => `<span class="player-chip">${p.avatar} ${escapeHtml(p.name)}${p.uid === g.hostUid ? " 👑" : ""}</span>`).join("")}
      </div>

      <h2>קטגוריות</h2>
      ${
        isHost
          ? `<div class="category-chips">
              ${CATEGORIES.map(
                (c) => `<button class="category-chip${g.topics.includes(c.key) ? " selected" : ""}" data-key="${c.key}">${escapeHtml(c.label)}</button>`,
              ).join("")}
            </div>`
          : `<div class="category-chips readonly">
              ${g.topics.length
                ? g.topics.map((key) => `<span class="category-chip selected">${escapeHtml(getCategory(key)?.label ?? key)}</span>`).join("")
                : "<span class='hint'>המארח עדיין לא בחר קטגוריות</span>"}
            </div>`
      }

      <div class="settings-row">
        <div class="setting-col">
          <h2>כמות שאלות</h2>
          ${
            isHost
              ? `<div class="slider-row">
                  <input type="range" id="totalQuestions" min="3" max="20" step="1" value="${g.totalQuestions ?? DEFAULT_TOTAL_QUESTIONS}" />
                  <span class="slider-value" id="totalQuestionsValue">${g.totalQuestions ?? DEFAULT_TOTAL_QUESTIONS}</span>
                </div>`
              : `<p class="hint">${g.totalQuestions ?? DEFAULT_TOTAL_QUESTIONS} שאלות</p>`
          }
        </div>
        <div class="setting-col">
          <h2>מהירות</h2>
          ${
            isHost
              ? `<div class="speed-picker compact">
                  ${SPEED_PRESETS.map(
                    (s) => `<button class="speed-choice${(g.questionDurationMs ?? QUESTION_DURATION_MS) === s.ms ? " selected" : ""}" data-ms="${s.ms}" title="${s.sub}">${s.label}</button>`,
                  ).join("")}
                </div>`
              : `<p class="hint">${SPEED_PRESETS.find((s) => s.ms === (g.questionDurationMs ?? QUESTION_DURATION_MS))?.label ?? "⚡ רגיל"}</p>`
          }
        </div>
      </div>

      ${
        isHost
          ? `<button id="startGame" ${g.topics.length < 1 ? "disabled" : ""}>
              ${players.length < 2 ? "🎮 תצוגה מקדימה (לבד)" : "התחל משחק"}
            </button>
            ${players.length < 2 ? "<p class='hint small'>משחק לבד — אתה גם שואל וגם עונה.</p>" : ""}
            ${g.topics.length < 1 ? "<p class='hint small'>בחרו לפחות קטגוריה אחת</p>" : ""}`
          : "<p class='hint'>ממתינים שהמארח יתחיל…</p>"
      }
      <button id="leave" class="secondary small">עזוב</button>
    </div>
  `;
  maybeAnimateHeading(`lobby:${g.code}`, ".lobby-header h1", "drop");

  const joinUrl = `${location.origin}${location.pathname}?code=${g.code}`;

  if (isHost) {
    app.querySelectorAll<HTMLButtonElement>(".category-chip").forEach((chip) => {
      chip.addEventListener("click", async () => {
        const key = chip.dataset.key!;
        const next = g.topics.includes(key) ? g.topics.filter((t) => t !== key) : [...g.topics, key];
        await setTopics(g.code, next);
      });
    });

    const totalQuestionsInput = app.querySelector<HTMLInputElement>("#totalQuestions")!;
    const totalQuestionsValue = app.querySelector<HTMLSpanElement>("#totalQuestionsValue")!;
    let currentMs = g.questionDurationMs ?? QUESTION_DURATION_MS;
    totalQuestionsInput.addEventListener("input", () => {
      totalQuestionsValue.textContent = totalQuestionsInput.value;
    });
    totalQuestionsInput.addEventListener("change", async () => {
      await setGameSettings(g.code, Number(totalQuestionsInput.value), currentMs);
    });

    app.querySelectorAll<HTMLButtonElement>(".speed-choice").forEach((btn) => {
      btn.addEventListener("click", async () => {
        currentMs = Number(btn.dataset.ms);
        app.querySelectorAll<HTMLButtonElement>(".speed-choice").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        await setGameSettings(g.code, Number(totalQuestionsInput.value), currentMs);
      });
    });

    app.querySelector("#startGame")!.addEventListener("click", async () => {
      const order = buildOrder(
        players.map((p) => p.uid),
        g.totalQuestions ?? DEFAULT_TOTAL_QUESTIONS,
      );
      await startGame(g.code, order);
    });
  }

  app.querySelector("#leave")!.addEventListener("click", leaveGame);
  app.querySelector("#openShare")!.addEventListener("click", () => openShareSheet(g.code, joinUrl));
}

function openShareSheet(code: string, joinUrl: string): void {
  const overlay = document.createElement("div");
  overlay.className = "share-overlay";
  overlay.innerHTML = `
    <div class="share-sheet">
      <h1>הזמנה למשחק</h1>
      <div class="join-code">${code}</div>
      <div class="qr-wrap"><canvas id="qr"></canvas></div>
      <button id="shareQr">📤 שתפו ב-WhatsApp</button>
      <p class="hint">שתפו את הקוד או סרקו את ה-QR — שתי הדרכים מצטרפות לאותו משחק.</p>
      <button id="closeShare" class="secondary">סגירה</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const qrCanvas = overlay.querySelector<HTMLCanvasElement>("#qr")!;
  QRCode.toCanvas(qrCanvas, joinUrl, { margin: 1, width: 200 }).catch(() => {});

  overlay.querySelector("#shareQr")!.addEventListener("click", () => {
    void shareJoinQr(qrCanvas, joinUrl, code);
  });
  overlay.querySelector("#closeShare")!.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

async function shareJoinQr(canvas: HTMLCanvasElement, joinUrl: string, code: string): Promise<void> {
  const text = `הצטרפו למשחק הטריוויה שלי! קוד: ${code}\n${joinUrl}`;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

  if (blob && navigator.canShare) {
    const file = new File([blob], "qr.png", { type: "image/png" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "מסיבת טריוויה", text });
        return;
      } catch {
        return;
      }
    }
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: "מסיבת טריוויה", text, url: joinUrl });
      return;
    } catch {
      return;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    alert("הקישור הועתק — הדביקו אותו בוואטסאפ");
  } catch {
    alert(joinUrl);
  }
}

const CHOICE_LETTERS = ["א", "ב", "ג", "ד"];
const CHOICE_CLASSES = ["choice-a", "choice-b", "choice-c", "choice-d"];

function renderPlaying(): void {
  const g = game!;
  const r = round;
  const myScore = players.find((p) => p.uid === myUid)?.score ?? 0;
  const amAsker = r?.askerUid === myUid;
  const myAnswer = answers.find((a) => a.uid === myUid);
  const scoreboard = renderScoreboardRows(players, myUid);
  const oldRects = captureRects(".scoreboard .score-row");

  let main = "";
  let headingAnim: { key: string; variant: TextAnim } | null = null;
  if (!r) {
    main = "<p>טוען סיבוב…</p>";
  } else if (r.status === "asking") {
    headingAnim = { key: `asking:${g.turnIndex}:${amAsker}`, variant: "write" };
    if (amAsker) {
      const categoryOptions = g.topics
        .map((key) => `<button class="pick-category" data-category="${key}">${escapeHtml(getCategory(key)?.label ?? key)}</button>`)
        .join("");
      main = `
        <h1>התור שלך לשאול!</h1>
        <p class="hint">בחרו קטגוריה, קראו את השאלה בקול, ואז התחילו כדי שכולם יראו את האפשרויות.</p>
        <div class="topic-picker">${categoryOptions}</div>
        ${
          localQuestion
            ? `<div class="question-reveal">
                <p class="hint">${escapeHtml(getCategory(localQuestion.categoryKey)?.label ?? "")}</p>
                <p class="question-text">${escapeHtml(localQuestion.text)}</p>
                ${renderChoiceGrid(localQuestion.choices, localQuestion.correctIndex, null, true)}
              </div>
              <button id="startQuestion" class="primary big">קראתי — התחילו!</button>`
            : ""
        }
      `;
    } else {
      main = `
        <h1>${tagOf(r.askerUid)} שואל/ת…</h1>
        <p class="hint">התכוננו לענות!</p>
      `;
    }
  } else if (r.status === "question") {
    const categoryLabel = r.categoryKey ? getCategory(r.categoryKey)?.label : undefined;
    const questionText =
      r.categoryKey && r.questionId ? getQuestion(r.categoryKey, r.questionId)?.q : undefined;
    const elapsed = questionStartMs !== null ? Date.now() - questionStartMs : 0;
    const remainingMs = Math.max(0, currentQuestionDurationMs - elapsed);
    const remainingSec = Math.ceil(remainingMs / 1000);
    const pct = Math.max(0, Math.min(100, (remainingMs / currentQuestionDurationMs) * 100));
    const low = pct <= 30;
    const timerBar = `
      <div class="timer-bar"><div class="timer-bar-fill${low ? " low" : ""}" style="width:${pct}%"></div></div>
      <p class="hint timer-sec${low ? " low" : ""}">${remainingSec} שניות</p>
    `;
    const sky = renderSky(pct / 100);
    const soloPreview = amAsker && players.length === 1;
    if (amAsker && !soloPreview) {
      main = `
        <h1>מי יענה נכון?</h1>
        ${categoryLabel ? `<p class="hint">${escapeHtml(categoryLabel)}</p>` : ""}
        ${questionText ? `<p class="question-text">${escapeHtml(questionText)}</p>` : ""}
        ${timerBar}
        <div class="sky-wrap">${sky}${renderChoiceGrid(r.choices ?? [], null, null, true)}</div>
        <p class="hint">${answers.length} מתוך ${Math.max(players.length - 1, 0)} ענו</p>
      `;
    } else {
      const choiceIndex = myAnswer ? myAnswer.choiceIndex : (myPendingChoice ?? null);
      main = `
        <h1>${soloPreview ? "תצוגה מקדימה — ענה בעצמך" : `${tagOf(r.askerUid)} שאל/ה שאלה`}</h1>
        ${categoryLabel ? `<p class="hint">${escapeHtml(categoryLabel)}</p>` : ""}
        ${questionText ? `<p class="question-text">${escapeHtml(questionText)}</p>` : ""}
        ${timerBar}
        <div class="sky-wrap">${sky}${renderChoiceGrid(r.choices ?? [], null, choiceIndex, choiceIndex !== null, elapsed)}</div>
      `;
    }
  } else if (r.status === "done") {
    headingAnim = { key: `done:${g.turnIndex}`, variant: "explode" };
    const category = r.categoryKey ? getCategory(r.categoryKey) : undefined;
    const categoryLabel = category?.label;
    const questionText =
      r.categoryKey && r.questionId ? getQuestion(r.categoryKey, r.questionId)?.q : undefined;
    main = `
      <h1>${amAsker ? "התוצאות!" : `${tagOf(r.askerUid)} שאל/ה`}</h1>
      ${categoryLabel ? `<p class="hint">${escapeHtml(categoryLabel)}</p>` : ""}
      ${questionText ? `<p class="question-text">${escapeHtml(questionText)}</p>` : ""}
      ${renderChoiceGrid(r.choices ?? [], r.correctIndex, myAnswer ? myAnswer.choiceIndex : null, true)}
      ${renderAnswerResults(answers, r.correctIndex)}
      ${
        amAsker
          ? `<button id="nextQuestion" class="primary big">לשאלה הבאה</button>`
          : "<p class='hint'>ממתינים לשאלה הבאה…</p>"
      }
    `;
  }

  app.innerHTML = `
    <div class="screen playing">
      <div class="topbar">
        <span>${escapeHtml(g.name) || `קוד ${g.code}`}</span>
        <span>אתה: ${myScore}</span>
      </div>
      <div class="main">${main}</div>
      <h2>טבלת ניקוד</h2>
      ${scoreboard}
    </div>
  `;
  if (headingAnim) maybeAnimateHeading(headingAnim.key, ".main h1", headingAnim.variant);
  playFlip(".scoreboard .score-row", oldRects);

  app.querySelectorAll<HTMLButtonElement>(".pick-category").forEach((btn) => {
    btn.addEventListener("click", () => {
      const categoryKey = btn.dataset.category!;
      const question = pickRandomQuestion(categoryKey, g.usedQuestions);
      if (!question) return;
      const { choices, correctIndex } = shuffledChoices(question);
      localQuestion = { categoryKey, questionId: question.id, text: question.q, choices, correctIndex };
      render();
    });
  });

  app.querySelector("#startQuestion")?.addEventListener("click", async () => {
    if (!localQuestion) return;
    await startQuestion(
      g.code,
      g.turnIndex,
      localQuestion.categoryKey,
      localQuestion.questionId,
      localQuestion.choices,
      localQuestion.correctIndex,
    );
  });

  if (r?.status === "question" && (!amAsker || players.length === 1)) {
    app.querySelectorAll<HTMLButtonElement>(".choice-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (myAnswer || myPendingChoice !== null) return;
        const choiceIndex = Number(btn.dataset.index);
        myPendingChoice = choiceIndex;
        render();
        const elapsedMs = questionStartMs !== null ? Date.now() - questionStartMs : 0;
        const correct = choiceIndex === r.correctIndex;
        await submitAnswer(
          g.code,
          g.turnIndex,
          myUid,
          myName,
          choiceIndex,
          elapsedMs,
          correct,
          currentQuestionDurationMs,
        );
      });
    });
  }

  app.querySelector("#nextQuestion")?.addEventListener("click", async () => {
    await advanceTurn(g.code, g);
  });
}

const SKY_DAY_TOP = [110, 198, 235];
const SKY_DAY_BOTTOM = [255, 226, 154];
const SKY_DUSK_TOP = [91, 46, 110];
const SKY_DUSK_BOTTOM = [255, 112, 67];
const SKY_NIGHT_TOP = [5, 6, 26];
const SKY_NIGHT_BOTTOM = [11, 16, 48];
const SKY_STARS = [
  [10, 15],
  [25, 8],
  [40, 20],
  [60, 10],
  [75, 18],
  [88, 12],
  [18, 32],
  [52, 28],
  [82, 32],
];

function lerpSkyStop(t: number, day: number[], dusk: number[], night: number[]): number[] {
  if (t >= 0.5) {
    const local = (t - 0.5) / 0.5;
    return dusk.map((v, i) => Math.round(v + (day[i] - v) * local));
  }
  const local = t / 0.5;
  return night.map((v, i) => Math.round(v + (dusk[i] - v) * local));
}

function renderSky(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const top = lerpSkyStop(clamped, SKY_DAY_TOP, SKY_DUSK_TOP, SKY_NIGHT_TOP);
  const bottom = lerpSkyStop(clamped, SKY_DAY_BOTTOM, SKY_DUSK_BOTTOM, SKY_NIGHT_BOTTOM);
  const sunOpacity = Math.max(0, Math.min(1, (clamped - 0.1) / 0.4));
  const moonOpacity = Math.max(0, Math.min(1, (0.55 - clamped) / 0.3));
  const bodyTop = 8 + (1 - clamped) * 60;
  return `
    <div class="sky-body" style="background:linear-gradient(180deg, rgb(${top.join(",")}), rgb(${bottom.join(",")}))">
      ${SKY_STARS.map(([x, y]) => `<span class="sky-star" style="left:${x}%; top:${y}%; opacity:${moonOpacity}">✨</span>`).join("")}
      <span class="sky-sun" style="top:${bodyTop}%; opacity:${sunOpacity}">☀️</span>
      <span class="sky-moon" style="top:${bodyTop}%; opacity:${moonOpacity}">🌙</span>
    </div>
  `;
}

function renderChoiceGrid(
  choices: string[],
  correctIndex: number | null,
  selectedIndex: number | null,
  disabled: boolean,
  liveElapsedMs?: number,
): string {
  if (!choices.length) return "";
  return `
    <div class="choice-grid-answers">
      ${choices
        .map((text, i) => {
          const isCorrect = correctIndex !== null && i === correctIndex;
          const isWrongPick = correctIndex !== null && selectedIndex === i && i !== correctIndex;
          const isSelected = selectedIndex === i;
          const isLive = liveElapsedMs !== undefined && !disabled;
          const classes = [
            "choice-btn",
            CHOICE_CLASSES[i],
            isCorrect ? "reveal-correct" : "",
            isWrongPick ? "reveal-wrong" : "",
            isSelected && correctIndex === null ? "picked" : "",
            isLive ? "scan" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const scanStyle = isLive
            ? ` style="animation-delay:${i * 0.05}s, -${(((liveElapsedMs ?? 0) / 1000 + i * 0.6) % 2.4).toFixed(3)}s"`
            : "";
          return `<button class="${classes}" data-index="${i}" ${disabled ? "disabled" : ""}${scanStyle}>
            <span class="choice-letter">${CHOICE_LETTERS[i]}</span><span>${escapeHtml(text)}</span>
          </button>`;
        })
        .join("")}
    </div>
  `;
}

function renderAnswerResults(list: Answer[], correctIndex: number | null): string {
  if (!list.length) return "<p class='hint'>אף אחד לא הספיק לענות.</p>";
  const sorted = list.slice().sort((a, b) => a.elapsedMs - b.elapsedMs);
  return `
    <ol class="buzz-list">
      ${sorted
        .map((a) => {
          const correct = correctIndex !== null && a.choiceIndex === correctIndex;
          const tag = correct ? ` ✔ +${calcPoints(a.elapsedMs, currentQuestionDurationMs)}` : " ✘";
          return `<li>${avatarOf(a.uid)} ${escapeHtml(a.name)}${tag}</li>`;
        })
        .join("")}
    </ol>
  `;
}

function renderEnded(): void {
  app.innerHTML = `
    <div class="screen ended">
      <h1>🏆 המשחק נגמר!</h1>
      ${renderScoreboardRows(players, myUid)}
      <button id="again">משחק חדש</button>
    </div>
  `;
  maybeAnimateHeading(`ended:${game?.code ?? ""}`, ".ended h1", "drop");
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
