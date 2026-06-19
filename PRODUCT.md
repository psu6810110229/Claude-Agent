# Product

## Register

product

## Users

Single operator: Fran, on a personal Windows PC. Uses the dashboard as a daily
"chief of staff" — checking schedule, triaging tasks and reminders, reviewing
and approving agent-proposed actions, chatting with the Friday assistant, and
reading morning/evening briefs. Context is focused work at a desk (desktop
primary) with occasional phone access over Tailscale (mobile secondary). The
user is technical and trusts the system only as far as it proves itself, so the
interface must make state and evidence legible, not just pretty.

## Product Purpose

Claude_Agent is a local-first Personal Agent OS — a Friday-style secretary that
turns scattered inputs (Google Calendar, Gmail, Contacts, Drive awareness,
exported LINE chats, local tasks/reminders/memory) into one calm command
surface. The deterministic backend is the system of record; AI providers only
propose, and the user approves. Success is: Fran opens the dashboard, sees
what matters now, acts or approves in a few moves, and trusts that nothing was
sent, changed, or claimed-done unless it actually happened.

## Brand Personality

Warm, conversational, human. Friday is a capable secretary with a voice, not a
robotic console and not a toy chatbot. Copy is natural and direct; the agent
answers from evidence and is explicit about its limits (LINE is export-based,
not live; no read/unread state; durable memory requires a real approved action).
Confidence without bluster, warmth without cutesiness. The persona stays
consistent across chat reply, spoken voice, and UI microcopy.

Friday is the only product and assistant name. The UI is Thai-only: navigation,
buttons, labels, empty states, toasts, dialogs, and system microcopy should be
written in Thai, with English retained only for proper nouns, provider names,
commands, file/API names, or technical terms that are clearer in English. There
is no language setting and no Thai/English UI split. Friday's conversational
reply may include English when Fran uses it or when the source material requires
it, but the product surface itself stays Thai.

## Anti-references

- **Generic SaaS dashboard** — no hero-metric tiles, no endless identical
  icon+heading+text card grids, no Linear/Notion-clone cream-and-one-accent
  template.
- **Toy / chatbot UI** — no bubblegum gradients, cartoon avatars, or playful
  chat-toy styling.
- **Cluttered enterprise admin** — no dense toolbars, gray-on-gray tables, or
  every-feature-visible control panels. Density only where the task needs it.
- **Over-the-top sci-fi HUD** — the orb and glow are allowed as one focal
  moment, but no decorative scanlines, fake telemetry, or glow that costs
  readability. Spectacle never beats legibility.

## Design Principles

1. **Answer from evidence, not vibes.** Surfaces show real source and real
   state. Never imply a LINE message is read, or an action is done, unless the
   backend actually executed it.
2. **Safe by default, legible by design.** Approval-gated, reversible actions
   are the norm; the UI makes the gate and its consequence obvious before the
   user commits.
3. **The tool disappears into the task.** Earned familiarity over novelty.
   Standard affordances, consistent component vocabulary screen to screen.
4. **Warm restraint.** One focal moment (the orb / greeting); everything else
   is quiet so the focal moment lands. Personality lives in copy and voice, not
   in decoration on every panel.
5. **Honest states.** Loading, empty, and error states tell the truth and teach
   the next move — no fake progress, no dead ends.

## Accessibility & Inclusion

Target WCAG 2.1 AA, tuned for a single trusted operator (not broad public
compliance, but no AA shortcuts that would degrade Fran's own use). Required:
body text ≥4.5:1 and large/UI text ≥3:1 against actual (often glass) backgrounds;
full keyboard operability with visible focus and Escape/outside-click dismissal
on every overlay; user zoom never disabled; a genuine `prefers-reduced-motion`
path that also covers JS/framer-motion animation, not just CSS; touch targets
≥44px on the mobile surface. Dark-only theme is intentional — verify contrast
on the translucent surfaces specifically, where it is most likely to fail.
