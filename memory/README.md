# Memory

Durable, human-readable project/user context for Claude_Agent. The backend owns
access control; these files are the system of record for memory.

## Files (fixed whitelist)

| Target        | File             | Purpose                                  |
| ------------- | ---------------- | ---------------------------------------- |
| `preferences` | `preferences.md` | How the user likes things done           |
| `routines`    | `routines.md`    | Recurring habits / schedules             |
| `projects`    | `projects.md`    | Ongoing projects and their status        |
| `decisions`   | `decisions.md`   | Notable decisions and their rationale    |

These four targets are the only writable/readable memory files. There are no
arbitrary paths.

## Safety

- Memory is **never written directly**. Every change goes through the approval
  queue as a `memory.write` action and is applied only after approval.
- Writes are confined to this directory and the whitelist above.
- `*.md` files here are **gitignored** (personal content). Only this `README.md`
  is tracked. `npm run db:init` seeds the four files locally with a header if
  they are missing.

## Targets and modes

- Modes: `append` (add to the end) or `replace` (overwrite).
- Content is capped at 50,000 characters per write.
