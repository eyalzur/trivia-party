# Trivia Party

Live multiplayer trivia buzzer for a room full of friends. Everyone joins
from their own phone (like Kahoot), the app rotates whose turn it is to
ask a question out loud, and whoever buzzes in first on their phone gets
the first shot at answering. The asker marks correct/wrong and the app
tracks score and turn order.

No question bank — people ask their own questions. The app is the
turn-manager, buzzer, and scoreboard.

## How a game works

1. One person **creates a game**, gets a 5-letter code, picks topic
   labels (e.g. "Movies", "History") that show up for reference during
   the asker's turn.
2. Everyone else **joins** with the code + their name, from their own
   phone.
3. The host starts the game once 2+ players joined. Turn order = join
   order.
4. Each turn: the current player is shown as "asker". They ask their
   question out loud, then tap **"I asked it — open buzzers!"**.
5. Everyone else sees a big **BUZZ** button. First tap wins — order is
   decided by the server's clock, not the phone's, so it's fair even on
   a flaky connection.
6. The asker sees buzzes ranked by who was first and taps **Correct** or
   **Wrong** on the top one. Correct ends the round and awards a point;
   wrong moves down the list. "Nobody got it" skips to the next player.
7. Turn rotates to the next player. Game ends after everyone's had a
   turn in the final round of the rotation; final scoreboard shown.

## Stack

- Vite + TypeScript, no framework — single-page app, hand-rolled render
  loop, installable PWA (`vite-plugin-pwa`).
- Firebase: Anonymous Auth (one tap, no accounts), Firestore (realtime
  state + buzzer race via `serverTimestamp()`), Hosting (static deploy).
  No custom server.

### Trust model

This is built for friends in the same physical room, not strangers on
the internet. Firestore rules block unauthenticated access and make
buzz timestamps server-stamped (so a buzz can't be faked to jump the
queue — that's the one property that actually matters for fairness).
They do **not** stop a player from editing their own score doc directly
via devtools. Good enough for a living-room game night; don't use this
for anything with real stakes against people you don't trust.

## Setup

### 1. Create the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com),
   create a project (reuses your GCP account/billing automatically).
2. **Build → Authentication → Get started → Anonymous** → enable.
3. **Build → Firestore Database → Create database** → start in
   **production mode**, pick a region.
4. **Project settings → General → Your apps → Add app → Web** (`</>`
   icon). Register it (no hosting setup needed here), copy the config
   values it shows you.

### 2. Local config

```bash
cp .env.example .env
```

Fill in the six `VITE_FIREBASE_*` values from step 1.4.

### 3. Install & run

```bash
npm install
npm run dev
```

Open the printed local URL. Open it on your phone too (same wifi,
use your computer's local IP, or deploy first — see below).

### 4. Deploy

```bash
npm install -g firebase-tools   # once
firebase login
firebase use --add              # pick your Firebase project, call it "default"
npm run deploy
```

That builds the app and pushes both Hosting and Firestore rules. The
CLI prints your live URL (`https://<project-id>.web.app`). Share that
URL (or its QR code) with the room — each phone can install it as an
app from the browser's "Add to Home Screen" / install prompt.

## Project layout

- `src/firebase.ts` — Firebase init + anonymous sign-in.
- `src/game.ts` — all Firestore reads/writes (create/join game, topics,
  turn advance, buzz, judge).
- `src/main.ts` — render loop and screens (home, lobby, playing, ended).
- `src/types.ts` — Firestore document shapes.
- `firestore.rules` — security rules (see Trust model above).
