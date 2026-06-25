# Schedule Import (file/image → local timetable)

Upload a class timetable (image or PDF) in chat → Friday reads it → you review a
visual grid/timeline → approve into a **local** weekly timetable that Friday
cross-references against Google Calendar to answer "วันนี้เรียนอะไร + หาเวลาว่างไป
ปั่นจักรยาน".

## Core decision: LOCAL, not Google Calendar

A timetable is **not** written to Google Calendar. It lives in the local
`class_block` table as weekly recurring blocks. This was a deliberate reframe
(the user does not want classes cluttering their real calendar) and it made the
feature *simpler*, because the codebase already models weekly classes as
`recurring_block` ScheduleConstraints:

```
class_block row ──> classBlockConstraints ──> ScheduleConstraint(recurring_block)
                                              └─> resolveScheduleConstraints()
                                                   ├─ availabilityResolver (clash detection)
                                                   ├─ scheduleVerifier (claim guardrails)
                                                   └─ freeSlotFinder (open gaps)  ← new
```

So classes flow into the EXISTING availability engine with no Google write, no
RRULE, no expanding a term into hundreds of dated events.

## Architecture (3 sprints)

1. **Scheduling core** (backend): `class_block` table + repo, constraint bridge,
   term active-range filter on `materializeConstraints`, and `freeSlotFinder`
   (the read-side complement to clash detection — inverts all busy intervals over
   waking hours). `resolveScheduleConstraints()` now unions class blocks + facts.
2. **Upload + extraction**: `uploads` route (multipart, magic-byte allowlist,
   UUID storage, TTL purge), hybrid `fileExtractor` (PDF text-layer local /
   image+scanned-PDF → Gemini vision), `scheduleExtractor` (strict JSON +
   deterministic weekday/time normalization), `schedule_import` staging +
   `approveImport` → `class_block`.
3. **Dashboard**: composer attach + drag-drop, adaptive grid/timeline review
   card, `/schedule` management page, free-slot strip.

## Security boundaries

- Uploads validated by **magic bytes**, not client MIME. Size-capped (10 MB).
  Stored under a server UUID (never the original filename); traversal-guarded.
- Uploaded files are gitignored (`data/uploads/`), consumed on import, TTL-purged.
- Logs carry counts/ids/timestamps only — never file bytes, filenames, or
  extracted schedule text.
- Outbound: only image/scanned-PDF bytes go to Gemini (same trust boundary as
  existing Gemini chat). Text-PDF is parsed fully locally.
- Only mutation is the local `class_block` write on approve (reversible archive).
  No new Google/Gmail write surface.

## Edge cases handled

Scanned vs text PDF (auto-detect empty text layer → vision) · unreadable field →
left null, review card forces a fix before approve (no silent guessing) ·
out-of-term class → inactive (term active-range filter) · duplicate class →
dedup on (subject, weekday, start) · all-day Google event ignored by free-slot
finder · overnight/multi-window already handled by `materializeConstraints` ·
Gemini disabled → image path fails closed with a clear message, text-PDF still
works · coexists with hand-entered class facts (union; dedup covers the overlap).

## Gotcha worth remembering: pdf-parse under ESM/tsx

`import pdf from "pdf-parse"` runs the package's index debug routine (it reads a
bundled sample PDF when it thinks it is the main module), which throws under
ESM/tsx. Import the inner module via a **non-literal** specifier so it both skips
the debug harness and avoids TS demanding types for the untyped subpath:

```ts
const modName = "pdf-parse/lib/pdf-parse.js";
const mod = (await import(modName)) as ...;
```

## Type gotcha: `selected` is number in the row, boolean in a patch

`ScheduleImportItem.selected` is `0|1` (SQLite). The review card's edit patch
uses a `boolean`. Do NOT intersect `Partial<ScheduleImportItem>` with
`{ selected?: boolean }` (gives `never`); use a dedicated `ItemPatch` type.

## Deferred (not in this delivery)

- **General file Q&A** (ask arbitrary questions about any uploaded file in the
  normal chat turn) was scoped but deferred: it needs multimodal plumbing into
  the chat invoker, which is a separate, larger change than the timetable import
  that was the user's actual need. Non-timetable uploads currently get an honest
  "couldn't read a timetable" message rather than a fake answer.

## Gotcha: local `.env` leaks into smoke tests

`config.ts` loads the repo-root `.env` and `packages/backend/.env` for any var the
test did not set first (real `process.env` wins, but unset vars fall through to
the file). The operator's real `.env` has `PRIVACY_GUARD_ENABLED=1` and
`AUTO_EXECUTE_ENABLED=1`. Smokes that do NOT explicitly neutralize these (e.g.
`smoke:phase3`, `smoke:phase4`, `smoke:step12`) can therefore FALSE-FAIL on a
machine that has a real `.env`: the privacy guard makes the unverified test
requester get no dispatch (0 approvals), or auto-execute flips a "pending"
assertion. The same suites pass in a fresh git worktree (no `.env` present) and
pass locally when run with the flags forced off:

```
CLAUDE_AGENT_PRIVACY_GUARD_ENABLED=0 CLAUDE_AGENT_AUTO_EXECUTE_ENABLED=0 npm run smoke:phase3
```

This is environmental, not a code defect. The schedule-import smokes are immune
because they call the repos/services directly and never traverse the guard path.

## Key files

Backend: `db/schema.sql`, `schemas/classBlock.ts`, `schemas/scheduleImport.ts`,
`db/repositories/classBlockRepo.ts`, `db/repositories/scheduleImportRepo.ts`,
`services/{classBlockConstraints,freeSlotFinder,fileExtractor,scheduleExtractor,
uploadStore,scheduleImportService}.ts`, `routes/{classBlocks,uploads,
scheduleImports}.ts`.
Dashboard: `components/ScheduleImportCard.tsx`, `app/schedule/page.tsx`,
`components/JarvisInput.tsx` (attach), `app/page.tsx` (wiring).
Tests: `scripts/smoke-schedule-import.ts`, `scripts/smoke-schedule-extract.ts`.
