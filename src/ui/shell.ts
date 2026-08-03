/**
 * Shell screens: the floating main menu the player lands on after the splash,
 * plus credits, settings and help.
 *
 * Self-contained for the same reason splash.ts is — the styles are injected
 * here instead of added to ui/style.css, so the shell cannot break the in-game
 * panel it floats over, and the two can be edited independently.
 *
 * The shell only issues commands (newGame via onStartGame, settings.set) and
 * reads the SettingsStore. It keeps no copy of anything the store already owns,
 * so every control re-reads on render and can never drift out of step.
 */

import type { AiTier, Color, GameMode, NewGameOptions, Settings } from '../core/contract.ts';
import { button, el } from './dom.ts';
import type { SettingsStore } from './settings.ts';

export type ShellScreen = 'menu' | 'new' | 'credits' | 'settings' | 'help';

/**
 * Mute is derived state, not stored state: `masterVolume === 0` IS muted, so
 * the toggle and the volume slider can never disagree. Integration owns the
 * remembered pre-mute level.
 */
export interface ShellAudio {
  isMuted(): boolean;
  setMuted(muted: boolean): void;
}

export interface ShellDeps {
  settings: SettingsStore;
  audio: ShellAudio;
  /** Start a game with these options and hand the screen back to the board. */
  onStartGame(opts: NewGameOptions): void;
  /** Menu opened/closed, so integration can hide or show the in-game panel. */
  onVisibilityChange(open: boolean): void;
  /** True once a game is running — gates "Continuar" and Esc-to-close. */
  hasGame(): boolean;
}

export interface ShellHandle {
  open(screen?: ShellScreen): void;
  close(): void;
  dispose(): void;
}

const ROOT_ID = 'cf-shell';
const BAR_ID = 'cf-shell-bar';

const MODES: { value: GameMode; label: string; hint: string }[] = [
  {
    value: 'hotseat',
    label: 'Two players',
    hint: 'Both sides play on this device, taking turns.',
  },
  {
    value: 'vs-ai',
    label: 'Versus the AI',
    hint: 'You play one side; the AI answers at the level you pick.',
  },
  {
    value: 'attract',
    label: 'Demonstration',
    hint: 'The AI plays both sides — good for watching the duels.',
  },
];

const TIERS: { value: AiTier; label: string }[] = [
  { value: 'thrall', label: 'Thrall — easy' },
  { value: 'karl', label: 'Karl — normal' },
  { value: 'jarl', label: 'Jarl — hard' },
  { value: 'konungr', label: 'Konungr — very hard' },
];

const SIDES: { value: Color; label: string }[] = [
  { value: 'w', label: 'Ash (light)' },
  { value: 'b', label: 'Ember (dark)' },
];

const DEPENDENCIES: [string, string, string][] = [
  ['three.js', 'MIT', 'Rendering'],
  ['vite', 'MIT', 'Build tooling'],
  ['vitest', 'MIT', 'Tests'],
  ['typescript', 'Apache-2.0', 'Language tooling'],
];

/** In-game controls, explained. Keyed by the label the toolbar renders. */
const HELP_CONTROLS: [string, string][] = [
  ['New game', 'Starts another game: pick the type, the AI level and your side.'],
  ['Undo', 'Takes back the last move. Against the AI it takes back the pair, returning the turn to you.'],
  ['Redo', 'Replays a move you took back.'],
  [
    'View: 3D / 2D',
    'Switches between the perspective board and a top-down view. In 2D, duels are replaced by a short emblem vignette.',
  ],
  [
    'Duel speed',
    '1× is normal, 2× is faster, and Instant resolves the capture with no animation at all.',
  ],
  [
    'Duels for first',
    'Animates duels only for the first N moves of the game. After that, captures resolve straight away.',
  ],
  ['FEN…', 'Copies or loads a single position in FEN format.'],
  ['PGN…', 'Copies or loads a whole game in PGN format.'],
  ['Master / Music / Effects', 'Overall, soundtrack and effects volume. Zeroing the master is the same as "No sound".'],
];

