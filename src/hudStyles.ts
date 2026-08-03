/**
 * The app shell and HUD stylesheet.
 *
 * Integration owns page-level layout: src/ui/style.css deliberately scopes
 * itself to .cf-ui, so the shape of the page around it is decided here, next
 * to the markup contract in index.html.
 *
 * Kept in its own module so it can be asserted on without importing the boot
 * sequence, which starts a renderer and a worker the moment it loads.
 */

export const HUD_CSS = `
:root { --cf-hud-gap: 10.5rem; }

html, body {
  height: 100%;
  margin: 0;
  background: #0b0e14;
  overflow: hidden;
  overscroll-behavior: none;
}
#app { position: fixed; inset: 0; }

/* The board owns the whole viewport; the HUD floats over it. */
#stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}

/* The HUD container must never swallow a click meant for the board, so it is
   transparent to pointer events and only its actual controls opt back in.
   Opt in per control, never with a child-of-#ui-root wildcard: the keyboard
   cursor overlay is a sibling of the panel and covers the whole board, and a
   wildcard rule here (specificity 1-0-0) outranks the base stylesheet's
   pointer-events:none on .cf-overlay (0-1-0), which makes the board
   unclickable. */
#ui-root { position: fixed; inset: 0; pointer-events: none; z-index: 100; }
#ui-root .cf-overlay { pointer-events: none; }

/* One palette for the whole product. src/ui/style.css was written as a
   standalone panel and leans cool — blue-grey surfaces and a sky-blue focus
   ring — which reads as a web app sitting on top of a Norse board rather than
   part of it. These are its own variable names, re-pointed at the scene's
   values: charred oak, warm iron, bone, parchment, ember gold. Everything
   inside .cf-ui inherits them, dialogs included. */
#ui-root .cf-ui {
  --cf-bg: #14110e;
  --cf-panel: #1e1a15;
  --cf-panel-edge: #4a4034;
  --cf-text: #efe8d4;
  --cf-muted: #a9a294;
  --cf-accent: #d9a441;
  --cf-focus: #ffe3a3;
  --cf-danger: #c8624a;
}

/* src/ui/style.css lays .cf-ui out as an opaque sidebar. Over a full-bleed
   board it becomes a slim strip along the top instead, fading into the scene
   rather than cutting a panel out of it. */
#ui-root .cf-ui {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
  padding: 0.4rem 0.6rem 0.7rem var(--cf-hud-gap);
  background: linear-gradient(
    to bottom,
    rgba(11, 14, 20, 0.9) 0%,
    rgba(11, 14, 20, 0.55) 60%,
    rgba(11, 14, 20, 0) 100%
  );
  pointer-events: none;
}
#ui-root .cf-ui > *, #ui-root .cf-toolbar > * { pointer-events: auto; }

/* One row height for every control on the strip. The base stylesheet sizes
   these for a sidebar with min-height on a content box, which lands the banner
   12px taller than the buttons beside it; border-box plus an explicit height
   makes the row read as one row. */
#ui-root .cf-ui, #ui-root .cf-ui * { box-sizing: border-box; }
#ui-root .cf-banner,
#ui-root .cf-toolbar button,
#ui-root .cf-toolbar select {
  min-height: 0;
  min-width: 0;
  height: 2rem;
  display: inline-flex;
  align-items: center;
  padding: 0 0.65rem;
  border-radius: 3px;
  font-size: 0.85rem;
}
/* The banner is a line of narration, not a control, so it carries the display
   face — that is what ties the strip to the menu instead of leaving it looking
   like browser chrome parked over the board. */
#ui-root .cf-banner {
  margin: 0;
  border-left-width: 3px;
  white-space: nowrap;
  font-family: var(--cf-display);
  font-size: 0.95rem;
  letter-spacing: 0.03em;
}
#ui-root .cf-toolbar { margin: 0; padding: 0; gap: 0.35rem; }

/* Anything that now lives in the menu's Settings screen is redundant here, and
   redundancy is what made this strip unreadable. Kept: whose move it is, the
   clocks, undo/redo, and the move list. */
#ui-root .cf-toolbar [data-cf-role='new-game'],
#ui-root .cf-toolbar [data-cf-role='view'],
#ui-root .cf-toolbar [data-cf-role='speed'],
#ui-root .cf-toolbar .cf-field,
#ui-root .cf-toolbar .cf-sliders { display: none; }

/* Exporting a position or a game is something you do with a finished game, so
   the two export buttons stay out of the way until there is one. */
#ui-root .cf-toolbar [data-cf-role='fen'],
#ui-root .cf-toolbar [data-cf-role='pgn'] { display: none; }
body[data-cf-game-over='true'] #ui-root .cf-toolbar [data-cf-role='fen'],
body[data-cf-game-over='true'] #ui-root .cf-toolbar [data-cf-role='pgn'] { display: inline-flex; }

/* Clocks and moves ride the right edge, clear of the strip. */
#ui-root .cf-side {
  position: absolute;
  top: 2.9rem;
  right: 0.6rem;
  width: 11.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
/* Stacked, not side by side: two clocks sharing a narrow rail cannot shrink
   below their own text (flex items default to min-width:auto) and would spill
   off the edge of the screen. */
#ui-root .cf-clocks { flex-direction: column; gap: 0.3rem; }
#ui-root .cf-clock {
  min-height: 0;
  min-width: 0;
  padding: 0.25rem 0.5rem;
  font-size: 0.8rem;
}
#ui-root .cf-clock-label { flex: 1 1 auto; }
#ui-root .cf-panel {
  max-height: min(34dvh, 16rem);
  overflow-y: auto;
  padding: 0.4rem 0.5rem;
  background: rgba(20, 22, 27, 0.82);
  backdrop-filter: blur(6px);
}
#ui-root .cf-panel-title { font-size: 0.68rem; margin: 0 0 0.25rem; }

.sr-only {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  border: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
}

/* Phones: drop to the essentials so the board keeps the screen. */
@media (max-width: 760px), (pointer: coarse) and (max-width: 1024px) {
  :root { --cf-hud-gap: 10rem; }
  #ui-root .cf-side { width: 8.5rem; top: 2.6rem; right: 0.4rem; }
  #ui-root .cf-panel { display: none; }
  #ui-root .cf-banner { font-size: 0.78rem; padding: 0.25rem 0.5rem; }
}

/* Landscape is not a preference here: the board is square and a portrait phone
   leaves it unplayably small. Browsers only honour an orientation lock inside
   fullscreen, so this covers the case where the lock is refused. */
#cf-rotate { display: none; }
@media (orientation: portrait) and (max-width: 900px) {
  #cf-rotate {
    position: fixed;
    inset: 0;
    z-index: 9500;
    display: grid;
    place-items: center;
    gap: 0.9rem;
    grid-auto-flow: row;
    align-content: center;
    padding: 2rem;
    text-align: center;
    background: #0b0e14;
    color: #efe8d4;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  /* Drawn rather than set in type: a glyph for "phone" is not something every
     platform font actually has, and a missing one renders as a tofu box. */
  #cf-rotate .cf-rotate-glyph {
    width: 2.5rem;
    height: 4.2rem;
    border: 3px solid #efe8d4;
    border-radius: 0.55rem;
    animation: cf-rotate-hint 2.4s ease-in-out infinite;
  }
  #cf-rotate strong { font-size: 1.1rem; letter-spacing: 0.08em; text-transform: uppercase; }
  #cf-rotate span { color: #a9a294; font-size: 0.9rem; max-width: 22rem; }
}
@keyframes cf-rotate-hint {
  0%, 45% { transform: rotate(0deg); }
  55%, 100% { transform: rotate(-90deg); }
}
@media (prefers-reduced-motion: reduce) {
  #cf-rotate .cf-rotate-glyph { animation: none; }
}
`;
