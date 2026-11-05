// Discord <-> chat.deepseek.com bridge. Text only, free web UI, no paid APIs.
//
//   Discord message -> this bot -> Playwright types it into the DeepSeek web chat
//   -> waits for the reply to finish streaming -> posts it back in Discord.
//
// Run: npm run login (once), then npm start. Needs Node >= 20.6.

import { Client, GatewayIntentBits, Partials, Events, AttachmentBuilder } from "discord.js";
import { chromium } from "playwright";
import path from "node:path";

const env = process.env;
const TOKEN = env.DISCORD_TOKEN;
const ALLOWED = new Set((env.ALLOWED_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean));
const CHANNEL_ID = env.CHANNEL_ID || "";
const PROFILE_DIR = path.resolve(env.PROFILE_DIR || "./profile");
const CHANNEL = (env.BROWSER_CHANNEL ?? "chrome") || undefined;
const BROWSER_PATH = env.BROWSER_PATH || "";
const CDP_URL = env.CDP_URL || "";
const HEADLESS = env.HEADLESS === "true";
const AUTO_NEW_EVERY = Number(env.AUTO_NEW_EVERY ?? 40) || 0;
const STABLE_MS = Number(env.STABLE_MS || 100);
const REPLY_TIMEOUT_MS = Number(env.REPLY_TIMEOUT_MS || 240000);
const INPUT_SEL = env.INPUT_SELECTOR || "textarea";
const REPLY_SEL = env.REPLY_SELECTOR || ".ds-markdown";
const HOME = "https://chat.deepseek.com/";

if (!TOKEN) { console.error("DISCORD_TOKEN is missing (see .env.example)."); process.exit(1); }
if (!ALLOWED.size) { console.error("ALLOWED_USER_IDS is empty. Refusing to start: the bot drives your DeepSeek account."); process.exit(1); }

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── browser side ─────────────────────────
let browser = null, ctx = null, page = null, turns = 0;

async function getPage() {
  if (page && !page.isClosed()) return page;
  if (!ctx) {
    if (CDP_URL) {
      // Attach to a Brave/Chrome you started yourself (see README): looks like a normal browser, so no captcha trouble.
      browser = await chromium.connectOverCDP(CDP_URL);
      ctx = browser.contexts()[0] || (await browser.newContext());
      browser.on("disconnected", () => { browser = null; ctx = null; page = null; log("lost the browser connection; will reconnect on the next message"); });
    } else {
      ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
        channel: BROWSER_PATH ? undefined : CHANNEL,
        executablePath: BROWSER_PATH || undefined,
        headless: HEADLESS,
        viewport: { width: 1280, height: 900 },
        ignoreDefaultArgs: ["--enable-automation"],
        args: ["--disable-blink-features=AutomationControlled"],
      });
      ctx.on("close", () => { ctx = null; page = null; log("browser closed; it will be relaunched on the next message"); });
    }
  }
  page = ctx.pages().find((p) => p.url().startsWith(HOME)) || (CDP_URL ? await ctx.newPage() : (ctx.pages()[0] || (await ctx.newPage())));
  if (!page.url().startsWith(HOME)) await page.goto(HOME, { waitUntil: "domcontentloaded" });
  await ensureReady(page);
  return page;
}

async function ensureReady(p) {
  try {
    await p.locator(INPUT_SEL).first().waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    throw new Error(`Chat input (${INPUT_SEL}) not found. Not logged in? Run "npm run login". Otherwise DeepSeek's UI changed: fix INPUT_SELECTOR and try !shot.`);
  }
}

async function newChat() {
  const p = await getPage();
  await p.goto(HOME, { waitUntil: "domcontentloaded" });
  await ensureReady(p);
  turns = 0;
}