const HELP_BOARD: [string, string][] = [
  ['Click', 'Click a piece to select it, then the destination square to move.'],
  ['Drag', 'Drag with the button held to orbit the camera in 3D.'],
  ['Arrows + Enter', 'Move the cursor across the board and confirm, without a mouse.'],
  ['Space', 'Skips the duel playing now and resolves the capture immediately.'],
  ['Esc', 'Cancels the current selection. In the menu, steps back one screen.'],
];

/** Tooltips for the in-game toolbar, matched on the labels it renders. */
const TOOLTIPS: [string, string][] = [
  ['New game', 'Start another game (type, AI level and side)'],
  ['Undo', 'Take back the last move'],
  ['Redo', 'Replay the move you took back'],
  ['View:', 'Switch between the 3D board and the top-down 2D view'],
  ['Duel speed:', 'Duel speed: 1×, 2× or instant'],
  ['FEN', 'Copy or load a position (FEN)'],
  ['PGN', 'Copy or load the game (PGN)'],
];

/**
 * Every colour here is lifted from something already on screen, so the shell
 * reads as part of the game rather than as a web page laid over it:
 *   void/ground  — stage.ts BOARD_FOG_COLOR and the ground plane
 *   oak/iron     — the board slab and the splash rail
 *   bone/parchment — the ash faction's bone and banner tones (materials.ts)
 *   gold         — the crest and the splash wordmark glow
 * Fonts are system stacks only: the perf budget forbids asset files and
 * CREDITS.md promises no fonts beyond system defaults. An old-style serif
 * carries the display type; the UI sans keeps the controls legible.
 */
