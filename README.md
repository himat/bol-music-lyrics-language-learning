# Bol

Bol is a macOS desktop app for learning natural, everyday language from songs playing in Spotify.

## What works

- Reads the current song and live playback position from the Spotify desktop app (no Spotify developer account needed).
- Controls Spotify playback, including repeat off, repeat playlist/album, and repeat-one while Bol is open.
- Fetches synchronized lyrics from LRCLIB and follows the playing line.
- Shows line-by-line English translations and word-level romanization/meaning hovers.
- Clicks any synchronized lyric to play Spotify from that timestamp, including when paused.
- Uses OpenAI Structured Outputs to label phrases as common, casual, formal, poetic, uncommon, or unclear and suggests a daily-speech alternative.
- Caches completed song analysis on the Mac, keyed by track, lyrics, target language, model, and analysis version, so repeat songs do not make another LLM call.

## Download the Mac app

Download `Bol - musical language learning.app.zip` from [GitHub Releases](https://github.com/himat/bol-music-lyrics-language-learning/releases/latest), unzip it, and drag **Bol - musical language learning** into Applications.

The current personal build is not Apple-notarized. On first launch, macOS may require right-clicking the app in Applications and choosing **Open**.

## Run it

1. Install dependencies: `npm install`
2. Launch: `npm start`
3. Open Settings in Bol and add an OpenAI API key. The key is encrypted with Electron's macOS safe storage.
4. Start playing a song in the Spotify desktop app. On first use, macOS may ask permission for Bol to communicate with Spotify.

Build the app with `npm run build`. The result is written under `dist/` on Apple Silicon; archive the `.app` bundle before sharing it.

## Notes

Spotify is used as the timing source rather than recording system audio. This is more accurate, works while muted, and avoids Screen Recording permission. Lyrics availability depends on LRCLIB. Bol does not scrape Spotify lyrics.

OpenAI calls are made only when a song analysis is not already cached for the current track, lyrics, target language, model, and analysis version. The app sends the retrieved lyric lines, song title, and artist; it requests no API-side storage.
