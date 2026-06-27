# Dashboard UI Audit & Remediation Plan

Status: Draft v1 — audit complete, plan proposed, **no code changed yet**.
Scope: `packages/dashboard` (Next.js 15 App Router + React 19, plain CSS + design tokens).
Goal: kill the "AI-slop / non-production" feel — fix buttons, sizing, layout, placement,
component-fit-to-purpose, use-flow, and mobile responsiveness — **without** switching framework
(no Vite) and **without** abandoning the Liquid Glass design system (no Tailwind/shadcn rewrite).

---

## 1. Verdict

The problem is **not** the CSS tooling. It is the **absence of a component/token discipline**:

- Colors are tokenized (good baseline). **Type, spacing, sizing, and responsive are not.**
- There is **no shared component layer** — every page hand-rolls its own buttons, inputs, modals.
- AI-generated page-by-page → each surface invents its own magic numbers → no consistency = "slop".

Fix = build the missing **token scales** + a small **primitive layer**, then refactor surfaces onto them.
Tailwind/Vite do nothing for this. They would only add a rewrite cost on top.

---

## 2. Evidence (quantitative, from repo scan)

| Signal | Found | Should be | Severity |
|---|---|---|---|
| Shared `<Button>` primitive | 0 — **82 raw `<button>` across 22 files** | 1 primitive, variants | 🔴 |
| Type scale tokens | **0** (`font-size: var()` = 0) — **109 hardcoded px font-sizes** | all via token | 🔴 |
| Spacing scale tokens (`--space-*`) | **0** — **364 hardcoded padding/margin/gap px** | 4/8-based scale | 🔴 |
| Touch target `min-height:44px` | **0 occurrences** | every interactive control | 🔴 (WCAG 2.1 AA) |
| Interactive heights | 28/30/32/34/38/40/44px mixed | one control-height scale | 🔴 |
| Responsive breakpoints | 5 `@media` total, 3 ad-hoc values (560/680/980) for 14 routes | one breakpoint system | 🔴 (mobile) |
| Modal / container `max-width` | 9 different values (260→980) | size scale | 🟠 |
| Inline `style={{…}}` | drive **38**, settings **12**, gmail **8**, WeekHourGrid/approvals 7 | ~0 (→ class/token) | 🟠 |
| Per-feature button classes | `si-btn`, `si-btn-ghost`, `si-editor-close`… reinvented per component | shared variants | 🟠 |
| Color tokens / `var()` usage | 557 uses — tokenized | — | 🟢 baseline good |
| Motion tokens (ease/spring), z-index, safe-top | present | — | 🟢 good |

**Worst surfaces (slop concentration):** `drive/page.tsx` (8 btn + 38 inline), `settings/page.tsx`
(12 inline), `gmail/page.tsx` (8 inline), `schedule/page.tsx` + `WeekHourGrid.tsx` (grid + modal,
mobile-hostile), `ScheduleImportCard.tsx` (10 buttons, own class system), dashboard `page.tsx` (6 btn).

---

## 3. Tokens: have vs missing

**Have** (`globals.css :root`): `--accent*`, status hues (`--amber/rose/ok/blue/violet*`),
`--bg*`, `--surface*`, `--glass*`, `--border*`, `--text/muted*`, `--radius` + `--radius-lg`,
`--shadow*`, motion (`--ease-*`, `--spring*`), full `--z-*` stack, `--safe-top`.

**Missing (root cause of slop):**
- **Type scale** — font-size / line-height / font-weight tokens (xs → 2xl).
- **Spacing scale** — `--space-1…N` (4/8 base). 364 magic px today.
- **Size scale** — control heights (`--control-sm/md/lg`), modal/sheet widths, container max-widths.
- **Radius scale** — only 2 values; 999px pill repeated ~20× inline → add `--radius-pill`, `--radius-sm`.
- **Breakpoint tokens** — single source for sm/md/lg; today 3 ad-hoc values.

---

## 4. Full audit inventory (everything to check)

### 4.1 Primitives to create / consolidate
- [ ] `Button` — variant: primary / secondary / ghost / danger / link; size: sm / md / lg; states: hover / focus-visible / disabled / loading; icon-leading/trailing.
- [ ] `IconButton` — square, min 44×44 touch, aria-label required.
- [ ] `Input` / `Textarea` / `Select` — consistent height, focus ring, error state.
- [ ] `Card` / `Panel` — glass layer tiers (surface / surface-strong).
- [ ] `Modal` / `Dialog` / `Sheet` — size scale; mobile = full-height sheet; focus trap; Esc/backdrop close; scroll lock.
- [ ] Layout primitives — `Stack` (vertical rhythm), `Cluster` (horizontal wrap), `Grid`, `Container` (max-width).
- [ ] `Badge` / `Chip`, `Toast` (exists — normalize), `Tooltip`, `Separator`.

