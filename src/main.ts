import "./style.css";
import QRCode from "qrcode";
import jsQR from "jsqr";
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
import { CATEGORIES, getCategory, getQuestion, pickRandomQuestion } from "./questions";

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

let code: string | null = localStorage.getItem(LS_CODE);
let game: GameDoc | null = null;
let players: Player[] = [];
let round: RoundDoc | null = null;
let buzzes: Buzz[] = [];
let localQuestion: { categoryKey: string; questionId: string } | null = null;
let joinError = "";

type HomeStep = "name" | "avatar" | "choice" | "join";
let homeStep: HomeStep = "name";
let homeInitialized = false;

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
      localQuestion = null;
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
  history.replaceState(null, "", location.pathname);
  homeInitialized = false;
  homeStep = "name";
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
    homeStep = myName.trim() ? "choice" : "name";
  }

  if (homeStep === "name") return renderStepName();
  if (homeStep === "avatar") return renderStepAvatar(urlCode);
  if (homeStep === "choice") return renderStepChoice();
  return renderStepJoin(urlCode);
}

function renderStepName(): void {
  app.innerHTML = `
    <div class="screen home">
      <div class="wizard">
        <h1>🎉 מסיבת טריוויה</h1>
        <div class="progress-dots"><span class="active"></span><span></span><span></span></div>
        <label>איך קוראים לך?</label>
        <input id="name" maxlength="20" value="${escapeHtml(myName)}" placeholder="לדוגמה: דנה" />
        <button id="next" ${myName.trim() ? "" : "disabled"}>הבא</button>
      </div>
    </div>
  `;

  const input = app.querySelector<HTMLInputElement>("#name")!;
  const nextBtn = app.querySelector<HTMLButtonElement>("#next")!;
  input.addEventListener("input", () => {
    myName = input.value;
    localStorage.setItem(LS_NAME, myName);
    nextBtn.disabled = !myName.trim();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && myName.trim()) {
      homeStep = "avatar";
      render();
    }
  });
  nextBtn.addEventListener("click", () => {
    if (!myName.trim()) return;
    homeStep = "avatar";
    render();
  });
}

function renderStepAvatar(urlCode: string): void {
  app.innerHTML = `
    <div class="screen home">
      <div class="wizard">
        <div class="progress-dots"><span></span><span class="active"></span><span></span></div>
        <div class="avatar-big">${myAvatar}</div>
        <h1>בחרו אווטאר, ${escapeHtml(myName)}</h1>
        <div class="avatar-picker">
          ${AVATARS.map(
            (a) => `<button class="avatar-choice${a === myAvatar ? " selected" : ""}" data-avatar="${a}">${a}</button>`,
          ).join("")}
        </div>
        <button id="next">הבא</button>
        <button id="back" class="secondary">חזרה</button>
      </div>
    </div>
  `;

  app.querySelectorAll<HTMLButtonElement>(".avatar-choice").forEach((btn) => {
    btn.addEventListener("click", () => {
      myAvatar = btn.dataset.avatar!;
      localStorage.setItem(LS_AVATAR, myAvatar);
      render();
    });
  });
  app.querySelector("#back")!.addEventListener("click", () => {
    homeStep = "name";
    render();
  });
  app.querySelector("#next")!.addEventListener("click", () => {
    if (urlCode) {
      void autoJoinFlow(urlCode);
    } else {
      homeStep = "choice";
      render();
    }
  });
}

function renderStepChoice(): void {
  app.innerHTML = `
    <div class="screen home">
      <div class="wizard">
        <div class="avatar-big">${myAvatar}</div>
        <h1>היי ${escapeHtml(myName)}!</h1>
        <div class="choice-grid">
          <button id="create" class="choice-card create"><span class="icon">🎉</span><span>צור משחק חדש</span></button>
          <button id="toJoin" class="choice-card join"><span class="icon">🔑</span><span>הצטרף למשחק</span></button>
        </div>
        <button id="editProfile" class="secondary">✏️ שם / אווטאר</button>
      </div>
    </div>
  `;

  app.querySelector("#create")!.addEventListener("click", async () => {
    const c = await createGame(myUid, myName.trim(), myAvatar);
    history.replaceState(null, "", location.pathname);
    setCode(c);
  });
  app.querySelector("#toJoin")!.addEventListener("click", () => {
    homeStep = "join";
    render();
  });
  app.querySelector("#editProfile")!.addEventListener("click", () => {
    homeStep = "name";
    render();
  });
}

