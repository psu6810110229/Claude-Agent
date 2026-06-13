# Mobile UI Deep Redesign — Home + Approvals (Execution Plan)

> **For the implementing model (Sonnet 4.6):** This plan is self-contained. All code blocks below
> are copy-paste ready. Line numbers reference the files **as they exist at commit `ca2294a`** —
> verify the anchor text before editing (use it as the `old_string`). Do not touch backend,
> schemas, API, or logic. All new behavior is scoped to mobile media queries; desktop must not
> regress.

---

## Context

Commit `ca2294a` ("revamp chat UX and fix mobile layout/viewport") landed a first mobile pass, but
**Home (`/`, `.jarvis-home`)** and **Approvals (`/approvals`)** still read rough on phones.

Confirmed problems (≤680px):
- `.jarvis-home` uses `100vh` → viewport jump + content clipped under mobile browser chrome.
- Sub-44px touch targets: suggestion pills 36px, inline approve/reject 30px, approval card buttons 38px.
- No `safe-area-inset` horizontal padding → landscape notch clip (`viewportFit:'cover'` is already set).
- Mobile input is a cramped 2-row grid.
- 4 approval columns each reserve `min-height:180px` → huge dead scroll when stacked.
- `.jarvis-mute-btn` styled only inside the 680px query → renders as a stray rounded-rect on desktop/tablet.

**User-chosen direction:** Deep redesign · single-row capsule input · stacked inline approval ·
airy & minimal (Claude/ChatGPT premium feel).

**Outcome:** calm, edge-to-edge, thumb-friendly mobile experience for both pages, desktop untouched.

## Files

| # | File | Change |
|---|------|--------|
| 1 | `packages/dashboard/src/app/globals.css` | Primary — base fixes + rewritten `@media ≤980` / `≤680` blocks |
| 2 | `packages/dashboard/src/components/JarvisInput.tsx` | Add provider switch inside `⋯` menu |
| 3 | `packages/dashboard/src/app/approvals/page.tsx` | Add `empty` class to zero-item columns |
| 4 | `packages/dashboard/src/app/layout.tsx` | Verify only (a11y note on `maximumScale`) |

---

# SPRINT 0 — Prep & baseline (no code change)

1. `cd "D:\Fran's Folder\Project-archive\Claude_Agent"`; confirm clean tree on `main`.
2. `npm run build:dashboard` → confirm it builds **before** edits (baseline).
3. Open `globals.css`; confirm these anchors still exist at ~these lines:
   - `.jarvis-home {` (~2341), `.jarvis-input-dock {` (~2612), `@media (max-width: 980px)` (~2804),
     `@media (max-width: 680px)` (~2907), and its closing `}` before `@media (prefers-reduced-motion` (~3061/3063).
4. Note: the `≤680` block currently styles the input as a **grid** (`.jarvis-input { display:grid; ... }`,
   lines ~2993–3046) and defines `.jarvis-mute-btn` (lines ~3048–3060). Sprint 3 **replaces** that grid section.

**Exit criteria:** baseline build green; anchors confirmed.

---

# SPRINT 1 — Global / shell base fixes (globals.css)

### 1.1 — `.jarvis-home`: `100vh` → `100dvh`
**Replace** (~line 2341):
```css
.jarvis-home {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 130px);
}
```
**With:**
```css
.jarvis-home {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - 130px);
}
```

### 1.2 — `.jarvis-input-dock` base: add gap + center
**Replace** (~line 2612):
```css
.jarvis-input-dock {
  position: sticky;
  bottom: 28px;
  display: flex;
  justify-content: center;
  padding: 24px 0 4px;
}
```
**With:**
```css
.jarvis-input-dock {
  position: sticky;
  bottom: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px 0 4px;
}
```

### 1.3 — Promote `.jarvis-mute-btn` to a base rule
**Insert immediately after** the `.jarvis-input-dock` rule (before `.jarvis-input {`):
```css
.jarvis-mute-btn {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.055);
  box-shadow: var(--inner-light);
  color: var(--muted);
  padding: 0;
}

.jarvis-mute-btn svg {
  width: 19px;
  height: 19px;
}

.jarvis-mute-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}
```

### 1.4 — `.main` safe-area edges (inside `@media (max-width: 980px)`)
**Replace** (~line 2875):
```css
  .main {
    padding: 18px;
  }
```
**With:**
```css
  .main {
    padding: 18px max(18px, env(safe-area-inset-right)) 18px
      max(18px, env(safe-area-inset-left));
  }
```

**Exit criteria:** build green; desktop mute button now a clean circle; no visual change to desktop layout.

---

# SPRINT 2 — Home: welcome + conversation thread (globals.css, `@media ≤680`)

