---
name: Friday
description: Thai-only dark liquid-glass command surface for a local-first personal agent OS
colors:
  arc-blue: "#0a84ff"
  arc-blue-hover: "#3d9bff"
  halo-violet: "#8b5cf6"
  sky-blue: "#7cb8ff"
  ink: "#f5f5f7"
  void: "#080808"
  slate: "#101114"
  surface: "#1a1b20"
  muted: "#ebebf58c"
  muted-strong: "#ebebf5c7"
  hairline: "#ffffff12"
  hairline-strong: "#ffffff24"
  amber: "#ffcf66"
  rose: "#ff7088"
  ok: "#5fdf94"
typography:
  display:
    fontFamily: "IBM Plex Sans, -apple-system, SF Pro Display, Segoe UI Variable Display, system-ui, sans-serif"
    fontSize: "clamp(34px, 4.4vw, 52px)"
    fontWeight: 640
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "IBM Plex Sans, -apple-system, SF Pro Display, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 660
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  title:
    fontFamily: "IBM Plex Sans, -apple-system, SF Pro Text, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 620
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "IBM Plex Sans Thai, IBM Plex Sans, -apple-system, SF Pro Text, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0.01em"
  label:
    fontFamily: "IBM Plex Sans, -apple-system, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.14em"
rounded:
  sm: "12px"
  md: "14px"
  lg: "22px"
  bubble: "20px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
components:
  button:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 15px"
  button-primary:
    backgroundColor: "{colors.arc-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "8px 15px"
  button-primary-hover:
    backgroundColor: "{colors.arc-blue-hover}"
    textColor: "#ffffff"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "9px 13px"
    height: "40px"
  badge:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.muted-strong}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  chat-bubble-user:
    backgroundColor: "#313244"
    textColor: "#ffffff"
    rounded: "{rounded.bubble}"
    padding: "12px 18px"
  capsule-send:
    backgroundColor: "{colors.arc-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    size: "46px"
---

# Design System: Friday

## 1. Overview

**Creative North Star: "Liquid Glass Atelier"**

This is a dark, depth-led command surface for a single trusted operator. Every
panel is a sheet of frosted glass floating over a near-black void; depth comes
from translucency, blur, and tonal layering rather than outlines. The aesthetic
is Apple-HIG craft applied to a personal agent OS — material-forward, quiet at
rest, with one focal moment (the breathing orb) that earns its glow. The voice
of the product is warm and human; the surface honors that by staying calm and
legible so Friday's personality lives in the words, not in decoration on every
element.

Friday is the only product and assistant identity. Do not use J.A.R.V.I.S,
Jarvis, or a "J" avatar in the UI. The dashboard chrome, controls, labels,
empty states, toasts, and system microcopy are Thai-only. There is no language
setting and no split Thai/English UI mode. Friday may still use English terms
inside conversational replies when Fran uses them, when a provider/product name
requires them, or when an English technical term is clearer than a forced
translation.

The system is **confident and expressive** in its accents and **restrained** in
its chrome. Gradient primaries and the arc-blue→halo-violet signature carry
action and identity; everything around them recedes into glass and muted ink.
Density appears only where the task demands it (approval boards, activity logs,
schedule timelines) — never as default enterprise clutter.

It explicitly rejects: the **generic SaaS dashboard** (hero-metric tiles,
identical icon+heading+text card grids); the **toy / chatbot UI** (bubblegum
gradients, cartoon avatars); the **cluttered enterprise admin** (dense toolbars,
gray-on-gray tables); and the **over-the-top sci-fi HUD** (scanlines, fake
telemetry, glow that costs readability). The orb is the one permitted spectacle;
it must never multiply into HUD decoration.

**Key Characteristics:**
- Dark-only, near-black void base (`#080808`) — no light theme.
- Glass surfaces: translucent white films, backdrop-blur, inner-light highlight.
- One signature: arc-blue → halo-violet, reserved for action and the focal orb.
- Tonal-stack depth, not borders — hairlines are a whisper, used sparingly.
- Warmth in copy and voice; calm, legible chrome everywhere else.

## 2. Colors

A near-monochrome dark field lit by a single blue→violet signature, with three
semantic status hues held in reserve.

### Primary
- **Arc Blue** (`#0a84ff`): The system action color. Primary buttons, current
  selection, focus rings, links (as `#3d9bff` hover / `#7cb8ff` on dark text),
  the active-nav gradient, and the leading edge of the orb. This is the spine of
  the interface — where the user acts, Arc Blue is present.
- **Arc Blue Hover** (`#3d9bff`): The lifted state of every Arc Blue surface.

### Secondary
- **Halo Violet** (`#8b5cf6`): The ambient-glow partner. It never carries a
  solo action; it is the second stop of the signature gradient (orb, capsule
  send button, brand mark) and the source of the page's faint background bloom.
  Halo Violet is identity, not instruction.

### Tertiary (status reserve)
- **Amber** (`#ffcf66`): Warning, "due soon", pending-attention badges.
- **Rose** (`#ff7088`): Error, failed execution, destructive actions, unread dot.
- **OK Green** (`#5fdf94`): Success, approved, online status, executed.