### 4.2 Token scales to add
- [ ] Type, Spacing, Size (control + width), Radius, Breakpoint (see §3).

### 4.3 Per-surface review — 6 dimensions each
For every route + heavy component check: **(a) button correctness** (right variant for intent,
primary/secondary/destructive hierarchy), **(b) sizing** (control height, font, hit area),
**(c) layout & placement** (alignment, rhythm, grouping), **(d) component-fit** (right control type
for the job — e.g. toggle vs button vs select), **(e) use-flow** (action order, primary action
discoverability, confirm placement), **(f) mobile** at 360 / 768 / 1024.

Surfaces: `page.tsx` (dashboard), `chat`, `schedule`, `upcoming`, `tasks`, `projects`, `approvals`,
`memory`, `gmail`, `drive`, `files`, `activity`, `notepad`, `settings` + components: `Shell`, `Sidebar*`,
`TopBar`, `CommandBar`, `JarvisInput`, `Orb`, `WeekHourGrid`, `Agenda`, `WelcomeAgenda`, `BriefPanel`,
`NotificationCenter`, `ScheduleImportCard`, `CalendarPlanCard`, `ScheduleFixProposals`,
`ScheduleHealth`, `SchedulePrefsPanel`, `DayAgendaCard`, `States`, `ToastProvider`.

### 4.4 Cross-cutting
- [ ] a11y: 44px touch, visible focus ring, contrast on glass (not void), reduced-motion covers framer-motion, no zoom-disable.
- [ ] Responsive: every route at 360/768/1024; sidebar/drawer behavior; modal→sheet.
- [ ] State coverage: empty / loading / error present and styled per page.
- [ ] Use-flow: primary action prominent, secondary quiet, destructive separated + confirm-gated.

---

## 5. Fix strategy per finding

| Finding | Fix | Notes |
|---|---|---|
| 82 raw buttons | `<Button>`/`<IconButton>`, refactor file-by-file | retire `si-btn*` and per-feature classes |
| 109 hardcoded font-sizes | Type-scale tokens + utility classes; replace inline `fontSize:` | start at worst inline files |
| 364 magic spacings | Spacing-scale tokens; `Stack/Cluster` for rhythm | removes most inline `margin/gap` |
| 0 touch targets | bake `min-height:44px` into Button/IconButton/Input | fixes a11y globally via primitive |
| 9 modal widths | Modal size scale (sm/md/lg) + mobile full-sheet | single `Modal` primitive |
| 5 ad-hoc breakpoints | breakpoint tokens + per-surface responsive pass | mobile-first |
| inline-style heavy pages | move to classes/tokens during primitive refactor | drive/settings/gmail first |

---

## 6. Sequencing rationale (why this order)

Strict dependency chain — do **not** reorder:

1. **Tokens first.** Primitives and every refactor consume them. Building primitives before scales = rework.
2. **Primitives next.** Surfaces refactor *onto* primitives. Touch-target + focus a11y is baked in here once.
3. **Refactor surfaces** worst-first (highest slop signal → fastest visible win).
4. **Responsive** after primitives exist (modal→sheet, breakpoints) so it's done once, not per-page ad-hoc.
5. **UX flow / IA polish** — needs consistent primitives in place to judge hierarchy & placement.
6. **Guardrails** last — error-level lint can only ban raw buttons / inline styles / magic px *after* Phase 2 removes them all, else the build breaks everywhere.

Token + primitive phases are mostly **additive** (low regression risk). Refactor phases are
**behavior-preserving** swaps (visual diff only).

---

## 7. Implementation plan — Phases → Sprints

Conventions:
- **Branch per sprint**, off `main` (per project git pref; never commit on `main`). Name: `feat/ui-<area>`.
- **Commit at every sprint checkpoint** (Conventional Commits; no Co-Authored-By trailer).
- **Build/lint only when it can actually catch something** (see policy §8) — not every commit.
- **Model** column: recommended Anthropic model + effort per sprint (rationale §9).
- **Session** column: `↻` = end session / start fresh after this sprint (category boundary, token economy).

