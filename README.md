# Fast Reader

Speed-read any text one word at a time. Words flash in the center of the screen with their middle letter(s) bolded, so your eyes never move.

Live: https://fast-reader-brm.pages.dev

## Features
- Paste text of any length, or pull an article's text from a link
- Middle letter (odd-length words) or two middle letters (even-length) bolded and locked at center
- Speed from 60 to 1,500 wpm, 1–3 words at a time, optional pauses on punctuation
- Custom colors plus Night, Paper, Sepia, Terminal, and Ocean themes
- Play/pause, ±10 words, ±sentence, restart, scrubber, tap any word to jump, find
- Video-style time bar: elapsed / total, time left, percent, words to go
- Read aloud with the browser's built-in voices, synced word by word
- Remembers your settings and where you stopped

## Structure
- `fast-reader/index.html` — the whole app (HTML, CSS, JS in one file)
- `worker.template.js` — Cloudflare Pages `_worker.js`: serves the app and `/api/fetch?url=` for link import
- `deploy.sh` — builds `_worker.js` and deploys via the Cloudflare Pages API

## Deploy
```bash
export CLOUDFLARE_ACCOUNT_ID=...   # your account id
export CLOUDFLARE_API_TOKEN=...    # token with Cloudflare Pages: Edit
./deploy.sh
```

## Keyboard
Space play/pause · ←/→ 10 words · Shift+←/→ sentence · ↑/↓ speed · Home restart
