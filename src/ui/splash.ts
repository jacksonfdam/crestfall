/**
 * Animated title splash. Mounts itself on import (the same side-effect entry
 * pattern as src/analytics.ts) so it is on screen before the scene, the audio
 * graph and the AI worker have finished booting, and dismisses on any input or
 * after a short beat.
 *
 * The motion is built on the game's own name: a helm crest falls, strikes the
 * rail, and the impact throws the two faction banners apart and shakes the
 * wordmark into place. Ash reads high-value and ember low-value, so the two
 * banners stay legible in greyscale like the rest of the heraldry.
 *
 * All original: the composition, the marks and the wordmark treatment are the
 * project's own. CRESTFALL ships no content derived from other chess titles
 * (see README.md), so nothing here copies another game's logo, wordmark,
 * heraldry or palette.
 *
 * Self-contained by design: the styles are injected rather than added to
 * ui/style.css, and it imports nothing but the settings key, so it cannot break
 * the app shell it covers.
 */

import { SETTINGS_STORAGE_KEY } from './settings.ts';

const MOUNT_ID = 'cf-splash';
/** How long the splash holds before retiring itself, milliseconds. */
const DWELL = 4600;
/** Fade-out length; must match the CSS transition below. */
const FADE = 420;

/**
 * Should the splash be presented still, with no motion? True when the user has
 * turned reduced motion on in settings, or when they have not chosen and the OS
 * asks for it. Pure so it can be tested without a DOM.
 */
export function wantsStillSplash(
  storedSettings: string | null,
  mediaPrefersReduced: boolean,
): boolean {
  if (storedSettings) {
    try {
      const parsed: unknown = JSON.parse(storedSettings);
      if (parsed && typeof parsed === 'object') {
        const value = (parsed as Record<string, unknown>).reducedMotion;
        if (typeof value === 'boolean') return value;
      }
    } catch {
      // Corrupt settings are not worth a broken splash; fall through to the OS.
    }
  }
  return mediaPrefersReduced;
}