### Phase 0 — Foundation tokens (additive, no visual change intended)
| Sprint | Scope | Branch | Build/Lint | Model | Session |
|---|---|---|---|---|---|
| 0.1 | Type scale tokens + utility classes | `feat/ui-tokens-type` | build:dashboard at end | **Opus 4.8 medium** (design judgment) | |
| 0.2 | Spacing + radius scale tokens | `feat/ui-tokens-space` | build at end | **Opus 4.8 medium** | |
| 0.3 | Size scale (control heights, modal/container widths) + breakpoint tokens | `feat/ui-tokens-size` | build at end | **Opus 4.8 medium** | ↻ |

### Phase 1 — Core primitives (a11y baked in here)
| Sprint | Scope | Branch | Build/Lint | Model | Session |
|---|---|---|---|---|---|
| 1.1 | `Button` + `IconButton` (variants/sizes/states, 44px, focus) | `feat/ui-prim-button` | build + lint | **Opus 4.8 high** (taste + a11y) | |
| 1.2 | `Input`/`Textarea`/`Select` | `feat/ui-prim-form` | build + lint | **Opus 4.8 medium** | |
| 1.3 | `Card`/`Panel` + layout (`Stack`/`Cluster`/`Container`) | `feat/ui-prim-layout` | build | **Opus 4.8 medium** | |
| 1.4 | `Modal`/`Sheet` (size scale, mobile sheet, focus trap, scroll lock) | `feat/ui-prim-modal` | build + lint + manual check | **Opus 4.8 high** (interaction + a11y) | ↻ |

### Phase 2 — Refactor surfaces onto primitives (worst-first; behavior-preserving)
| Sprint | Scope | Branch | Build/Lint | Model | Session |
|---|---|---|---|---|---|
| 2.1 | `drive/page.tsx` (8 btn + 38 inline) + its modal | `feat/ui-rf-drive` | build + lint | **Sonnet 4.6 high** (mechanical) | |
| 2.2 | `ScheduleImportCard` (10 btn, retire `si-*`) | `feat/ui-rf-import` | build + lint | **Sonnet 4.6 high** | |
| 2.3 | `settings` (12 inline) + `gmail` (8 inline) | `feat/ui-rf-settings-gmail` | build + lint | **Sonnet 4.6 high** | ↻ |
| 2.4 | `schedule/page.tsx` + `WeekHourGrid` + schedule components | `feat/ui-rf-schedule` | build + lint + manual | **Opus 4.8 medium** (grid complexity) | |
| 2.5 | dashboard `page.tsx` + `WelcomeAgenda` + `Agenda`/`BriefPanel` | `feat/ui-rf-home` | build + lint | **Sonnet 4.6 high** | |
| 2.6 | remaining pages: tasks/memory/approvals/upcoming/activity/projects/files/notepad/chat | `feat/ui-rf-rest` | build + lint | **Sonnet 4.6 high** | ↻ |

> ⚠️ **Sonnet context limit:** keep each refactor sprint to ≤3 files / ≤~600 lines of diff per session.
> If a sprint is bigger, split it. Sonnet is fine for mechanical button/inline swaps but loses the
> thread on large multi-file context — Opus for grid/schedule complexity.

### Phase 3 — Responsive & mobile
| Sprint | Scope | Branch | Build/Lint | Model | Session |
|---|---|---|---|---|---|
| 3.1 | Breakpoint pass on shell: `Shell`/`Sidebar`/`TopBar`/`CommandBar` (drawer on mobile) | `feat/ui-resp-shell` | build + manual @360/768 | **Opus 4.8 medium** | |
| 3.2 | Per-route responsive sweep (360px) + modal→sheet verify | `feat/ui-resp-routes` | build + manual | **Sonnet 4.6 high** | ↻ |

### Phase 4 — a11y + UX flow polish
| Sprint | Scope | Branch | Build/Lint | Model | Session |
|---|---|---|---|---|---|
| 4.1 | a11y audit: focus order, contrast-on-glass, reduced-motion, aria labels | `feat/ui-a11y` | build + manual | **Opus 4.8 high** | |
| 4.2 | Use-flow / IA: primary-action hierarchy, destructive separation, placement per page | `feat/ui-flow` | build + manual | **Opus 4.8 high** (judgment) | ↻ |

### Phase 5 — Guardrails (prevent recurrence)
Purpose: make the "right way" the **only** way. After this phase, new UI must compose primitives;
hand-rolled buttons / inline styles / magic px get caught at lint/build/PR time, so AI-generated or
hand-written UI cannot reintroduce the slop pattern.