const CSS = `
#${ROOT_ID} {
  --cf-void: #0b0e14;
  --cf-oak: #241c15;
  --cf-iron: #3a4150;
  --cf-bone: #efe8d4;
  --cf-parchment: #a9a294;
  --cf-gold: #d9a441;
  --cf-focus: #8fc1ee;
  --cf-display: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua",
    "Hoefler Text", Georgia, "Times New Roman", serif;
  --cf-ui: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;

  position: fixed;
  inset: 0;
  z-index: 8000;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  color-scheme: dark;
  font-family: var(--cf-ui);
  color: var(--cf-bone);
  background: radial-gradient(ellipse at 50% 40%, rgba(27,30,37,0.66) 0%, rgba(11,14,20,0.94) 72%);
}
#${ROOT_ID}[hidden] { display: none; }

#${ROOT_ID} .cf-shell-panel {
  position: relative;
  width: min(560px, 100%);
  max-height: min(86dvh, 760px);
  overflow-y: auto;
  padding: 1.7rem 1.85rem 1.85rem;
  border: 1px solid var(--cf-iron);
  border-radius: 4px;
  background:
    linear-gradient(180deg, #1e1b16 0%, #141310 100%);
  box-shadow:
    0 28px 74px rgba(0,0,0,0.68),
    inset 0 0 0 1px rgba(239,232,212,0.045),
    inset 0 40px 90px rgba(217,164,65,0.035);
  backdrop-filter: blur(9px);
  animation: cf-shell-float 620ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
/* The gilt rail across the head, echoing the splash's wordmark underline. */
#${ROOT_ID} .cf-shell-panel::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 2px;
  background: linear-gradient(to right, transparent, var(--cf-gold), transparent);
  opacity: 0.6;
}
@keyframes cf-shell-float {
  from { opacity: 0; transform: translateY(14px) scale(0.985); }
  to   { opacity: 1; transform: none; }
}

#${ROOT_ID} h1 {
  margin: 0 0 0.2rem;
  font-family: var(--cf-display);
  font-size: clamp(2rem, 4.6vw, 2.7rem);
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--cf-bone);
  text-shadow: 0 2px 0 var(--cf-void), 0 0 30px rgba(217,164,65,0.2);
}
#${ROOT_ID} .cf-shell-sub {
  margin: 0 0 1.5rem;
  font-family: var(--cf-display);
  font-style: italic;
  color: var(--cf-parchment);
  font-size: 0.95rem;
  letter-spacing: 0.02em;
}
#${ROOT_ID} h2 {
  margin: 0 0 1.2rem;
  padding-bottom: 0.55rem;
  border-bottom: 1px solid rgba(239,232,212,0.1);
  font-family: var(--cf-display);
  font-size: 1.45rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--cf-bone);
}
#${ROOT_ID} h3 {
  margin: 1.5rem 0 0.55rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.17em;
  text-transform: uppercase;
  color: var(--cf-gold);
}
#${ROOT_ID} h3:first-of-type { margin-top: 0; }
#${ROOT_ID} p {
  margin: 0 0 0.7rem;
  line-height: 1.55;
  font-size: 0.9rem;
  color: var(--cf-parchment);
}

#${ROOT_ID} .cf-shell-nav { display: flex; flex-direction: column; gap: 0.45rem; }
#${ROOT_ID} .cf-shell-nav button {
  width: 100%;
  padding: 0.8rem 1.05rem;
  font-family: var(--cf-display);
  font-size: 1.12rem;
  font-weight: 600;
  text-align: left;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  background: linear-gradient(180deg, rgba(239,232,212,0.045), rgba(239,232,212,0.015));
}
#${ROOT_ID} .cf-shell-nav button:hover {
  background: linear-gradient(180deg, rgba(217,164,65,0.14), rgba(217,164,65,0.05));
  border-color: rgba(217,164,65,0.5);
}
#${ROOT_ID} .cf-shell-nav button.cf-primary {
  border-color: var(--cf-gold);
  color: #f7ecd2;
  background: linear-gradient(180deg, rgba(217,164,65,0.2), rgba(217,164,65,0.07));
}

#${ROOT_ID} button, #${BAR_ID} button {
  font-family: var(--cf-ui);
  font-size: 0.9rem;
  color: var(--cf-bone);
  background: var(--cf-oak);
  border: 1px solid var(--cf-iron);
  border-radius: 3px;
  padding: 0.45rem 0.85rem;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
#${ROOT_ID} button:hover, #${BAR_ID} button:hover { background: #2f2519; border-color: #4a5263; }
#${ROOT_ID} :focus-visible, #${BAR_ID} :focus-visible {
  outline: 3px solid var(--cf-focus);
  outline-offset: 2px;
}

#${ROOT_ID} fieldset {
  margin: 0 0 1.2rem;
  padding: 0;
  border: 0;
}
#${ROOT_ID} legend {
  padding: 0;
  margin-bottom: 0.5rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.17em;
  text-transform: uppercase;
  color: var(--cf-gold);
}
#${ROOT_ID} fieldset:disabled { opacity: 0.42; }

#${ROOT_ID} .cf-shell-choice {
  display: flex;
  gap: 0.65rem;
  align-items: flex-start;
  padding: 0.55rem 0.7rem;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.94rem;
}
#${ROOT_ID} .cf-shell-choice:hover {
  background: rgba(239,232,212,0.045);
  border-color: rgba(239,232,212,0.09);
}
#${ROOT_ID} .cf-shell-choice input { margin-top: 0.25rem; accent-color: var(--cf-gold); }
#${ROOT_ID} .cf-shell-choice span { display: block; }
#${ROOT_ID} .cf-shell-hint {
  color: var(--cf-parchment);
  font-size: 0.82rem;
  line-height: 1.45;
  margin-top: 0.15rem;
}

#${ROOT_ID} .cf-shell-row {
  display: flex;
  gap: 0.9rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 0;
  font-size: 0.94rem;
}
#${ROOT_ID} .cf-shell-row + .cf-shell-row { border-top: 1px solid rgba(239,232,212,0.07); }
#${ROOT_ID} .cf-shell-row select, #${ROOT_ID} .cf-shell-row input[type='range'] {
  font-family: var(--cf-ui);
  font-size: 0.88rem;
  min-width: 160px;
  color: var(--cf-bone);
  background: #191510;
  border: 1px solid var(--cf-iron);
  border-radius: 3px;
  padding: 0.32rem 0.45rem;
  accent-color: var(--cf-gold);
}
#${ROOT_ID} .cf-shell-row input[type='checkbox'] {
  width: 1.15rem;
  height: 1.15rem;
  accent-color: var(--cf-gold);
}

#${ROOT_ID} .cf-shell-actions {
  display: flex;
  gap: 0.6rem;
  margin-top: 1.5rem;
}
#${ROOT_ID} .cf-shell-actions button {
  flex: 1 1 auto;
  font-family: var(--cf-display);
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.62rem 1rem;
}
#${ROOT_ID} .cf-shell-actions button.cf-primary {
  border-color: var(--cf-gold);
  color: #f7ecd2;
  background: linear-gradient(180deg, rgba(217,164,65,0.22), rgba(217,164,65,0.08));
}

#${ROOT_ID} dl { margin: 0; font-size: 0.89rem; }
#${ROOT_ID} dt {
  font-weight: 700;
  color: var(--cf-bone);
  margin-top: 0.8rem;
  letter-spacing: 0.01em;
}
#${ROOT_ID} dd { margin: 0.16rem 0 0; color: var(--cf-parchment); line-height: 1.5; }
#${ROOT_ID} .cf-shell-credit {
  font-family: var(--cf-display);
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--cf-bone);
  letter-spacing: 0.06em;
}
#${ROOT_ID} table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
#${ROOT_ID} th, #${ROOT_ID} td {
  text-align: left;
  padding: 0.38rem 0.5rem 0.38rem 0;
  border-bottom: 1px solid rgba(239,232,212,0.08);
  color: var(--cf-parchment);
}
#${ROOT_ID} td:first-child { color: var(--cf-bone); }
#${ROOT_ID} th {
  color: #8b8577;
  font-weight: 600;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

#${BAR_ID} {
  position: fixed;
  top: 0.85rem;
  left: 0.85rem;
  z-index: 7000;
  display: flex;
  gap: 0.4rem;
}
#${BAR_ID}[hidden] { display: none; }
#${BAR_ID} button { background: rgba(36,28,21,0.88); backdrop-filter: blur(6px); }

@media (prefers-reduced-motion: reduce) {
  #${ROOT_ID} .cf-shell-panel { animation: none; }
  #${ROOT_ID} button, #${BAR_ID} button { transition: none; }
}
`;

