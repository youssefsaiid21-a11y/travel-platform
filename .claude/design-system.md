# Orbi Design System & UI Process Notes

Living reference for UI work on Orbi, distilled from a multi-round hero
redesign session (2026-07). Update this file whenever you learn something
that would have changed how you approached a change - this is the
BUSINESS_STATE.md equivalent for UI decisions, not a one-time spec.

**Status note**: the hero has now been ported into the real app
(`src/app/page.tsx` + `src/app/page.module.css`, PR `ui/hero-port-2026-07`,
2026-07). The empty-state hero is now a full-bleed, left-aligned layout
(big lowercase headline "where to next? / book it in a minute.", NL search
bar, real-`EXAMPLE_QUERIES` chips, trust bar, decorative watermark of the
brand mark). The chat/checkpoint/offer flow below is unchanged. Two
deliberate departures from the old centered hero: the wordmark is no longer
repeated in the hero body (it already lives in the global `NavBar`), and the
"Popular routes" grid was dropped (it was a second click-to-search
affordance duplicating the example chips - the vibecoded checklist's "2+
competing click-instead-of-typing affordances" tell). Recent-searches was
kept. The nav in the reference screenshot is the existing global `NavBar`,
not a hero-local element - don't rebuild it.

## Brand tokens (defined in `src/app/globals.css` - use `var(--x)`, never hardcode hex)
- Accent: `--accent` #0284c7, `--accent-light` #38bdf8, `--accent-dark` #0369a1
- Gradients: `--gradient-accent` (2-stop) vs `--gradient-accent-vivid`
  (3-stop, richer) - reserve the vivid one for ONE deliberate brand moment
  per screen (e.g. the wordmark). Never scatter the same gradient across
  buttons + icons + shadows too - that's a "gradient as a crutch" tell.
- Text: `--text-1` #0c1a2e (headings/primary), `--text-2` #1e3a5f
  (secondary), `--text-3` #5b8db0 (muted/placeholder)
- Frosted glass: `rgba(255,255,255,0.55-0.85)` + `backdrop-filter: blur(20px) saturate(160%)` -
  never flat opaque white on top of the aurora background, it reads as a
  hard seam.
- Aurora background: must be `position: fixed`, never scoped to a
  section's own box (a section-scoped background runs out below short
  content and shows raw blank space below it). Also never give a plain
  in-flow wrapper div its own opaque background sitting between `body`
  and the aurora layer - it paints above the fixed layer in stacking
  order and silently hides it. Set the fallback color on `body` only.
- Radius hierarchy: NOT everything is `border-radius: 999px`. Cards/panels
  12-20px, major inputs/search bars ~16px, only small tags/chips get
  full-round. Uniform pill-ification everywhere is the single most common
  "AI-template" tell.
- Shadows: one soft, mostly-neutral elevation shadow per floating
  element. Don't stack a blur shadow + a colored glow ring on the same
  element unless it's a genuine singular focal point - and even then,
  one only.
- Font: Inter, self-hosted via `@fontsource/inter`. The prose here long
  said "only 400/500/600/700 are loaded, never use 800 (it fake-bolds),"
  but that is contradicted by the actual shipped code: `globals.css` DOES
  `@import "@fontsource/inter/800.css"`, and `NavBar.brand` (and the old
  hero logo) render at `font-weight: 800` against a real, loaded 800 face -
  so it is NOT synthesized there. This is an unreconciled doc/code drift.
  Until a founder decision reconciles it (either drop the 800 import + drop
  800 from NavBar, or bless 800 as a loaded weight), new work should stay at
  700 for headings to be safe under either outcome - the 2026-07 hero
  headline is 700 for exactly this reason. Don't set a weight that isn't
  imported, whatever the resolution.

## Motion philosophy
- Decorative, ambient motion (a slow background rotation, a subtle
  gradient shift) is fine and can add character - don't reflexively kill
  all motion in the name of "no gimmicks."
- Motion that GATES or DELAYS real content is not fine - e.g. a
  typewriter effect that takes 1-2+ seconds before the actual headline is
  readable. Test: does this animation make the user *wait* to understand
  or act, or does it add ambience *alongside* content that's already
  usable? First case: cut it. Second: keep it, in moderation.
- Respect `prefers-reduced-motion` on every animation, and check whether
  an element's STATIC position depends on the animation itself (e.g.
  `translateY(-50%)` supplied only inside a `@keyframes` rule) - disabling
  the animation must not also break layout. Give it a static fallback.

## Product UI philosophy
- Orbi is chat-first: NL query -> parsed params -> a "checkpoint" confirm
  card -> real search. This is the real differentiator vs. every
  competitor's structured form. Never let a structured-form fallback
  outrank or visually compete with the chat input as primary on a search
  screen - if one exists at all, it's secondary/opt-in.
- Real behavior teaches better than a diagram. Don't build a static
  "here's how it works" mockup to explain the checkpoint-confirm flow -
  the real product demonstrates it for free the first time someone
  actually searches.