### Neutral
- **Ink** (`#f5f5f7`): Primary text. High-contrast near-white on the void.
- **Muted Strong** (`#ebebf5c7`, ~78% ink): Secondary text, labels that must
  still read on glass. **This is the floor for body text on translucent panels.**
- **Muted** (`#ebebf58c`, ~55% ink): Tertiary text, timestamps, captions — only
  on the solid void, never as body text on a lightened glass surface.
- **Void** (`#080808`): The base canvas. **Slate** (`#101114`) and **Surface**
  (`#1a1b20`) are the tonal steps above it for popovers and solid dropdowns.
- **Hairline** (`#ffffff12`, ~7% white) / **Hairline Strong** (`#ffffff24`):
  Separators. A whisper, never a frame.

### Named Rules
**The One Signature Rule.** Arc Blue + Halo Violet is the only chromatic
identity. It appears on action, selection, and the orb — nothing decorative.
The three status hues (amber/rose/green) are *semantic only*; they never
decorate. If a color isn't carrying action, state, or the focal moment, it's
ink or glass.

**The Contrast-on-Glass Rule.** Contrast is verified against the *lightened
glass surface*, not the void. Muted (`#ebebf58c`) passes on `#080808` and fails
on a panel — body and placeholder text on any glass surface uses Muted Strong
(`#ebebf5c7`) or Ink.

## 3. Typography

**Display / UI Font:** IBM Plex Sans (with `-apple-system`, SF Pro, Segoe UI
Variable, system-ui fallbacks)
**Thai Font:** IBM Plex Sans Thai (leads the body stack because the product UI
is Thai-only; the Plex superfamily keeps Latin provider names and technical
terms visually unified)

**Character:** One humanist-grotesque superfamily across the whole UI — display,
headings, body, labels, data. No display/body pairing; hierarchy is carried by
weight (400→660) and size, not by contrasting families. Plex's slightly
mechanical warmth fits "human, not robotic; precise, not cold."

### Hierarchy
- **Display** (640, `clamp(34px, 4.4vw, 52px)`, lh 1.1, ls −0.025em): The home
  greeting only ("Good morning, Fran."). The single large type moment.
- **Headline** (660, 28px, lh 1.12, ls −0.02em): Page titles (`h2`).
- **Title** (620, 15px, lh 1.25, ls −0.01em): Panel and section headings (`h3`).
- **Body** (400, 14px, lh 1.55, ls 0.01em): Chat, prose, descriptions. Cap prose
  at 65–75ch; data rows may run denser.
- **Data** (640, 30px, tabular-nums): Stat numerals in summary tiles.
- **Label** (700, 11px, ls 0.14em, UPPERCASE): Kickers, side-labels, badge text.

### Named Rules
**The One Family Rule.** IBM Plex carries everything. Never introduce a second
sans for "personality"; weight and size are the only hierarchy tools.

**The Label-Restraint Rule.** Uppercase tracked labels are powerful and
*overused in this codebase*. Reserve them for true kickers and badges. Section
and panel headings use Title case (`h3`), not another uppercase label. One
uppercase role per view, not five.

## 4. Elevation

Depth is **layered tonal**, with glass as the material. The base is the Void
(`#080808`); surfaces step up tonally through Slate (`#101114`) and Surface
(`#1a1b20`), and floating panels are translucent white films
(`rgba(255,255,255,0.05–0.08)`) lifted by `backdrop-filter: blur(22–34px)`.
Shadow is *ambient only* — it sells the float, it does not draw boxes. Borders
are nearly absent; the tonal step plus the inner-light highlight
(`inset 0 1px 0 rgba(255,255,255,0.07)`) does the separating.

### Shadow Vocabulary
- **Ambient Float** (`box-shadow: 0 24px 70px rgba(0,0,0,0.55)`): Popovers,
  dialogs, the highest-floating glass (`--shadow`).
- **Ambient Soft** (`box-shadow: 0 10px 32px rgba(0,0,0,0.35)`): Panels, stat
  tiles, sidebar (`--shadow-soft`).
- **Inner Light** (`inset 0 1px 0 rgba(255,255,255,0.07)`): The top-edge sheen
  on every glass surface — what makes it read as a lit sheet, not a flat fill.

### Named Rules
**The Tonal Stack Rule.** Separation comes from the tonal step (void → glass →
surface) and the inner-light sheen, not from borders. A hairline appears only
when two same-tone surfaces meet and tone alone can't separate them.

**The Earned-Blur Rule.** `backdrop-filter` is expensive and stacks badly.
Use it on genuinely floating layers (sidebar, topbar, dialogs, popovers, the
capsule). Never blur a static in-flow panel for decoration, and never nest
three blurred layers — it tanks frames on mobile.

## 5. Components

Buttons, inputs, and cards are **confident and expressive**: soft glass bodies,
gradient primaries, a gentle hover-lift (`translateY(-1px)`), and exponential
ease-out — responsive, never bouncy.