function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

/**
 * Explain the in-game toolbar in place. Matched on the labels the UI module
 * renders, so an unmatched control is left alone rather than mislabelled.
 */
export function applyToolbarTooltips(mount: HTMLElement): void {
  for (const control of mount.querySelectorAll('button, select')) {
    const text = control.textContent ?? '';
    const hit = TOOLTIPS.find(([label]) => text.startsWith(label));
    if (hit && !control.getAttribute('title')) control.setAttribute('title', hit[1]);
  }
  const duels = mount.querySelector('#cf-duels');
  duels?.setAttribute('title', 'Animate duels only for the first N moves of the game');
  for (const [id, tip] of [
    ['cf-vol-master', 'Overall volume — at 0 the game is silent'],
    ['cf-vol-music', 'Soundtrack volume'],
    ['cf-vol-sfx', 'Effects and duel volume'],
  ] as const) {
    mount.querySelector(`#${id}`)?.setAttribute('title', tip);
  }
}

export function createShell(deps: ShellDeps): ShellHandle {
  const { settings, audio } = deps;

  const style = el('style', {}, [CSS]);
  document.head.append(style);

  const body = el('div', { class: 'cf-shell-body' });
  const panel = el(
    'div',
    {
      class: 'cf-shell-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'cf-shell-title',
    },
    [body],
  );
  const root = el('div', { id: ROOT_ID }, [panel]);
  root.hidden = true;

  const menuBtn = button('☰ Menu', () => open('menu'), { title: 'Open the main menu' });
  const helpBtn = button('? Help', () => open('help'), {
    title: 'Explains every option on the control bar',
  });
  const bar = el('div', { id: BAR_ID }, [menuBtn, helpBtn]);
  bar.hidden = true;

  document.body.append(root, bar);

  let screen: ShellScreen = 'menu';

  // ── Small builders ────────────────────────────────────────────────────────

  function title(text: string, sub?: string): Node[] {
    const nodes: Node[] = [el('h1', { id: 'cf-shell-title' }, [text])];
    if (sub) nodes.push(el('p', { class: 'cf-shell-sub' }, [sub]));
    return nodes;
  }

  function heading(text: string): HTMLElement {
    return el('h2', { id: 'cf-shell-title' }, [text]);
  }

  function choice(
    name: string,
    value: string,
    label: string,
    hint: string | undefined,
    checked: boolean,
    onPick: () => void,
  ): { wrap: HTMLElement; input: HTMLInputElement } {
    const input = el('input', { type: 'radio', name, value });
    input.checked = checked;
    input.addEventListener('change', onPick);
    const text: (Node | string)[] = [el('span', {}, [label])];
    if (hint) text.push(el('span', { class: 'cf-shell-hint' }, [hint]));
    return {
      wrap: el('label', { class: 'cf-shell-choice' }, [input, el('span', {}, text)]),
      input,
    };
  }

  function row(label: string, control: HTMLElement, id: string): HTMLElement {
    control.id = id;
    return el('div', { class: 'cf-shell-row' }, [el('label', { for: id }, [label]), control]);
  }

  function checkboxRow(
    label: string,
    checked: boolean,
    onToggle: (v: boolean) => void,
    id: string,
  ): HTMLElement {
    const input = el('input', { type: 'checkbox' });
    input.checked = checked;
    input.addEventListener('change', () => onToggle(input.checked));
    return row(label, input, id);
  }

  function selectRow<T extends string>(
    label: string,
    options: { value: T; label: string }[],
    current: T,
    onPick: (v: T) => void,
    id: string,
  ): HTMLElement {
    const sel = el('select', {});
    for (const o of options) sel.append(el('option', { value: o.value }, [o.label]));
    sel.value = current;
    sel.addEventListener('change', () => onPick(sel.value as T));
    return row(label, sel, id);
  }

  function sliderRow(
    label: string,
    value: number,
    onInput: (v: number) => void,
    id: string,
  ): HTMLElement {
    const input = el('input', { type: 'range', min: '0', max: '1', step: '0.05' });
    input.value = String(value);
    input.addEventListener('input', () => onInput(Number(input.value)));
    return row(label, input, id);
  }

  function actions(...buttons: HTMLElement[]): HTMLElement {
    return el('div', { class: 'cf-shell-actions' }, buttons);
  }

  function definitions(entries: [string, string][]): HTMLElement {
    const dl = el('dl', {});
    for (const [term, desc] of entries) {
      dl.append(el('dt', {}, [term]), el('dd', {}, [desc]));
    }
    return dl;
  }

  function backButton(): HTMLButtonElement {
    return button('Back', () => open('menu'));
  }

  // ── Screens ───────────────────────────────────────────────────────────────

  function renderMenu(): void {
    const nav = el('div', { class: 'cf-shell-nav' });
    if (deps.hasGame()) {
      nav.append(button('Continue game', close, { class: 'cf-primary' }));
    }
    nav.append(
      button('New game', () => open('new'), deps.hasGame() ? {} : { class: 'cf-primary' }),
      button('Credits', () => open('credits')),
      button('Settings', () => open('settings')),
      button('Help', () => open('help')),
    );
    body.append(
      ...title('Crestfall', 'Chess where every capture is a duel'),
      nav,
      el('div', { class: 'cf-shell-row' }, [
        el('label', { for: 'cf-shell-mute' }, ['No sound']),
        (() => {
          const input = el('input', { type: 'checkbox', id: 'cf-shell-mute' });
          input.checked = audio.isMuted();
          input.addEventListener('change', () => audio.setMuted(input.checked));
          return input;
        })(),
      ]),
    );
  }

  function renderNewGame(): void {
    let mode: GameMode = 'hotseat';
    let tier: AiTier = 'karl';
    let side: Color = 'w';

    const aiFields = el('fieldset', {}, []) as HTMLFieldSetElement;
    const syncAi = (): void => {
      aiFields.disabled = mode !== 'vs-ai';
    };

    const modeFields = el('fieldset', {}, [el('legend', {}, ['Game type'])]);
    for (const m of MODES) {
      modeFields.append(
        choice('cf-shell-mode', m.value, m.label, m.hint, m.value === mode, () => {
          mode = m.value;
          syncAi();
        }).wrap,
      );
    }

    aiFields.append(
      el('legend', {}, ['Opponent']),
      selectRow(
        'AI level',
        TIERS,
        tier,
        (v) => {
          tier = v;
        },
        'cf-shell-tier',
      ),
    );
    const sideWrap = el('div', {}, []);
    for (const sd of SIDES) {
      sideWrap.append(
        choice('cf-shell-side', sd.value, sd.label, undefined, sd.value === side, () => {
          side = sd.value;
        }).wrap,
      );
    }
    aiFields.append(el('div', { class: 'cf-shell-row' }, [el('span', {}, ['You play'])]), sideWrap);
    syncAi();

    body.append(
      heading('New game'),
      modeFields,
      aiFields,
      actions(
        button(
          'Start',
          () => {
            const opts: NewGameOptions = { mode, seed: randomSeed() };
            if (mode === 'vs-ai') {
              opts.aiTier = tier;
              opts.humanColor = side;
            }
            deps.onStartGame(opts);
            close();
          },
          { class: 'cf-primary' },
        ),
        backButton(),
      ),
    );
  }

  function renderCredits(): void {
    const table = el('table', {}, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['Dependency']),
          el('th', {}, ['Licence']),
          el('th', {}, ['Use']),
        ]),
      ]),
    ]);
    const tbody = el('tbody', {});
    for (const [name, licence, use] of DEPENDENCIES) {
      tbody.append(el('tr', {}, [el('td', {}, [name]), el('td', {}, [licence]), el('td', {}, [use])]));
    }
    table.append(tbody);

    body.append(
      heading('Credits'),
      el('h3', {}, ['Creative direction and code']),
      el('p', { class: 'cf-shell-credit' }, ['Jackson Mafra']),
      el('h3', {}, ['About the work']),
      el('p', {}, [
        'All code, art direction, character design, duel choreography and audio ' +
          'synthesis are original works created for this project.',
      ]),
      el('h3', {}, ['Third-party software']),
      table,
      el('p', {}, [
        'No third-party models, textures, audio samples, fonts beyond system ' +
          'defaults, or opening books. All geometry is constructed procedurally at ' +
          'runtime and all audio is synthesized via WebAudio.',
      ]),
      actions(backButton()),
    );
  }

  function renderSettings(): void {
    const s: Settings = settings.get();
    const speeds: { value: string; label: string }[] = [
      { value: '1', label: '1× — normal' },
      { value: '2', label: '2× — fast' },
      { value: '0', label: 'Instant — no animation' },
    ];
    const firstN: { value: string; label: string }[] = [
      { value: '10', label: 'First 10 moves' },
      { value: '20', label: 'First 20 moves' },
      { value: '40', label: 'First 40 moves' },
      { value: 'always', label: 'Always' },
    ];

    body.append(
      heading('Settings'),
      el('h3', {}, ['Sound']),
      checkboxRow('No sound', audio.isMuted(), (v) => {
        audio.setMuted(v);
        render();
      }, 'cf-shell-set-mute'),
      sliderRow('Master volume', s.masterVolume, (v) => settings.set({ masterVolume: v }), 'cf-shell-vol-master'),
      sliderRow('Soundtrack', s.musicVolume, (v) => settings.set({ musicVolume: v }), 'cf-shell-vol-music'),
      sliderRow('Effects', s.sfxVolume, (v) => settings.set({ sfxVolume: v }), 'cf-shell-vol-sfx'),
      el('h3', {}, ['Presentation']),
      selectRow(
        'View',
        [
          { value: '3d', label: '3D — perspective board' },
          { value: '2d', label: '2D — top-down' },
        ],
        s.viewMode,
        (v) => settings.set({ viewMode: v }),
        'cf-shell-view',
      ),
      selectRow(
        'Duel speed',
        speeds,
        String(s.duelSpeed),
        (v) => settings.set({ duelSpeed: Number(v) as Settings['duelSpeed'] }),
        'cf-shell-speed',
      ),
      selectRow(
        'Animate duels for',
        firstN,
        s.duelsFirstNMoves === Infinity ? 'always' : String(s.duelsFirstNMoves),
        (v) => settings.set({ duelsFirstNMoves: v === 'always' ? Infinity : Number(v) }),
        'cf-shell-firstn',
      ),
      checkboxRow(
        'Reduced motion',
        s.reducedMotion,
        (v) => settings.set({ reducedMotion: v }),
        'cf-shell-reduced',
      ),
      el('p', {}, [
        'Reduced motion resolves duels instantly and drops the camera shake. It ' +
          'applies to the title splash too.',
      ]),
      actions(backButton()),
    );
  }

  function renderHelp(): void {
    body.append(
      heading('Help'),
      el('h3', {}, ['Control bar']),
      definitions(HELP_CONTROLS),
      el('h3', {}, ['Board']),
      definitions(HELP_BOARD),
      el('h3', {}, ['About the duels']),
      el('p', {}, [
        'Every capture becomes a duel between the two pieces. The outcome never ' +
          'changes: the capture is already resolved before the first frame plays, ' +
          'so skipping or speeding up a duel cannot alter the game.',
      ]),
      actions(backButton()),
    );
  }

  const SCREENS: Record<ShellScreen, () => void> = {
    menu: renderMenu,
    new: renderNewGame,
    credits: renderCredits,
    settings: renderSettings,
    help: renderHelp,
  };

  function render(): void {
    body.replaceChildren();
    SCREENS[screen]();
    const first = panel.querySelector<HTMLElement>(
      'button, select, input:not([type="hidden"])',
    );
    // preventScroll matters on the long screens: focusing normally scrolls the
    // control into view and the heading disappears above the fold.
    first?.focus({ preventScroll: true });
    panel.scrollTop = 0;
  }

  // ── Visibility ────────────────────────────────────────────────────────────

  function open(next: ShellScreen = 'menu'): void {
    const wasOpen = !root.hidden;
    screen = next;
    root.hidden = false;
    bar.hidden = true;
    render();
    if (!wasOpen) deps.onVisibilityChange(true);
  }

  function close(): void {
    if (root.hidden) return;
    root.hidden = true;
    bar.hidden = !deps.hasGame();
    deps.onVisibilityChange(false);
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || root.hidden) return;
    // Escape steps back one screen, and only leaves the menu if there is a
    // game to go back to — otherwise there would be nothing on screen.
    if (screen !== 'menu') open('menu');
    else if (deps.hasGame()) close();
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKeyDown);

  return {
    open,
    close,
    dispose(): void {
      document.removeEventListener('keydown', onKeyDown);
      root.remove();
      bar.remove();
      style.remove();
    },
  };
}
