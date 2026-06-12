# JARVIS TTS POC

**Out-of-scope experiment** (user-approved). NOT wired into the backend. Voice is listed under "Out of scope" in `CLAUDE.md`; this folder only proves out a voice under the constraints: **no GPU, free, Thai + English**.

## Constraints → chosen stack

| Constraint | Decision |
|---|---|
| No GPU | Cloud neural TTS (Microsoft Edge), no local model. Voice cloning (F5/XTTS/GPT-SoVITS) ruled out — needs GPU. |
| Free | `msedge-tts` uses Microsoft Edge's neural endpoint. No API key, no card. |
| Thai + English (ทับศัพท์) | **Multilingual** voices speak both in one consistent character. Native Thai `Niwat` included as baseline. |
| No Python / no system ffmpeg | Node-only: `msedge-tts` + bundled `ffmpeg-static` binary. |

## Pipeline

```
text → msedge-tts (neural, SSML pitch -8% / rate -6%) → ffmpeg FX → wav
```

FX chain = JARVIS character without cloning: high-pass, low-end warmth boost, tamed highs, compressor (steady level), subtle room reverb, loudness normalize.

## Voices generated

| id | voice | character |
|---|---|---|
| `niwat` | th-TH-NiwatNeural | Native Thai male. English loanwords read Thai-accented (matches ทับศัพท์). |
| `andrew` | en-US-AndrewMultilingualNeural | Deep, warm, calm — closest to JARVIS timbre. Speaks Thai + English. |
| `brian` | en-US-BrianMultilingualNeural | Casual US male. |
| `william` | en-AU-WilliamMultilingualNeural | Australian male. |

No British multilingual male exists on the Edge endpoint, so Andrew is the closest JARVIS-accent option.

## Run

```
npm install
npm run voices   # list available Thai + multilingual voices
npm run gen      # generate out/<id>_raw.mp3 (dry) and out/<id>_jarvis.wav (FX)
```

Play files in `out/`. Compare `*_raw.mp3` (dry neural) vs `*_jarvis.wav` (with FX).

## Tuning

- Character: edit `PROSODY` (pitch/rate) and `FX` in `src/generate.mjs`.
- Pronunciation control for loanwords: transliterate to Thai script before TTS (e.g. `schedule → สเกจูล`). Not yet applied — add a normalize map if specific words come out wrong.

## Known issues

- Edge websocket occasionally returns an empty stream → `ttsToBuffer` retries up to 4×.
- Endpoint is unofficial; if it breaks, move to Azure TTS free tier (same voices, official, needs signup + card).