- Trust signals must be real and minimal ("300+ airlines," "Secured by
  Stripe" - true claims only). Never fabricate stats or testimonials this
  young a product hasn't earned - CLAUDE.md's structured-data rules
  already forbid this for SEO; it applies to UI copy too.
- Explore-anywhere (destination-optional search) is a real differentiator
  - surface it through clickable NL examples, not a callout badge
  explaining a field that isn't even visible in the current view.
- Simplicity is a maintenance discipline, not a one-time achievement.
  Each individual addition can be locally reasonable and still
  collectively turn a clean screen into a pile. Periodically ask "if I
  built this fresh today, what's the minimum that does the job" instead
  of only ever adding fixes on top of fixes.
- Copy: plain, short, no corporate filler. Don't let adjacent elements
  (headline, subcopy, a chip, a trust line) restate the same idea in
  different words. Prefer specific, textured examples over generic ones -
  check `EXAMPLE_QUERIES` in `src/app/page.tsx` for the established voice.

## Process discipline (the most important section)
- **A vertically-centered full-height section that can overflow must not
  center with `justify-content: center`.** When the content is taller than
  the viewport (e.g. the hero for a returning user with recent searches),
  flex `justify-content: center` clips the top (the headline) *unreachably*
  - you cannot scroll up to it. Use `margin-block: auto` on the content
  block inside a `flex-direction: column` container instead: it centers when
  there's spare room and collapses to top-aligned + fully scrollable when
  there isn't. Found live in the 2026-07 hero port; invisible from source,
  only caught by rendering with enough content to overflow.
- **Never call a UI change correct because the code looks right.** Every
  real bug found this session - mojibake from a missing charset, an input
  silently overflowing into its neighbor, a divider rendering in the
  wrong spot from a missing `position: relative`, a fixed background
  getting hidden by a sibling's opaque background, a headline breaking
  mid-word from a hacky char-index split - was invisible from source and
  only found by actually rendering and looking, often needing a zoomed
  screenshot. Always render real changes in a browser before calling them done.
- **Test real interactions, not just static screenshots** - click it,
  type in it, expand it, check the result.
- **If you delegate execution to a subagent or cheaper model,
  independently re-verify its work yourself before reporting it done.** A
  subagent's own "verified, works" report is not sufficient. This was the
  single most repeated lesson this session.
- **Check the browser console for errors after every change.**
- **After removing an element, grep the file for its class/id** to catch
  orphaned CSS and dangling `document.getElementById(...)` calls.
- Known tooling quirks (verify, don't assume they still apply): a browser
  resize tool may not actually change the effective CSS viewport - if
  layout doesn't respond, check `window.innerWidth` directly. Confirmed
  again 2026-07: in the claude-in-chrome automated tab, `window.innerWidth`
  was hard-locked at 800 (dpr 2) - `resize_window` (up to 1440 and down to
  400) AND keyboard page-zoom both left it at 800. The iframe-with-explicit-
  width workaround also failed: this app refuses to be framed
  (X-Frame-Options / `frame-ancestors`), so a same-origin `<iframe src="/">`
  renders a broken-doc icon, and a full-viewport cross-origin iframe breaks
  the screenshot tool's page targeting. The workaround that DID work to see
  the mobile branch render for real: temporarily widen the mobile
  breakpoint (e.g. `@media (max-width: 620px)` -> `900px`), reload, screenshot
  at the locked 800 width, verify the mobile reflow, then revert the
  breakpoint. Also: `backdrop-filter` computes to `none` in this automated
  Chrome even though `CSS.supports` returns true and the rule is in the
  sheet - GPU/backdrop compositing is disabled in the automated build, so
  you can't confirm frosted-glass blur via computed style there; confirm the
  glass via the (real, semi-transparent) `background` token + a visual check
  that the aurora bleeds through, and trust that the blur composites on real
  user browsers. CSS animations can report `playState: "running"` while
  frozen at `currentTime: 0` in a backgrounded/automated tab - that's
  tab-throttling, not broken CSS; verify via computed style + the Web
  Animations API.

## "Reads as vibecoded" self-audit checklist
- [ ] Same gradient reused on 3+ unrelated elements? -> one deliberate moment only.
- [ ] `border-radius: 999px` on anything bigger than a tag? -> vary by hierarchy.
- [ ] Multiple stacked shadows/glows on ordinary elements? -> one soft neutral shadow.
- [ ] Any animation delaying real content/interaction? -> cut or unblock it.
- [ ] Generic/interchangeable placeholder copy? -> match the real product's voice.
- [ ] 2+ competing "click instead of typing" affordances at once? -> pick the one that earns its place.
- [ ] Raw emoji as icons in more than one spot? -> a proper small SVG usually reads more considered.
- [ ] Font weights ad-hoc per element rather than a real scale, or using a weight that isn't actually loaded?