> Add these rules **inside** `@media (max-width: 680px)`, after the existing early rules
> (e.g. after `.panel-head { flex-direction: column; }` ~line 2981) and **before** the input grid
> section that Sprint 3 will replace. Grouped + commented.

```css
  /* --- Mobile edges (airier, notch-safe) --- */
  .main {
    padding: 14px max(18px, env(safe-area-inset-right)) 0
      max(18px, env(safe-area-inset-left));
  }

  /* --- Home: conversation reads full-width, calmer rhythm --- */
  .chat-messages {
    gap: 16px;
    padding: 8px 2px 20px;
  }

  .chat-bubble-wrapper {
    gap: 10px;
  }

  .chat-bubble.user {
    max-width: 88%;
  }

  /* --- Welcome: airy greeting + tappable suggestion chips --- */
  .jarvis-welcome {
    gap: 24px;
  }

  .jarvis-greeting p {
    margin-top: 8px;
  }

  .chat-empty-actions {
    margin-top: 18px;
    gap: 10px;
  }

  .chat-empty-actions button {
    flex: 1 1 100%;
    min-height: 44px;
    padding: 10px 16px;
    font-size: 14px;
  }

  /* --- Inline approval / clarification: stack, 44px touch --- */
  .chat-approval {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .chat-approval-actions {
    width: 100%;
  }

  .chat-approval-actions button,
  .chat-clarification-actions button {
    flex: 1 1 0;
    min-height: 44px;
    font-size: 13px;
  }
```

**Exit criteria:** at 390px — greeting airy, suggestion pills are full-width 44px chips, inline
approve/reject stack vertically full-width; assistant text runs near the edge without clipping.

---

# SPRINT 3 — Single-row capsule input (globals.css + JarvisInput.tsx)

### 3.1 — JarvisInput.tsx: add provider switch inside the `⋯` menu

In `packages/dashboard/src/components/JarvisInput.tsx`, the brief menu is the `{menuOpen && (<div className="ji-menu" role="menu">...`  block (~lines 101–122). **Add a provider section at the top of that menu**, reusing existing `PROVIDER_OPTIONS`, `provider`, `onProviderChange`.

**Replace:**
```tsx
          {menuOpen && (
            <div className="ji-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={disabled || briefBusy !== null}
                onClick={() => runBrief("daily")}
              >
```
**With:**
```tsx
          {menuOpen && (
            <div className="ji-menu" role="menu">
              {onProviderChange && (
                <div className="ji-menu-provider" role="group" aria-label="AI provider">
                  {PROVIDER_OPTIONS.map((opt) => (
                    <button
                      type="button"
                      key={opt.id}
                      className={provider === opt.id ? "active" : ""}
                      aria-pressed={provider === opt.id}
                      disabled={disabled}
                      onClick={() => onProviderChange(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={disabled || briefBusy !== null}
                onClick={() => runBrief("daily")}
              >
```
> The inline `.ji-provider` row stays in the JSX as-is; CSS (3.3) hides whichever is wrong for the
> viewport. No prop/logic change.

### 3.2 — globals.css: REPLACE the entire mobile input-grid section

Inside `@media (max-width: 680px)`, **delete** the whole block from the comment
`/* Responsive Input Dock & Mobile Form Grid */` through the closing of `.jarvis-mute-btn`
(current lines ~2983–3060) and **replace with** this single-row capsule:

```css
  /* --- Single-row capsule input --- */
  .jarvis-input-dock {
    position: sticky;
    bottom: 12px;
    gap: 10px;
    padding: 8px 0;
    padding-bottom: calc(8px + env(safe-area-inset-bottom, 8px));
  }

  .jarvis-input {
    flex: 1;
    width: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 60px;
    padding: 0 8px 0 16px;
    border-radius: 30px;
  }

  .jarvis-input input {
    flex: 1;
    min-width: 0;
    font-size: 16px; /* keep ≥16px: prevents iOS focus zoom */
  }

  /* Provider toggle lives in the ⋯ menu on mobile, not inline */
  .ji-provider {
    display: none;
  }

  .ji-menu-provider {
    display: flex;
    gap: 4px;
    margin-bottom: 6px;
    padding: 4px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.05);
    box-shadow: var(--inner-light);
  }

  .ji-menu-provider button {
    flex: 1 1 0;
    min-height: 36px;
    border-radius: 9px;
    background: none;
    box-shadow: none;
    color: var(--muted);
    padding: 6px 4px;
    font-size: 12px;
  }

  .ji-menu-provider button.active {
    background: var(--accent);
    color: #fff;
  }

  .jarvis-input button {
    width: 40px;
    height: 40px;
  }

  .jarvis-input .ji-send {
    width: 44px;
    height: 44px;
  }

  /* Mute: clean circle beside the capsule (base rule sizes it; nudge up on mobile) */
  .jarvis-mute-btn {
    width: 48px;
    height: 48px;
  }
```

