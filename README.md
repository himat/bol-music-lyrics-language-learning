# Bol

Bol is a macOS desktop app for learning natural, everyday language from songs playing in Spotify.

## What works

- Reads the current song and live playback position from the Spotify desktop app (no Spotify developer account needed).
- Fetches synchronized lyrics from LRCLIB and follows the playing line.
- Shows a line-by-line English translation; hovering either side highlights its match.
- Uses OpenAI Structured Outputs to label phrases as common, casual, formal, poetic, uncommon, or unclear and suggests a daily-speech alternative.

## Run it

1. Install dependencies: `npm install`
2. Launch: `npm start`
3. Open Settings in Bol and add an OpenAI API key. The key is encrypted with Electron's macOS safe storage.
4. Start playing a song in the Spotify desktop app. On first use, macOS may ask permission for Bol to communicate with Spotify.

Build an unpacked app with `npm run build`. The result is written to `dist/mac-arm64/Bol.app` on Apple Silicon.

## Notes

Spotify is used as the timing source rather than recording system audio. This is more accurate, works while muted, and avoids Screen Recording permission. Lyrics availability depends on LRCLIB. Bol does not scrape Spotify lyrics.

OpenAI calls are made only when a new song needs analysis. The app sends the retrieved lyric lines, song title, and artist; it requests no API-side storage.