const CSS = `
#${MOUNT_ID} {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: grid;
  place-items: center;
  background: radial-gradient(ellipse at 50% 42%, #1b1e25 0%, #0b0c0f 70%);
  opacity: 1;
  transition: opacity ${FADE}ms ease-out;
  overflow: hidden;
  font-family: ui-serif, Georgia, 'Times New Roman', serif;
  color: #e9e6dc;
}
#${MOUNT_ID}[data-leaving='true'] { opacity: 0; }

#${MOUNT_ID} .cf-stage {
  position: relative;
  width: min(96vw, 78rem);
  max-height: 94vh;
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
}

/* Rune-tick frame, echoing the board's file and rank glyphs. */
#${MOUNT_ID} .cf-frame {
  position: absolute;
  inset: 3%;
  border: 1px solid #3a4150;
  box-shadow: inset 0 0 0 1px #14161b;
}
#${MOUNT_ID} .cf-frame::before,
#${MOUNT_ID} .cf-frame::after {
  content: '';
  position: absolute;
  left: 6%;
  right: 6%;
  height: 6px;
  background-image: repeating-linear-gradient(
    to right, #3a4150 0 1px, transparent 1px 5.5%
  );
}
#${MOUNT_ID} .cf-frame::before { top: -3px; }
#${MOUNT_ID} .cf-frame::after { bottom: -3px; }

/* ── Banners ─────────────────────────────────────────────────────────────── */
/* The pair covers the whole frame and meets at the centre seam, so there is
   something for the falling crest to throw open. */
#${MOUNT_ID} .cf-rail {
  position: absolute;
  top: 3%;
  left: 3%;
  right: 3%;
  height: 0.9%;
  z-index: 2;
  background: linear-gradient(to bottom, #4a5263, #23272f);
}
#${MOUNT_ID} .cf-banner {
  position: absolute;
  top: 3.4%;
  width: 47%;
  height: 84%;
  z-index: 2;
  display: grid;
  place-items: center;
  /* Gonfalon: squared at the rail, pointed at the hem. */
  clip-path: polygon(0 0, 100% 0, 100% 88%, 50% 100%, 0 88%);
}
#${MOUNT_ID} .cf-mark { width: 46%; max-height: 62%; }
#${MOUNT_ID} .cf-mark svg { width: 100%; height: auto; display: block; }
#${MOUNT_ID} .cf-ash {
  left: 3%;
  transform-origin: 100% 0%;
  background:
    repeating-linear-gradient(to right,
      rgba(20, 22, 27, 0.16) 0 2px, rgba(20, 22, 27, 0) 2px 6.5%),
    linear-gradient(105deg, #b9b3a4 0%, #efe8d4 38%, #d8d2c2 62%, #a9a294 100%);
}
#${MOUNT_ID} .cf-ember {
  right: 3%;
  transform-origin: 0% 0%;
  background:
    repeating-linear-gradient(to right,
      rgba(0, 0, 0, 0.34) 0 2px, rgba(0, 0, 0, 0) 2px 6.5%),
    linear-gradient(75deg, #17120f 0%, #3a2f26 42%, #241d19 68%, #100d0b 100%);
}

/* ── Falling crest ───────────────────────────────────────────────────────── */
/*
 * Placed so the struck base of the crest lands exactly on the rail. The stage
 * aspect is fixed, so this holds at every size: the art is 160x120, its base bar
 * sits ~69% down, and 18% of stage width is 24% of stage height — putting the
 * bar 16.6% below the element's top, against a rail at 3%.
 */
#${MOUNT_ID} .cf-crest {
  position: absolute;
  top: -13.5%;
  width: 18%;
  z-index: 3;
}
#${MOUNT_ID} .cf-crest svg { width: 100%; height: auto; display: block; }

/* ── Wordmark ────────────────────────────────────────────────────────────── */
/* Behind the banners, so parting them reveals it rather than covering it. */
#${MOUNT_ID} .cf-word {
  position: relative;
  z-index: 1;
  margin: 0;
  font-size: clamp(2rem, 9vw, 6.5rem);
  font-weight: 600;
  letter-spacing: 0.14em;
  text-indent: 0.14em;
  line-height: 1;
  text-transform: uppercase;
  text-shadow: 0 2px 0 #0b0c0f, 0 0 28px rgba(217, 164, 65, 0.22);
}
#${MOUNT_ID} .cf-word span { display: inline-block; will-change: transform; }
#${MOUNT_ID} .cf-tagline {
  position: absolute;
  bottom: 15%;
  z-index: 1;
  margin: 0;
  font-size: clamp(0.7rem, 1.7vw, 1.05rem);
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #b0b5c0;
}
#${MOUNT_ID} .cf-skip {
  position: absolute;
  bottom: 5%;
  z-index: 4;
  padding: 0.5rem 1.1rem;
  font: inherit;
  font-size: 0.8rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #b0b5c0;
  background: transparent;
  border: 1px solid #3a4150;
  border-radius: 2px;
  cursor: pointer;
}
#${MOUNT_ID} .cf-skip:hover { color: #e9e6dc; border-color: #8fc1ee; }
#${MOUNT_ID} .cf-skip:focus-visible { outline: 2px solid #8fc1ee; outline-offset: 2px; }

/* A struck flash along the rail at the moment of impact. */
#${MOUNT_ID} .cf-flash {
  position: absolute;
  top: 3.2%;
  left: 4%;
  right: 4%;
  height: 3px;
  z-index: 4;
  background: linear-gradient(to right, transparent, #f4eedb, transparent);
  opacity: 0;
}

/* ── Motion ──────────────────────────────────────────────────────────────── */
#${MOUNT_ID}[data-still='false'] .cf-crest { animation: cf-crest-fall 900ms cubic-bezier(0.5, 0, 0.9, 0.6) both; }
#${MOUNT_ID}[data-still='false'] .cf-flash { animation: cf-flash 420ms 880ms ease-out both; }
#${MOUNT_ID}[data-still='false'] .cf-ash { animation: cf-part-left 1100ms 900ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }
#${MOUNT_ID}[data-still='false'] .cf-ember { animation: cf-part-right 1100ms 900ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }
#${MOUNT_ID}[data-still='false'] .cf-word span { animation: cf-settle 620ms cubic-bezier(0.2, 1.5, 0.4, 1) both; }
#${MOUNT_ID}[data-still='false'] .cf-tagline { animation: cf-fade-up 700ms 1500ms ease-out both; }
#${MOUNT_ID}[data-still='false'] .cf-skip { animation: cf-fade-up 700ms 1900ms ease-out both; }
#${MOUNT_ID}[data-still='false'] .cf-stage { animation: cf-shake 260ms 880ms ease-out both; }

@keyframes cf-crest-fall {
  from { transform: translateY(-115%) rotate(-7deg); opacity: 0; }
  70% { opacity: 1; }
  to { transform: translateY(0) rotate(0deg); opacity: 1; }
}
@keyframes cf-flash {
  from { opacity: 0; transform: scaleX(0.2); }
  25% { opacity: 1; }
  to { opacity: 0; transform: scaleX(1); }
}
/*
 * The banners are thrown off the rail by the impact, not drawn aside. They fade
 * as they go: the stage is capped in width, so on a wide screen anything that
 * merely slides out of the frame would park in the margin instead of leaving.
 */
@keyframes cf-part-left {
  from { transform: translateX(0) rotate(0deg); opacity: 1; }
  55% { opacity: 1; }
  to { transform: translateX(-128%) rotate(-14deg); opacity: 0; }
}
@keyframes cf-part-right {
  from { transform: translateX(0) rotate(0deg); opacity: 1; }
  55% { opacity: 1; }
  to { transform: translateX(128%) rotate(14deg); opacity: 0; }
}
/* Each letter drops out of the impact and settles with weight. */
@keyframes cf-settle {
  from { transform: translateY(-0.5em); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@keyframes cf-fade-up {
  from { transform: translateY(0.6em); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@keyframes cf-shake {
  0% { transform: translate(0, 0); }
  20% { transform: translate(-0.5%, 0.9%); }
  45% { transform: translate(0.4%, -0.6%); }
  70% { transform: translate(-0.25%, 0.3%); }
  100% { transform: translate(0, 0); }
}

/*
 * Still presentation: nothing animates, so the banners would simply sit closed
 * over the title they exist to reveal. They are dropped entirely and the card
 * is presented already open.
 */
#${MOUNT_ID}[data-still='true'] .cf-banner { display: none; }

@media (prefers-reduced-motion: reduce) {
  #${MOUNT_ID} * { animation: none !important; }
  #${MOUNT_ID} .cf-banner { display: none; }
}
`;

