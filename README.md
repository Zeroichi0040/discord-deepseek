# DeepSeek ↔ Discord bridge (free, text only)

Message the Discord bot from any device (including the Discord app on your Android phone). The bot types your
message into the **free chat.deepseek.com web UI** in a logged-in browser, waits for the reply, and posts it back.
No paid APIs and no Better DeepSeek extension needed.

```
Discord app → Discord bot (bot.mjs) → Playwright → chat.deepseek.com → reply → Discord
```

## Setup (about 10 minutes)

1. **Discord bot** (free): https://discord.com/developers/applications → New Application → Bot.
   - Reset Token and copy it.
   - Turn on **Message Content Intent**.
   - OAuth2 → URL Generator → scope `bot`, permissions: View Channels, Send Messages, Attach Files, Read Message History → open the URL to add it to a server you own.
   - To DM it instead, share a server with it and message it directly.
2. **Your user ID**: Discord → Settings → Advanced → Developer Mode on, then right-click yourself → Copy User ID.
3. Install and configure:
   ```
   npm install
   cp .env.example .env      # then fill in DISCORD_TOKEN and ALLOWED_USER_IDS
   ```
   Uses your installed Chrome by default. If you don't have Chrome, set `BROWSER_CHANNEL=` (blank) in `.env` and run `npx playwright install chromium`.
4. **Log in once**: `npm run login`, sign in to DeepSeek in the window that opens, then close it.
5. **Run**: `npm start`. Keep this computer on; the bot only works while it runs.

## Using it

- DM the bot, or @mention it in a server channel. If you set `CHANNEL_ID`, every message you send in that channel is answered.
- `!new` starts a fresh DeepSeek chat. The bot also does this automatically every `AUTO_NEW_EVERY` messages.
- `!shot` sends a screenshot of the browser page. Use it when something looks stuck.
- Messages are handled one at a time (one browser page).

## Things to know

- **Only IDs in `ALLOWED_USER_IDS` are served.** Without that, anyone who can message the bot could use your DeepSeek account. The bot refuses to start with an empty list.
- **Selectors will break eventually.** DeepSeek changes its page often. If the bot says it can't find the input or no reply appeared, adjust `INPUT_SELECTOR` / `REPLY_SELECTOR` in `.env` (inspect the page in DevTools). `!shot` helps.
- **Turn DeepThink off** in the DeepSeek window for bot use. Long reasoning pauses can look like "finished" to the stability check; raise `STABLE_MS` if you keep it on.
- **Replies are detected by "text stopped changing for `STABLE_MS`"**, so each reply has about that much extra delay.
- Automating the web UI is a gray area under most sites' terms of use, and the free tier has its own rate limits. Use it for personal use, not as a public service.
- Headless mode (`HEADLESS=true`) is more likely to trigger bot checks. Start with the visible window.


bot url: bot1567900155334762536
zeroichi. user id: 1020964568857583618