### 3.3 — globals.css: hide the in-menu provider section on desktop

Add a desktop-scoped rule **outside** any media query, near the existing `.ji-menu` rules (~line 2745):
```css
.ji-menu-provider {
  display: none;
}
```
> Order matters: this base `display:none` hides the menu-provider on desktop; the `≤680` rule
> (3.2) overrides it to `flex` on mobile. Inline `.ji-provider` is visible on desktop, hidden ≤680.

**Exit criteria:** desktop — inline provider toggle visible, menu shows only briefs (unchanged).
Mobile — capsule is one row `[✨][input][⋯][↑]`, provider chooser appears at top of the `⋯` menu,
send ≥44px, mute a 48px circle beside the capsule, input does not zoom on focus.

---

# SPRINT 4 — Approvals: airy board + collapse empty columns

### 4.1 — approvals/page.tsx: tag empty columns

In `ApprovalColumn` (~line 176), the section className is:
```tsx
    <section className={`approval-column ${column.key}`}>
```
**Replace with:**
```tsx
    <section
      className={`approval-column ${column.key}${
        approvals.length === 0 ? " empty" : ""
      }`}
    >
```
> No logic change. `approvals` here is the per-column array already passed in.

### 4.2 — globals.css: airy cards + 44px buttons + collapse empties

Add **inside** `@media (max-width: 680px)` (the board is already 1-column from the existing
`.approvals-board { grid-template-columns: 1fr; }` ~line 2920–2922):

```css
  /* --- Approvals: airy cards, ergonomic buttons --- */
  .approval-column-body {
    min-height: 0;
    padding: 8px;
  }

  .approval-board-card {
    border-radius: 14px;
    padding: 16px;
    gap: 8px;
  }

  .approval-card-actions {
    gap: 10px;
    margin-top: 14px;
  }

  .approval-card-actions button {
    flex: 1 1 0;
    min-height: 44px;
  }

  /* Collapse empty columns to a slim "Title 0" strip */
  .approval-column.empty .approval-column-head {
    min-height: 0;
    padding: 10px 14px;
  }

  .approval-column.empty .approval-column-head p {
    display: none;
  }

  .approval-column.empty .approval-column-body {
    display: none;
  }
```

**Exit criteria:** at 390px — non-empty columns show airy 16px cards with clear badge/title/summary
hierarchy and full-width 44px Approve/Reject; empty columns shrink to a one-line `Title  0` strip
(no 180px dead space, no "Clear" placeholder).

---

# SPRINT 5 — Verify

1. `npm run build:dashboard` → must compile clean (UI-only; no backend smoke required).
2. Run app: `npm run dev` (backend) + `npm run dev:dashboard`; open `http://localhost:3000`.
3. DevTools device toolbar — test **iPhone 14 (390px)**, **narrow 360px**, **landscape**:
   - **Home:** no viewport jump/clip; Orb + greeting centered & airy; suggestion chips ≥44px full-width;
     send a message → assistant thread full-width, no edge clip; input is single-row capsule;
     provider reachable via `⋯`; mute a clean circle; landscape respects notch (no clip).
   - **Approvals:** 1 column; empty columns collapse to slim strip; cards airy; Approve/Reject ≥44px full-width.
4. **Desktop regression (≥1024px):** inline provider toggle, 4-col board, capsule (72px), mute, brief menu — all unchanged.
5. No TS/lint errors from the two TSX edits.

---

## Risks & notes

- `⋯` menu now holds provider + briefs — confirm dropdown height OK on short viewports (it's small; low risk).
- Empty-column collapse depends on the new `empty` class; `groupApprovals` keys map 1:1 to columns (verified) so counts are correct.
- All overrides scoped to `≤680` (and `≤980` for `.main`); desktop paths untouched.
- **a11y (optional, ask user):** `layout.tsx` sets `viewport.maximumScale: 1`, which disables
  pinch-zoom. Out of the 2-page scope and looks deliberate — leave unless user wants it removed
  (change to `maximumScale: 5` to re-enable zoom).
- Keep existing `@media (prefers-reduced-motion: reduce)` block intact.

## Suggested commit

```
feat(dashboard): deep mobile redesign for Home + Approvals

- Home: dvh viewport fix, airy welcome, full-width 44px suggestion chips,
  stacked inline approvals, single-row capsule input (provider moved into menu)
- Approvals: airy 16px cards, 44px full-width actions, collapse empty columns
- Shell: safe-area edge insets, base .jarvis-mute-btn circle
- CSS-led; desktop unchanged; no backend/logic change

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```
