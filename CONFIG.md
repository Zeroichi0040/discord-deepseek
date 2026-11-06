# Configuration reference

Every setting lives in `.env` and is loaded by `node --env-file=.env`. **Restart the bot after changing anything.**
`.env.example` is the template; `.env` holds your real values and must never be committed or shared.

---

## Required

| Setting | What it does |
|---|---|
| `DISCORD_TOKEN` | The bot's login. Treat it like a password. If it ever leaks, reset it in the Discord Developer Portal (Bot → Reset Token) and update `.env`. |
| `ALLOWED_USER_IDS` | Comma-separated Discord user IDs the bot will answer. Everyone else is silently ignored. This exists because the bot types into **your** logged-in DeepSeek account, so anyone who could message it would be using your account. The bot refuses to start if this is empty. |

## Where the bot listens

| Setting | What it does |
|---|---|
| `CHANNEL_ID` | Optional. If set, every message from an allowed user in that channel is answered without an @mention. Leave blank to require an @mention (DMs always work). |

---

## Browser (pick ONE mode)

The bot picks the first one that is set, in this order:

1. **`CDP_URL`** (recommended): attach to a Brave you started yourself, e.g. `http://127.0.0.1:9222`.
   Brave must be running with `--remote-debugging-port=9222 --user-data-dir=<some separate folder>`.
   Because you launched it normally, it looks like an ordinary browser, so DeepSeek's captcha is not a problem.
   In this mode `BROWSER_PATH`, `PROFILE_DIR`, `HEADLESS` and `npm run login` are not used.
2. **`BROWSER_PATH`**: full path to a browser executable (must be the program, e.g. `brave.exe`, **not** a profile folder).
   The bot launches it itself with Playwright.
3. **`BROWSER_CHANNEL`**: `chrome` (default) uses installed Chrome. Blank uses Playwright's bundled Chromium
   (needs `npx playwright install chromium`).

| Setting | What it does |
|---|---|
| `PROFILE_DIR` | Launch modes only. Folder where the bot's own browser profile (your DeepSeek login) is stored. Default `./profile`. |
| `HEADLESS` | Launch modes only. `true` hides the window. More likely to trigger bot checks; keep `false` unless you have a reason. |

---

## Reply timing

### `STABLE_MS` (default 5000)

**What it is:** how long the reply text must stay unchanged before the bot decides DeepSeek is done typing.

**How it really works:** the bot reads the newest reply every **500 ms** (hard-coded in `bot.mjs`). If the text differs from the previous read, the timer resets. If it is the same, non-empty, and has been unchanged for at least `STABLE_MS`, the reply is considered finished and gets posted.

**Why 100 works and feels "fast but not instant":** because reads are 500 ms apart, any value of 500 or below behaves identically. The bot finishes at the first read that matches the previous one, i.e. roughly **0.5 to 1 second after the last token**, not 100 ms. Values between 500 and 1000 behave like about 1000 (two polls), and so on in steps of 500.

**The trade-off:** a low value assumes DeepSeek never pauses mid-answer for more than about half a second. With DeepThink off the text streams steadily, so that mostly holds. If DeepSeek stalls (busy servers, a slow network moment), the bot may post a **partial reply** and the rest is lost. Your next message may also be typed while DeepSeek is still generating; I haven't verified how the web UI handles that.

**Tuning:**
- Replies cut off mid-sentence: raise to 1000-1500.
- Want it even faster: lower the hard-coded `sleep(500)` in `ask()` in `bot.mjs`, or detect completion from the page itself (see HANDOFF.md, next steps).
- DeepThink **on**: use a large value (5000+). Reasoning phases pause the visible reply for long stretches and would trigger an early finish.

### `REPLY_TIMEOUT_MS` (default 240000 = 4 min)

Hard cap on how long the bot keeps watching one reply once it has started streaming. If it is hit, the bot posts whatever it has with an "incomplete" note (or an error if nothing arrived). This is separate from the 60-second wait for the reply to *begin* (hard-coded). Worst case for one message is therefore about 60 s + this value.

### `AUTO_NEW_EVERY` (default 40, `0` = never)

**What it does:** after this many messages sent by the bot into the current DeepSeek chat, the next message first opens a **fresh chat**.

**Why it exists:**
- DeepSeek treats the whole chat as context. As it grows, replies tend to get slower and eventually the chat approaches the model's context limit (I don't know DeepSeek's exact limit, so 40 is a conservative guess, not a measured number).
- The page itself gets heavier as messages pile up, which slows the browser the bot is driving.
- Old messages keep influencing new replies. A reset limits that.

**The cost:** after a reset DeepSeek has no memory of the earlier conversation. If you want continuity, raise it or set `0` and use `!new` yourself when you decide.

**Details:**
- The counter counts messages the bot sent (not your Discord messages, and not replies), so 40 is about 40 exchanges.
- It resets to 0 on `!new`, on each auto-reset, and whenever the bot restarts. In `CDP_URL` mode the bot reuses an already-open DeepSeek tab if there is one, so after a restart it may be continuing a long old chat while its counter says 0. Send `!new` after restarting if you want a clean slate.

---

## Selectors (the part that breaks)

DeepSeek is a website, and it changes its page structure without notice. These two values tell the bot where things are.

| Setting | Default | Meaning |
|---|---|---|
| `INPUT_SELECTOR` | `textarea` | The box you type into. The bot fills it and presses Enter. |
| `REPLY_SELECTOR` | `.ds-markdown` | The element that holds one assistant reply. The bot reads the **last** match on the page, and counts matches to notice that a new reply appeared. |

**Symptoms and fixes**
- *"Chat input not found"* → not logged in, or `INPUT_SELECTOR` is stale.
- *"No reply appeared within 60s"* → the message didn't send, DeepSeek is busy or rate-limiting, or `REPLY_SELECTOR` is stale.
- To find the right one: open the DeepSeek tab, press F12, use the element picker on the text box or on a reply, and look for a stable class name or tag. Send `!shot` in Discord to see what the bot's tab looks like.

---

## Hard-coded values (edit in `bot.mjs`)

| Value | Where | Why |
|---|---|---|
| `https://chat.deepseek.com/` | `HOME` | The page the bot opens; visiting it also starts a new chat. |
| 500 ms poll | `ask()` | How often the reply is re-read (see `STABLE_MS`). |
| 30 s | `ensureReady()` | How long to wait for the input box to appear before giving up. |
| 60 s | `ask()` | How long to wait for a reply to start appearing. |
| 1900 chars | `chunk()` | Discord rejects messages over 2000 characters, so long replies are split. Code blocks are closed and reopened across splits so formatting survives. |
| 8 s | `handle()` | Refresh interval for the "typing…" indicator (Discord's lasts about 10 s). |
| One at a time | `queue` | There is a single browser page, so messages are processed in order. |

## Chat commands

| Command | Does |
|---|---|
| `!new` | Start a fresh DeepSeek chat and reset the counter. |
| `!shot` | Send a screenshot of the bot's DeepSeek tab, for debugging. |
