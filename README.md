# Fast Reader

Speed-read any text one word at a time. Words flash in the center of the screen with their middle letter(s) bolded, so your eyes never move.


## Features
- Paste text of any length, or pull an article's text from a link
- Middle letter (odd-length words) or two middle letters (even-length) bolded and locked at center
- Speed from 60 to 1,500 wpm, 1–3 words at a time, optional pauses on punctuation
- Custom colors plus Night, Paper, Sepia, Terminal, and Ocean themes
- Play/pause, ±10 words, ±sentence, restart, scrubber, tap any word to jump, find
- Video-style time bar: elapsed / total, time left, percent, words to go
- Read aloud with the browser's built-in voices, synced word by word
- Remembers your settings and where you stopped

## Run it
It's a single static file. Use it on GitHub Pages at https://ivantools.github.io/fast-reader/, open `index.html` in a browser, or host it anywhere that serves static files.

Pulling text from a link needs a small server endpoint at `/api/fetch?url=…` that fetches the page and returns its HTML (browsers block cross-site fetches). Where there isn't one, the link box is hidden and pasting works as normal.

## Keyboard
Space play/pause · ←/→ 10 words · Shift+←/→ sentence · ↑/↓ speed · Home restart