/**
 * Ash heraldry: a winged spear, borne dark on a pale field. High-value, so it
 * still reads as the light faction in greyscale.
 */
const ASH_MARK = `
<svg viewBox="0 0 200 200" aria-hidden="true">
  <g fill="#22201c">
    <path d="M100 14 L110 30 L100 26 L90 30 Z"/>
    <path d="M96 26 H104 L106 176 L100 188 L94 176 Z"/>
    <path d="M92 60 L34 34 L44 70 L90 84 Z"/>
    <path d="M92 96 L28 78 L40 112 L90 120 Z"/>
    <path d="M92 132 L38 122 L50 150 L90 154 Z"/>
    <path d="M108 60 L166 34 L156 70 L110 84 Z"/>
    <path d="M108 96 L172 78 L160 112 L110 120 Z"/>
    <path d="M108 132 L162 122 L150 150 L110 154 Z"/>
  </g>
</svg>`;

/**
 * Ember heraldry: a wolf's head, borne in accent on a charred field. The wolf
 * is already in the cast's vocabulary (the berserkr wears the pelt), and a
 * frontal mask is a wholly different silhouette from the ash wing — the two
 * marks must never read as a mirrored pair.
 */
const EMBER_MARK = `
<svg viewBox="0 0 200 200" aria-hidden="true">
  <g fill="#d9a441">
    <path d="M38 26 L74 76 L30 72 Z"/>
    <path d="M162 26 L126 76 L170 72 Z"/>
    <path d="M30 72 L100 54 L170 72 L160 122 L126 162 L100 178 L74 162 L40 122 Z"/>
  </g>
  <g fill="#17120f">
    <path d="M60 98 L88 92 L86 112 L58 108 Z"/>
    <path d="M140 98 L112 92 L114 112 L142 108 Z"/>
    <path d="M86 126 H114 L108 146 H92 Z"/>
    <path d="M100 172 L112 152 H88 Z"/>
  </g>
</svg>`;

