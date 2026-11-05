// One-time login: opens a real browser window using the same persistent profile the bot uses.
// Log in to DeepSeek (solve any captcha), then just close the window.
import { chromium } from "playwright";
import path from "node:path";

const PROFILE_DIR = path.resolve(process.env.PROFILE_DIR || "./profile");
const BROWSER_PATH = process.env.BROWSER_PATH || "";
const channel = (process.env.BROWSER_CHANNEL ?? "chrome") || undefined;

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: BROWSER_PATH ? undefined : channel,
  executablePath: BROWSER_PATH || undefined,
  headless: false,
  viewport: null,
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto("https://chat.deepseek.com/");
console.log("Log in to DeepSeek in the opened window, then close the window to finish.");
await new Promise((resolve) => ctx.on("close", resolve));
console.log("Profile saved in", PROFILE_DIR);
