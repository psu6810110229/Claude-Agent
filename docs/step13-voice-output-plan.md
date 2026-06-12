# Step 13 — Voice Output (TTS): JARVIS speaks — detailed implementation plan

> Companion to the **Step 13 scope** section in `CLAUDE.md`. This doc is the gap-reduction blueprint: file-by-file, signatures, edge cases, gating, tests. Read both before implementing any phase.

## 0. Principles (carry over from existing architecture)

- **Gated off by default; fail-soft to text.** Every TTS path returns "no audio" silently on disabled / offline / error. Existing text behavior is never broken.
- **Backend owns the boundary.** Synthesis + playback live in backend services. Dashboard only fetches/plays.
- **Deterministic where it matters.** Scheduler + approval-nag spoken lines are **templated, no Claude** (preserves Step 11's no-Claude rule). Only chat replies (already Claude-generated text) are spoken.
- **Injectable everything.** `TtsSynthesizer` and `AudioPlayer` are interfaces with `Stub*` implementations; the real Edge endpoint and real audio are **never** touched in smoke tests.
- **Local-first tradeoff accepted.** Edge endpoint is cloud; outbound to Microsoft only; no API key, no secrets logged.
- **No new SQLite table.** 13.1–13.4 add none. Nag state is in-memory (resets on restart — accepted).
- Bind stays `127.0.0.1`. No new auth. No voice input.

## 1. Validated source (from POC, committed `c358e40`)

`experiments/jarvis-tts-poc/` proved the stack. Reuse exactly:
- Voice short name: **`en-AU-WilliamMultilingualNeural`**.
- Output format: `OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3`.
- Preset `warm` (default): prosody `{ pitch:"-8%", rate:"-6%", volume:"+0%" }`; FX `highpass=f=70, equalizer=f=120:width_type=o:width=1.5:g=4, equalizer=f=300:width_type=o:width=1:g=2, equalizer=f=5500:width_type=o:width=1.5:g=-3, acompressor=threshold=-18dB:ratio=3:attack=15:release=200, aecho=0.85:0.82:55:0.18, loudnorm=I=-16:TP=-1.5:LRA=11`.
- Preset `intimate`: prosody `{ pitch:"-10%", rate:"-6%" }`; FX as v5 (lowBoost g=5, tameHigh g=-2, `acompressor=threshold=-20dB:ratio=4:attack=8:release=150`, `aecho=0.9:0.75:25:0.06`, loudnorm).
- Empty-stream retry: Edge occasionally returns 0 bytes → retry synth up to 4× (`ttsToBuffer` pattern).

## 2. New dependencies (backend)

Add to `packages/backend/package.json` dependencies:
- `msedge-tts@^2.0.5` — free Edge neural endpoint (no key).
- `ffmpeg-static@^5.3.0` — bundles an ffmpeg binary (~80 MB in node_modules; no system install). Both already pinned/verified in the POC.

`npm install` after. No other deps.

---

## Phase 13.1 — core TTS service + `POST /api/tts` + browser playback

### New: `packages/backend/src/services/tts.ts`

```ts
export type TtsPreset = "warm" | "intimate";

export interface TtsSynthesizer {
  /** Returns a WAV buffer, or null when disabled/unavailable (fail-soft). Never throws. */
  synthesize(text: string, preset?: TtsPreset): Promise<Buffer | null>;
}

export class StubTtsSynthesizer implements TtsSynthesizer {
  readonly calls: Array<{ text: string; preset: TtsPreset }> = [];
  constructor(private readonly out: Buffer | null = Buffer.from("RIFFstubWAVE")) {}
  async synthesize(text, preset = DEFAULT_PRESET) { this.calls.push({ text, preset }); return this.out; }
}

export const realTtsSynthesizer: TtsSynthesizer; // RealTtsSynthesizer instance
```

`RealTtsSynthesizer.synthesize`:
1. If `!CLAUDE_AGENT_TTS_ENABLED` → return `null`.
2. Resolve preset (arg ?? `CLAUDE_AGENT_TTS_PRESET` ?? `warm`); look up prosody + FX from a `PRESETS` table.
3. Synth: `msedge-tts` → mp3 `Buffer` (retry ≤4× on <1000 bytes). Voice + format from §1.
4. FX: write mp3 → unique temp file in `os.tmpdir()`; spawn `ffmpeg-static` (`-y -i <mp3> -af <fx> -ar 24000 -ac 1 <wav>`), no shell; read wav → `Buffer`.
5. `finally`: unlink both temp files (best-effort).
6. Any error → `logActivity("tts.synth_failed", msg)` and return `null`. **Never throw.**
7. Optional (mark OPTIONAL, can defer): tiny LRU cache keyed `preset|text` to skip re-synth of identical lines (nag repeats, common replies).

Constants (in `tts.ts`, not `config.ts`): `VOICE = "en-AU-WilliamMultilingualNeural"`, `PRESETS` map, `DEFAULT_PRESET`.

### New: `packages/backend/src/schemas/tts.ts`

```ts
export const ttsPresetSchema = z.enum(["warm", "intimate"]);
export const ttsRequestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  preset: ttsPresetSchema.optional(),
});
```

### New: `packages/backend/src/routes/tts.ts`

- `export interface TtsRouteOptions { synthesizer?: TtsSynthesizer }` (default `realTtsSynthesizer`).
- `POST /api/tts`:
  - bad body → 400.
  - `const wav = await synth.synthesize(text, preset)`.
  - `wav === null` → **204 No Content** (client falls back to silence; text already shown).
  - else → `reply.header("content-type","audio/wav").send(wav)`.
  - Activity: `tts.served` (byte length) on success; `tts.unavailable` on null. Keep terse (no text dumps).

### Edit: `packages/backend/src/server.ts`

- `BuildServerOptions` gains `ttsSynthesizer?: TtsSynthesizer`.
- `app.register(ttsRoutes, { synthesizer: options.ttsSynthesizer });`

### Edit: `packages/backend/src/config.ts`

Append (all off/defaulted):
```ts
export const TTS_ENABLED = /^(1|true)$/i.test(process.env.CLAUDE_AGENT_TTS_ENABLED ?? "");
export const TTS_PRESET = (process.env.CLAUDE_AGENT_TTS_PRESET ?? "warm"); // validated to TtsPreset in tts.ts
```

### Dashboard 13.1

- `packages/dashboard/src/lib/api.ts`: add
  ```ts
  export async function speak(text: string, preset?: string): Promise<void>;
  // POST /api/tts; 204 -> no-op; 200 -> play blob via a shared HTMLAudioElement.
  ```
  Single module-level `Audio` element; revoke previous object URL; stop previous before playing new.
- `packages/dashboard/src/app/page.tsx`: after a successful assistant reply in `handleSend`, if not muted call `speak(reply)`. **Do not** block the UI on it (fire-and-forget). Do not speak user messages.
- **Mute toggle**: button in the chat header/composer; state persisted in `localStorage('jarvis.muted')`; default unmuted. When muted, skip `speak`.
- Proxy: `/api/tts` should pass through the existing Next `rewrites()`. **Contingency** (only if a timeout/stream issue appears): add `app/api/tts/route.ts` mirroring `app/api/chat/route.ts` (explicit handler, `runtime nodejs`, forward binary). Note in PR if added.

### 13.1 fail-soft matrix

| Condition | Result |
|---|---|
| `TTS_ENABLED` off | 204 → browser shows text only |
| Edge offline / error | synth returns null → 204 |
| muted | browser never calls `/api/tts` |
| 200 + audio | browser plays; text still shown |

---

## Phase 13.2 — backend speaker + scheduler speaks due reminders/events

### New: `packages/backend/src/services/audioPlayer.ts`

```ts
export interface AudioPlayer { play(wavPath: string): void } // fire-and-forget; serialized internally
export class StubAudioPlayer implements AudioPlayer { readonly calls: string[] = []; play(p){ this.calls.push(p) } }
export const realAudioPlayer: AudioPlayer; // RealAudioPlayer
```

`RealAudioPlayer`:
- Gated `CLAUDE_AGENT_TTS_SPEAKER_ENABLED`; off → no-op.
- Plays via PowerShell: `(New-Object System.Media.SoundPlayer '<path>').PlaySync()` — spawn `powershell.exe -NonInteractive -WindowStyle Hidden -Command ...`, `windowsHide:true`, timeout ~30 s, no shell-string interpolation of untrusted data (path is backend-generated temp file; still strip `'`).
- **Serialize**: internal promise-chain / queue so concurrent `play()` calls don't overlap audio (wait for previous child `close` before next spawn).
- Fail-soft: spawn error → `logActivity("tts.play_failed", msg)`, swallow.
- Mirrors `desktopNotifier.ts` structure exactly (familiar pattern).

### New: `packages/backend/src/services/voiceLines.ts` (pure, deterministic, Thai JARVIS tone)

```ts
export function reminderDueLine(title: string): string;      // "ครับผม ถึงเวลา <title> แล้วครับ"
export function eventSoonLine(title: string, location?: string): string; // "<title> กำลังจะเริ่มแล้วครับ[ ที่ <location>]"
export function approvalNagLine(count: number): string;      // "ครับผม มีงานรออนุมัติ <count> รายการ ค้างอยู่ครับ รบกวนตรวจสอบด้วยครับ"
```
No Claude. Unit-testable. Keep ≤ ~120 chars.

### Edit: `packages/backend/src/services/scheduler.ts`

- Introduce an optional voice bundle so existing callers/tests are unaffected:
  ```ts
  export interface SchedulerVoice { synthesizer: TtsSynthesizer; player: AudioPlayer }
  export function runSchedulerTick(now: Date, notifier: DesktopNotifier, voice?: SchedulerVoice, nag?: NagState): void
  ```
- On a **net-new** `reminder.due` insert (the existing `if (inserted)` block): if `voice` present and `TTS_ENABLED && TTS_SPEAKER_ENABLED`, synth `reminderDueLine(title)` → write temp wav → `player.play(path)`. Same for `event.soon` → `eventSoonLine`.
- Synthesis here is async but the tick is sync; spawn the synth+play without awaiting (fire-and-forget) **or** make a small async helper invoked with `void speakLine(...)`. Errors swallowed inside helper. Notification insert/log must remain regardless of voice outcome.
- Speaking is tied to **net-new** inserts → DB UNIQUE dedup already prevents repeat speech for the same reminder/event.

### Edit: `packages/backend/src/index.ts`

- Build `realAudioPlayer` + `realTtsSynthesizer`; pass as `voice` into `startScheduler`.
- `startScheduler(notifier, voice?, nag?)` forwards to ticks.

---

## Phase 13.3 — proactive approval nag (repeats until actioned)

### Edit: `packages/backend/src/db/repositories/approvalRepo.ts`

```ts
export function listPendingApprovals(): Approval[]; // WHERE status='pending' ORDER BY id ASC
```

### Scheduler nag state (in-memory, injectable for deterministic tests)

```ts
export interface NagState { lastNagAtMs: Map<number, number> } // approvalId -> last spoken epoch ms
export function createNagState(): NagState;
```
Created once in `startScheduler`, passed into each `runSchedulerTick`.

### Nag logic in `runSchedulerTick`

Config: `CLAUDE_AGENT_TTS_APPROVAL_NAG_DELAY_MS` (default 120000), `CLAUDE_AGENT_TTS_APPROVAL_NAG_INTERVAL_MS` (default 120000).

```
pending = listPendingApprovals()
due = pending.filter(a => now - Date.parse(a.created_at) >= NAG_DELAY_MS)
if due.length > 0 and (no entry, or now - lastNagAt(any/global) >= NAG_INTERVAL_MS):
    speak approvalNagLine(due.length); record now for those ids
cleanup: drop lastNagAtMs entries whose id is no longer pending
```
- Decision: nag is **aggregate** ("X รายการค้างอยู่"), throttled by a single global last-spoken timestamp keyed off the pending set, repeating every `NAG_INTERVAL_MS` while any qualifies. (Simplest; avoids per-id audio spam.) Store global timestamp under a reserved key (e.g. `lastNagAtMs.get(0)`), plus track per-id presence for cleanup.
- Gated `TTS_ENABLED && TTS_SPEAKER_ENABLED`. No Claude. No DB write. `logActivity("tts.approval_nag", "count=<n>")` for observability.
- Restart resets state → first qualifying tick re-nags. Accepted.

### Config additions (`config.ts`)

```ts
export const TTS_SPEAKER_ENABLED = /^(1|true)$/i.test(process.env.CLAUDE_AGENT_TTS_SPEAKER_ENABLED ?? "");
export const TTS_APPROVAL_NAG_DELAY_MS = Number(process.env.CLAUDE_AGENT_TTS_APPROVAL_NAG_DELAY_MS ?? 120_000);
export const TTS_APPROVAL_NAG_INTERVAL_MS = Number(process.env.CLAUDE_AGENT_TTS_APPROVAL_NAG_INTERVAL_MS ?? 120_000);
```

---

## Phase 13.4 — daily brief spoken (lowest priority)

- Dashboard: when a brief result renders, `speak(briefText)` (respect mute). Reuses 13.1 path; no backend change beyond what exists.
- Optional backend-speaker reading of the brief is **deferred** unless requested.

---

## 3. Tests — `scripts/step13-smoke-test.ts` (+ `smoke:step13` in both package.json)

Pattern mirrors `step11-smoke-test.ts`: set env BEFORE imports, temp DB/memory, inject stubs, drive `runSchedulerTick` directly.

Assertions:
1. **Route disabled fail-soft**: build server with **no** synthesizer + `TTS_ENABLED` off → `POST /api/tts {text}` → **204**, empty body.
2. **Route enabled**: build server with injected `StubTtsSynthesizer(Buffer)` → `POST /api/tts` → **200**, `content-type: audio/wav`, body == stub bytes.
3. **Bad body** → 400.
4. **voiceLines** unit: `reminderDueLine` / `eventSoonLine` / `approvalNagLine` produce expected Thai strings (substring checks).
5. **Scheduler speaks due item**: seed overdue reminder; tick with `StubTtsSynthesizer` + `StubAudioPlayer` (+ simulate enabled flags via test-only injection, not real env playback) → `player.calls.length === 1`. Second tick → no new (dedup).
6. **Nag timing**: seed `approval` (status pending) with `created_at` older than `NAG_DELAY_MS`; `NagState` fresh; tick at `t0` → nag spoken once. Tick at `t0 + interval/2` → not spoken. Tick at `t0 + interval` → spoken again.
7. **Nag stops**: flip approval to `approved` → tick → not spoken; `lastNagAtMs` entry cleaned.
8. **No Claude, no approvals created** by scheduler; **real Edge + real audio never used** (only stubs).

Note: because real-flag gating (`TTS_ENABLED`/`TTS_SPEAKER_ENABLED`) guards the real synth/player, the smoke must exercise the **speak path via injected stubs**, not via env flags. Design `runSchedulerTick` to call `voice.synthesizer/player` whenever `voice` is provided, and let the **real wiring in index.ts** be what checks the env flags (so tests don't depend on env). Document this split clearly in code comments.

Plus existing: `npm run build`, `npm run smoke` (still **8** tables — no new table), `npm run build:dashboard`.

## 4. Security / safety review

- **PowerShell**: only backend-generated temp-file paths reach SoundPlayer; still strip `'`. SSML text goes to `msedge-tts` (WebSocket), not a shell.
- **Temp files**: unique names under `os.tmpdir()`, never under repo; unlinked in `finally`.
- **Process spawn**: `ffmpeg-static` path + `powershell.exe` via `execFile`/`spawn` (no shell string). No `ANTHROPIC_API_KEY` involved (no Claude here).
- **Network**: outbound to Microsoft Edge TTS endpoint only; no inbound exposure change; no secrets/tokens logged.
- **Fail-soft everywhere**: disabled/offline/error → silence + text. No path throws to the user.

## 5. Sequencing & rollback

- Ship **per phase**, each independently flag-gated **off**. 13.1 is shippable and useful alone (chat replies speak in-browser).
- Rollback = unset env flag (runtime) or revert the phase's files (no schema migration to undo).
- Suggested order: 13.1 → 13.2 → 13.3 → 13.4. Get user sign-off on 13.1 audio quality in-app before 13.2 headless speaker.

## 6. Open items to confirm before coding 13.x

- 13.1 only needs the two new deps + the new files above — **lowest risk; recommend building first**.
- Confirm nag should be **aggregate** ("X รายการ") vs **per-approval** (could be noisy). Plan assumes aggregate.
- Confirm acceptable that headless speaker (13.2/13.3) plays even with no dashboard open (this is the JARVIS behavior requested).