/** The helm crest that falls: an angular comb, struck flat at the base. */
const CREST = `
<svg viewBox="0 0 160 120" aria-hidden="true">
  <g fill="#dfe6ec">
    <path d="M80 0 L96 40 L80 34 L64 40 Z"/>
    <path d="M52 16 L64 46 L52 42 L40 48 Z"/>
    <path d="M108 16 L120 48 L108 42 L96 46 Z"/>
    <path d="M28 40 L40 62 L28 60 L18 66 Z"/>
    <path d="M132 40 L142 66 L132 60 L120 62 Z"/>
  </g>
  <path d="M14 70 H146 L138 86 H22 Z" fill="#8b8577"/>
  <path d="M22 86 H138 L132 96 H28 Z" fill="#3a4150"/>
</svg>`;

const TITLE = 'CRESTFALL';
const TAGLINE = 'Chess where every capture is a duel';

/** Build, mount and drive the splash. Returns a function that dismisses it. */
export function showSplash(doc: Document = document): () => void {
  if (doc.getElementById(MOUNT_ID)) return () => {};

  const still = wantsStillSplash(
    (() => {
      try {
        return doc.defaultView?.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? null;
      } catch {
        return null; // private mode, blocked storage — the OS preference stands
      }
    })(),
    doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false,
  );

  const style = doc.createElement('style');
  style.textContent = CSS;
  doc.head.append(style);

  const root = doc.createElement('div');
  root.id = MOUNT_ID;
  root.dataset.still = String(still);
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', `${TITLE}. ${TAGLINE}.`);

  // Letters are individually wrapped so the wordmark can settle in sequence.
  const letters = [...TITLE]
    .map((ch, i) => {
      const delay = still ? 0 : 980 + i * 55;
      return `<span style="animation-delay:${delay}ms">${ch}</span>`;
    })
    .join('');

  root.innerHTML = `
    <div class="cf-stage">
      <div class="cf-frame"></div>
      <h1 class="cf-word">${letters}</h1>
      <div class="cf-banner cf-ash"><div class="cf-mark">${ASH_MARK}</div></div>
      <div class="cf-banner cf-ember"><div class="cf-mark">${EMBER_MARK}</div></div>
      <div class="cf-rail"></div>
      <div class="cf-crest">${CREST}</div>
      <div class="cf-flash"></div>
      <p class="cf-tagline">${TAGLINE}</p>
      <button type="button" class="cf-skip">Enter</button>
    </div>`;

  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const dismiss = (): void => {
    if (done) return;
    done = true;
    if (timer !== undefined) clearTimeout(timer);
    doc.removeEventListener('keydown', onKey);
    root.removeEventListener('pointerdown', dismiss);
    root.dataset.leaving = 'true';
    // Let the app have the pointer back immediately, even mid-fade.
    root.style.pointerEvents = 'none';
    const remove = (): void => {
      root.remove();
      style.remove();
      // Anything that wants to start on the first gesture (the audio graph
      // needs one) can listen for this instead of reaching in here.
      doc.dispatchEvent(new CustomEvent('crestfall:splash-dismissed'));
    };
    if (still) remove();
    else setTimeout(remove, FADE);
  };

  function onKey(e: KeyboardEvent): void {
    // Let the skip button handle its own activation keys.
    if (e.key === 'Tab') return;
    dismiss();
  }

  root.querySelector('.cf-skip')?.addEventListener('click', dismiss);
  root.addEventListener('pointerdown', dismiss);
  doc.addEventListener('keydown', onKey);

  doc.body.append(root);
  (root.querySelector('.cf-skip') as HTMLElement | null)?.focus();
  timer = setTimeout(dismiss, still ? 1200 : DWELL);

  return dismiss;
}

// Side-effect entry: mount as soon as the document can take it.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => showSplash(), { once: true });
  } else {
    showSplash();
  }
}