> **Why last:** the *error*-level lint rules ban patterns (raw `<button>`, inline `style`, hardcoded
> px) that still exist in bulk until Phase 2 finishes. Enabling them as errors earlier would break the
> build everywhere. Optionally introduce the rules in **warn** mode right after Phase 1, then flip to
> **error** here once all surfaces are clean.

| Sprint | Scope | Branch | Build/Lint | Model | Session |
|---|---|---|---|---|---|
| 5.1 | ESLint rules: ban raw `<button>` (→ `Button`), ban inline `style={{}}`. Stylelint: ban raw px for `font-size`/`padding`/`margin`/`gap`/breakpoint → require `var(--…)`. Wire into `next lint` + PR check. Flip warn→error. | `feat/ui-guard-lint` | **run lint** (verify rules fire) + build | **Opus 4.8 medium** (rule selection + config) | |
| 5.2 | `docs/UI_CONVENTIONS.md` (compose-primitives-only rules) + one-line rule in `CLAUDE.md` design section + component catalog (`/dev/ui` page or primitive index) | `feat/ui-guard-docs` | build | **Opus 4.8 medium** | ↻ |

Coverage check — modal/card/all UI after Phase 5: new modal = `<Modal size>`, new card = `<Card>`,
new action = `<Button variant>`. No primitive bypass possible without a red lint. `/impeccable` stays
in the pre-merge loop for hierarchy/placement drift that lint can't see.

---

## 8. Build / lint policy (when, not always)

- **Token-only sprints (Phase 0):** `npm run build:dashboard` once at sprint end (no behavior; build just confirms no CSS syntax break). No lint needed.
- **Primitive sprints (Phase 1):** `build:dashboard` + `next lint` (new TS/TSX) per sprint. Modal sprint also manual browser check.
- **Refactor sprints (Phase 2):** `build:dashboard` + `next lint` per sprint (catches broken imports/props). Manual check only for schedule/grid.
- **Responsive/a11y (Phase 3–4):** `build:dashboard` + manual viewport check; lint only if code (not just CSS) changed.
- **Skip backend smokes entirely** — no backend touched. Do **not** run `npm run build` (backend) or step smokes.
- Run a check only when a change could plausibly break what the check guards. Don't build after pure-CSS token additions twice.

---

## 9. Model & session strategy

**Model choice principle:**
- **Opus 4.8** — anything needing taste, a11y reasoning, interaction design, or multi-file judgment:
  token scale design, primitives (Button/Modal), schedule/grid refactor, responsive shell, a11y, use-flow.
  Effort *high* for primitives/a11y/flow; *medium* for token scales and mid-complexity refactors.
- **Sonnet 4.6 high** — mechanical, pattern-repetitive work with bounded context: button/inline-style
  swaps on a known set of files (drive, import card, settings/gmail, home, rest, route responsive sweep).
  Cheaper + fast; safe because primitives already define the target shape.

**Sonnet context caution:** Sonnet has a smaller effective context. For Phase 2/3 Sonnet sprints:
- Feed only the target files + the primitive's public API, not the whole repo.
- Cap at ≤3 files / ~600-line diff per session; split otherwise.
- Anything touching `WeekHourGrid`/schedule grid math → Opus, not Sonnet.

**Session economy (avoid random new sessions):**
- Stay in one session for an entire **category** (a phase, or a tightly-coupled sprint group).
- Start a **fresh session at each `↻`** marker — i.e. when a category finishes — to drop accumulated
  context and save tokens. Carry forward only: this doc + the branch state + the next sprint id.
- Do **not** open a new session mid-category just because the conversation is long; finish the category first.
- Each fresh session re-orients from this doc (§7 table) — no re-discovery needed.

---

## 10. Risks & guards

- **Visual regression** during refactor — mitigate: behavior-preserving swaps, one surface per sprint, manual check on heavy pages.
- **Design drift** from Liquid Glass system — mitigate: tokens derive from existing `globals.css` + `DESIGN.md`; use `/impeccable` to validate each refactored surface.
- **Scope creep** — no new features; UI-only. No framework/library swap.
- **Sonnet over-reach** — enforce file/diff caps above; escalate complex surfaces to Opus.
- **Git** — branch per sprint off `main`, never commit on `main`; commit only when sprint checkpoint reached; do not push/PR unless explicitly asked.

---

## 11. Open decisions (need user sign-off before Phase 0)
1. Confirm **no Tailwind / no shadcn** (build primitives on existing plain CSS + tokens). *(recommended)*
2. Confirm phase order (tokens → primitives → refactor → responsive → a11y/flow).
3. Confirm model/session policy in §9.