### Buttons
- **Shape:** Rounded (12px, `{rounded.sm}`); circular for icon/send actions
  (`{rounded.pill}`).
- **Primary:** Arc Blue → `#2563eb` gradient, white text, blue ambient glow
  (`0 6px 20px rgba(10,132,255,0.32)`), padding `8px 15px`.
- **Default (glass):** `rgba(255,255,255,0.07)` fill, ink text, inner-light.
- **Danger:** Rose-soft fill, Rose text.
- **Hover / Focus:** `translateY(-1px)` lift + brightened fill;
  `:active` settles to `translateY(0) scale(0.98)`. Disabled drops to 0.45 opacity.

### Chips / Badges
- **Style:** Pill (`{rounded.pill}`), glass or semantic-soft fill, no border.
- **State:** Status badges map to the semantic reserve — `pending/open` → Sky
  Blue, `approved/succeeded` → OK Green, `failed/rejected` → Rose,
  `reminder` → Amber, `event` → Violet. Suggestion chips are glass pills.

### Cards / Containers (Panels)
- **Corner Style:** 14px (`{rounded.md}`); 22px (`{rounded.lg}`) for the largest
  glass (sidebar, placeholder heroes).
- **Background:** Glass film (`rgba(255,255,255,0.05)`) + `backdrop-filter:
  blur(22px)`.
- **Shadow Strategy:** Ambient Soft + Inner Light (see Elevation).
- **Border:** None by default; hairline only between rows inside a panel.
- **Internal Padding:** 16–18px (`{spacing.lg}`–18).
- **Never nest a card in a card.**

### Inputs / Fields
- **Style:** Glass fill (`rgba(255,255,255,0.06)`), no stroke, 12px radius,
  inner-light, min-height 40px.
- **Focus:** Fill brightens + a 3px Arc Blue ring
  (`0 0 0 3px rgba(10,132,255,0.28)`) — glow, not a hard border.
- **Disabled:** Fill drops, text → Muted.
- **Mobile inputs stay ≥16px font** to defeat iOS focus-zoom.

### Navigation
- **Sidebar:** Floating glass rail (308px), brand orb + status, primary links +
  collapsible "More", schedule and system widgets below. Active link is the
  Arc Blue→Violet gradient with white text; hover is a faint white wash +
  `translateX(1px)`. On ≤980px it becomes a left drawer with backdrop.
- **Topbar:** Translucent sticky header, right-aligned: notifications, settings,
  profile chip. Mobile gains a hamburger that opens the drawer.

### The Orb (signature component)
A breathing liquid-glass sphere built from layered conic + radial gradients,
blur, a drifting-particle field, and a soft halo. It is the visual heart of the
home surface and the agent's "presence." It nudges pace/brightness across
`idle / listening / thinking` states — never blinks, never flashes. It is the
*only* sanctioned spectacle in the system. `aria-hidden`; it is decorative, and
its motion must collapse under reduced-motion.

### The Capsule Input (signature component)
A 72px floating glass pill docked at the bottom of the home stage: sparkle icon,
text field, provider toggle, brief menu, and an Arc Blue→Halo Violet circular
send. It is the primary way Fran talks to Friday — it stays docked, sized for
touch, and clears the mobile keyboard.

## 6. Do's and Don'ts

### Do:
- **Do** keep Arc Blue + Halo Violet as the only chromatic identity — action,
  selection, and the orb. Status hues stay semantic.
- **Do** convey depth with the tonal stack (void → glass → surface) + inner-light
  sheen, not borders.
- **Do** verify text contrast against the *glass surface*, not the void; body and
  placeholder on panels use Muted Strong (`#ebebf5c7`) or Ink.
- **Do** give every animation a real `prefers-reduced-motion` path — including
  framer-motion / JS timers (the orb, greeting, reveal typewriter), not just CSS.
- **Do** keep touch targets ≥44px and never disable user zoom.
- **Do** drive depth/motion with the easing tokens (`--ease-out-expo`,
  `--ease-out-quart`); ease-out only, 150–250ms on state transitions.
- **Do** use one semantic z-scale (dropdown → sticky → modal → toast → tooltip).

### Don't:
- **Don't** build the **generic SaaS dashboard** — no hero-metric tiles, no
  identical icon+heading+text card grids.
- **Don't** drift toward a **toy / chatbot UI** — no bubblegum gradients, no
  cartoon avatars.
- **Don't** make a **cluttered enterprise admin** — no dense toolbars, no
  gray-on-gray tables; density only where the task needs it.
- **Don't** add **over-the-top sci-fi HUD** dressing — no scanlines, no fake
  telemetry, no glow that costs readability. The orb is the only spectacle.
- **Don't** use a `border-left`/`border-right` >1px as a colored accent stripe
  (the toast's 3px stripe is a current violation — tint the fill or color the
  icon instead).
- **Don't** use `background-clip: text` gradient text.
- **Don't** nest a card inside a card, or stack three blurred layers.
- **Don't** scatter uppercase tracked labels on every section — one uppercase
  role per view.