// Reads the newest assistant message and converts its HTML to Discord-friendly markdown.
function readLastReply(p) {
  return p.evaluate((sel) => {
    const els = document.querySelectorAll(sel);
    const root = els[els.length - 1];
    if (!root) return "";
    const kids = (n) => [...n.childNodes].map(walk).join("");
    function walk(n) {
      if (n.nodeType === 3) return n.textContent;
      if (n.nodeType !== 1) return "";
      const tag = n.tagName.toLowerCase();
      switch (tag) {
        case "pre": {
          const c = n.querySelector("code") || n;
          const lang = ((c.className || "").match(/language-([\w+#-]+)/) || [])[1] || "";
          return "\n```" + lang + "\n" + c.textContent.replace(/\n$/, "") + "\n```\n";
        }
        case "code": return "`" + n.textContent + "`";
        case "strong": case "b": return "**" + kids(n) + "**";
        case "em": case "i": return "*" + kids(n) + "*";
        case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
          return "\n" + "#".repeat(Math.min(3, Number(tag[1]))) + " " + kids(n).trim() + "\n";
        case "ul": return "\n" + [...n.children].map((li) => "- " + kids(li).trim()).join("\n") + "\n";
        case "ol": return "\n" + [...n.children].map((li, i) => `${i + 1}. ` + kids(li).trim()).join("\n") + "\n";
        case "p": return kids(n) + "\n\n";
        case "br": return "\n";
        case "hr": return "\n---\n";
        case "blockquote": return "\n" + kids(n).trim().split("\n").map((l) => "> " + l).join("\n") + "\n";
        case "a": return n.href ? `[${kids(n)}](${n.href})` : kids(n);
        case "tr": return [...n.children].map((c) => c.textContent.trim()).join(" | ") + "\n";
        case "button": case "svg": case "style": case "script": return "";
        default: return kids(n);
      }
    }
    return walk(root).replace(/\n{3,}/g, "\n\n").trim();
  }, REPLY_SEL);
}

async function ask(prompt) {
  if (AUTO_NEW_EVERY && turns >= AUTO_NEW_EVERY) { log(`auto new chat after ${turns} messages`); await newChat(); }
  const p = await getPage();
  await ensureReady(p);

  const before = await p.locator(REPLY_SEL).count();
  const input = p.locator(INPUT_SEL).first();
  await input.fill(prompt);
  await input.press("Enter");
  turns++;

  try {
    await p.waitForFunction(([s, n]) => document.querySelectorAll(s).length > n, [REPLY_SEL, before], { timeout: 60_000 });
  } catch {
    throw new Error(`No reply appeared within 60s. The message may not have sent, DeepSeek may be rate-limiting or busy, or REPLY_SELECTOR (${REPLY_SEL}) is wrong. Try !shot.`);
  }

  const started = Date.now();
  let last = "", changedAt = Date.now();
  while (Date.now() - started < REPLY_TIMEOUT_MS) {
    await sleep(500);
    const txt = await readLastReply(p);
    if (txt !== last) { last = txt; changedAt = Date.now(); }
    else if (last && Date.now() - changedAt >= STABLE_MS) return last;
  }
  if (!last) throw new Error("Reply stayed empty until the timeout.");
  return last + "\n\n_(timed out while waiting; this reply may be incomplete)_";
}

// ───────────────────────── discord side ─────────────────────────
// Splits text into <= max-char pieces, closing and reopening ``` fences across pieces.
function chunk(text, max = 1900) {
  const out = [];
  let cur = "", fence = null;
  const lines = [];
  for (const l of text.split("\n")) for (let i = 0; i < Math.max(1, l.length); i += 1800) lines.push(l.slice(i, i + 1800));
  for (const l of lines) {
    if (cur.length + l.length + 1 > max - 8 && cur.trim()) {
      out.push(fence ? cur + "\n```" : cur);
      cur = fence ? "```" + fence + "\n" : "";
    }
    cur += (cur && !cur.endsWith("\n") ? "\n" : "") + l;
    if (l.startsWith("```")) fence = fence ? null : l.slice(3).trim();
  }
  if (cur.trim()) out.push(cur);
  return out.length ? out : ["(empty reply)"];
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],   // needed to receive DMs
});

let queue = Promise.resolve();   // one browser page, so one job at a time
const NO_PING = { parse: [], repliedUser: false };

async function handle(msg, text) {
  const typing = setInterval(() => msg.channel.sendTyping().catch(() => {}), 8000);
  msg.channel.sendTyping().catch(() => {});
  try {
    if (text === "!new") { await newChat(); await msg.reply({ content: "Started a fresh DeepSeek chat.", allowedMentions: NO_PING }); return; }
    if (text === "!shot") {
      const buf = await (await getPage()).screenshot();
      await msg.reply({ files: [new AttachmentBuilder(buf, { name: "deepseek.png" })], allowedMentions: NO_PING });
      return;
    }
    log(`← ${msg.author.tag}: ${text.slice(0, 80)}`);
    const reply = await ask(text);
    const parts = chunk(reply);
    await msg.reply({ content: parts[0], allowedMentions: NO_PING });
    for (const part of parts.slice(1)) await msg.channel.send({ content: part, allowedMentions: NO_PING });
    log(`→ replied (${reply.length} chars, ${parts.length} message${parts.length > 1 ? "s" : ""})`);
  } catch (e) {
    log("error:", e.message);
    await msg.reply({ content: `⚠️ ${String(e.message).split("\n")[0]}`.slice(0, 1900), allowedMentions: NO_PING }).catch(() => {});
  } finally {
    clearInterval(typing);
  }
}

client.on(Events.MessageCreate, (msg) => {
  if (msg.author.bot || !ALLOWED.has(msg.author.id)) return;
  const isDM = !msg.guild;
  const mentioned = msg.mentions.users.has(client.user.id);
  const inChannel = CHANNEL_ID && msg.channelId === CHANNEL_ID;
  if (!isDM && !mentioned && !inChannel) return;
  const text = msg.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
  if (!text) return;
  queue = queue.then(() => handle(msg, text));
});

client.once(Events.ClientReady, async (c) => {
  log(`Discord: logged in as ${c.user.tag}. Allowed users: ${[...ALLOWED].join(", ")}`);
  try { await getPage(); log("DeepSeek: chat is ready"); }
  catch (e) { log("DeepSeek not ready yet:", e.message); }
});

const shutdown = async () => { if (!CDP_URL) { try { await ctx?.close(); } catch {} } client.destroy(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await client.login(TOKEN);