function renderStepJoin(urlCode: string): void {
  app.innerHTML = `
    <div class="screen home">
      <div class="wizard">
        <h1>הצטרפות למשחק</h1>
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
    homeStep = "choice";
    render();
  });
  app.querySelector("#join")!.addEventListener("click", async () => {
    const input = app.querySelector<HTMLInputElement>("#joinCode")!;
    const c = input.value.trim().toUpperCase();
    if (!c) return;
    const ok = await attemptJoin(c);
    if (!ok) render();
  });
  app.querySelector("#scan")!.addEventListener("click", () => {
    openQrScanner((text) => {
      const c = extractCode(text);
      if (!c) return;
      void attemptJoin(c).then((ok) => {
        if (!ok) render();
      });
    });
  });
}

function renderLobby(): void {
  const g = game!;
  const isHost = g.hostUid === myUid;
  app.innerHTML = `
    <div class="screen lobby">
      <h1>לובי</h1>
      <div class="join-code">${g.code}</div>
      <div class="qr-wrap"><canvas id="qr"></canvas></div>
      <button id="shareQr" class="secondary">📤 שתפו ב-WhatsApp</button>
      <p class="hint">שתפו את הקוד או סרקו את ה-QR — שתי הדרכים מצטרפות לאותו משחק.</p>

      <h2>שחקנים (${players.length})</h2>
      <ul class="players">
        ${players.map((p) => `<li>${p.avatar} ${escapeHtml(p.name)}${p.uid === g.hostUid ? " 👑" : ""}</li>`).join("")}
      </ul>

      <h2>קטגוריות</h2>
      ${
        isHost
          ? `<ul class="categories">
              ${CATEGORIES.map(
                (c) => `<li>
                  <label>
                    <input type="checkbox" class="category-choice" value="${c.key}" ${g.topics.includes(c.key) ? "checked" : ""} />
                    ${escapeHtml(c.label)} <span class="muted">(${c.questions.length} שאלות)</span>
                  </label>
                </li>`,
              ).join("")}
            </ul>`
          : `<ul class="categories">
              ${g.topics.length
                ? g.topics.map((key) => `<li>${escapeHtml(getCategory(key)?.label ?? key)}</li>`).join("")
                : "<li class='muted'>המארח עדיין לא בחר קטגוריות</li>"}
            </ul>`
      }
      ${
        isHost
          ? `<button id="startGame" ${players.length < 2 || g.topics.length < 1 ? "disabled" : ""}>התחל משחק</button>
            ${players.length < 2 ? "<p class='hint'>צריך לפחות 2 שחקנים</p>" : ""}
            ${g.topics.length < 1 ? "<p class='hint'>בחרו לפחות קטגוריה אחת</p>" : ""}`
          : "<p class='hint'>ממתינים שהמארח יתחיל…</p>"
      }
      <button id="leave" class="secondary">עזוב</button>
    </div>
  `;

  if (isHost) {
    app.querySelectorAll<HTMLInputElement>(".category-choice").forEach((checkbox) => {
      checkbox.addEventListener("change", async () => {
        const key = checkbox.value;
        const next = checkbox.checked ? [...g.topics, key] : g.topics.filter((t) => t !== key);
        await setTopics(g.code, next);
      });
    });
    app.querySelector("#startGame")!.addEventListener("click", async () => {
      const order = players.map((p) => p.uid);
      await startGame(g.code, order);
    });
  }

  app.querySelector("#leave")!.addEventListener("click", leaveGame);

  const joinUrl = `${location.origin}${location.pathname}?code=${g.code}`;
  const qrCanvas = app.querySelector<HTMLCanvasElement>("#qr")!;
  QRCode.toCanvas(qrCanvas, joinUrl, { margin: 1, width: 220 }).catch(() => {});

  app.querySelector("#shareQr")!.addEventListener("click", () => {
    void shareJoinQr(qrCanvas, joinUrl, g.code);
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
        .map((p) => `<li${p.uid === myUid ? ' class="me"' : ""}>${p.avatar} ${escapeHtml(p.name)} — ${p.score}</li>`)
        .join("")}
    </ul>
  `;

  let main = "";
  if (!r) {
    main = "<p>טוען סיבוב…</p>";
  } else if (r.status === "asking") {
    if (amAsker) {
      const categoryOptions = g.topics
        .map((key) => `<button class="pick-category" data-category="${key}">${escapeHtml(getCategory(key)?.label ?? key)}</button>`)
        .join("");
      const picked = localQuestion ? getQuestion(localQuestion.categoryKey, localQuestion.questionId) : undefined;
      main = `
        <h1>התור שלך לשאול!</h1>
        <p class="hint">בחרו קטגוריה, קראו את השאלה בקול, ואז פתחו את הבאזרים.</p>
        <div class="topic-picker">${categoryOptions}</div>
        ${
          picked
            ? `<div class="question-reveal">
                <p class="hint">${escapeHtml(getCategory(localQuestion!.categoryKey)?.label ?? "")}</p>
                <p class="question-text">${escapeHtml(picked.q)}</p>
                <p class="answer-text">תשובה: ${escapeHtml(picked.a)}</p>
              </div>
              <button id="openBuzzing" class="primary big">שאלתי — פתחו את הבאזרים!</button>`
            : ""
        }
      `;
    } else {
      main = `
        <h1>${tagOf(r.askerUid)} שואל/ת…</h1>
        <p class="hint">התכוננו ללחוץ!</p>
      `;
    }
  } else if (r.status === "buzzing") {
    const question = r.categoryKey && r.questionId ? getQuestion(r.categoryKey, r.questionId) : undefined;
    const categoryLabel = r.categoryKey ? getCategory(r.categoryKey)?.label : undefined;
    if (amAsker) {
      main = `
        <h1>מי לחץ ראשון?</h1>
        ${categoryLabel ? `<p class="hint">${escapeHtml(categoryLabel)}</p>` : ""}
        ${question ? `<p class="question-text">${escapeHtml(question.q)}</p><p class="answer-text">תשובה: ${escapeHtml(question.a)}</p>` : ""}
        ${renderBuzzList(buzzes, topBuzz)}
        <button id="noWinner" class="secondary">אף אחד לא ידע — לתור הבא</button>
      `;
    } else {
      main = `
        <h1>${tagOf(r.askerUid)} שאל/ה שאלה</h1>
        ${categoryLabel ? `<p class="hint">${escapeHtml(categoryLabel)}</p>` : ""}
        ${question ? `<p class="question-text">${escapeHtml(question.q)}</p>` : ""}
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

  app.querySelectorAll<HTMLButtonElement>(".pick-category").forEach((btn) => {
    btn.addEventListener("click", () => {
      const categoryKey = btn.dataset.category!;
      const question = pickRandomQuestion(categoryKey, g.usedQuestions);
      if (!question) return;
      localQuestion = { categoryKey, questionId: question.id };
      render();
    });
  });

  app.querySelector("#openBuzzing")?.addEventListener("click", async () => {
    if (!localQuestion) return;
    await openBuzzing(g.code, g.turnIndex, localQuestion.categoryKey, localQuestion.questionId);
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
          return `<li class="${isTop ? "top" : ""}">${avatarOf(b.uid)} ${escapeHtml(b.name)}${tag}${judgeButtons}</li>`;
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
        ${sorted.map((p) => `<li>${p.avatar} ${escapeHtml(p.name)} — ${p.score}</li>`).join("")}
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
