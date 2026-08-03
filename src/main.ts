/**
 * Integration boot — the one module that owns the app shell and wires the
 * others together. Pure glue: no rules, no choreography, no state of its own
 * beyond pointer selection and the duels currently on screen.
 *
 * Load-bearing ordering (docs/ARCHITECTURE.md):
 * - GameController is the only writer of game state. This file forwards
 *   commands and consumes events; it never touches a position.
 * - The board syncs from the event BEFORE any duel plays, so a skipped,
 *   interrupted, or missing duel can never desync the scene.
 * - Duels animate throwaway rigs on an overlay layer rather than the board
 *   rigs: duel scripts write `rig.root.position` in world space, while board
 *   rigs sit under per-square anchors (src/duels/rows/support.ts).
 */

import type { Object3D } from 'three';
import { Group } from 'three';

import { createAiPort } from './ai/index.ts';
import { AudioEngine } from './audio/engine.ts';
import { buildCharacter } from './chars/index.ts';
import type {
  Color,
  GameApi,
  GameEvent,
  MoveRecord,
  NewGameOptions,
  PieceType,
  Square,
} from './core/contract.ts';
import { PIECE_CHARACTER } from './core/contract.ts';
import type { CharacterRig, DuelScript } from './core/stage.ts';
import { DuelDirector } from './duels/director.ts';
import type { DuelHandle } from './duels/director.ts';
import { VIGNETTE_2D } from './duels/vignette2d.ts';
import { GameController } from './game/controller.ts';
import type { AiPort } from './game/controller.ts';
import { loadNetConfig } from './net/config.ts';
import type { NetConfig } from './net/config.ts';
import { createOpponentPort } from './net/opponentPort.ts';
import { codeFromSearch, inviteLink } from './net/protocol.ts';
// Type-only: the Supabase client is ~230 kB and would otherwise sit in the
// initial payload for every player, including those who never open a challenge.
// The module is imported for real in openSession().
import type { ChallengeSession } from './net/session.ts';
import { squareToWorld } from './render/boardMath.ts';
import { Stage } from './render/stage.ts';
import { createUI } from './ui/index.ts';
import type { UIHandle } from './ui/index.ts';
import { SettingsStore } from './ui/settings.ts';
import { SHELL_BAR_ID, createShell, decorateToolbar } from './ui/shell.ts';
import type { GameOverSummary } from './ui/shell.ts';

const FACTION = { w: 'ash', b: 'ember' } as const;

/** Longest frame we integrate; a backgrounded tab must not fast-forward duels. */
const MAX_FRAME_SECONDS = 0.05;

/**
 * "Sem som" is derived from `masterVolume === 0` rather than a new Settings
 * field, because src/core is frozen and the audio engine already honours the
 * volume. Only the level to come back to needs remembering, and it is not game
 * state, so it lives beside the settings rather than inside them.
 */
const PREMUTE_KEY = 'crestfall.premuteMaster';
const DEFAULT_UNMUTE_VOLUME = 0.8;

/** The splash mounts itself from index.html; this is the element it uses. */
const SPLASH_ID = 'cf-splash';
const SPLASH_DISMISSED = 'crestfall:splash-dismissed';

/**
 * The app shell. `src/ui/style.css` deliberately scopes itself to `.cf-ui`, so
 * the page-level layout (which is integration's business, not the UI agent's)
 * lives here next to the markup contract in index.html.
 */
const SHELL_CSS = `
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
   transparent to pointer events and only its actual controls opt back in. */
#ui-root { position: fixed; inset: 0; pointer-events: none; z-index: 100; }
#ui-root > * { pointer-events: auto; }

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
#ui-root .cf-banner {
  margin: 0;
  border-left-width: 3px;
  white-space: nowrap;
  font-size: 0.85rem;
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

/**
 * The 3D duel matrix is pulled in lazily and tolerantly. A row that fails to
 * load must cost us the choreography for those pairings, not the whole app —
 * captures still resolve, they just resolve without a duel.
 */
type PickDuel = (
  seed: number,
  moveIndex: number,
  attacker: PieceType,
  victim: PieceType,
) => DuelScript | undefined;

let pickDuel: PickDuel | null = null;
void import('./duels/index.ts')
  .then((m) => {
    pickDuel = m.pickDuel;
  })
  .catch((err: unknown) => {
    console.warn(
      'Duel matrix unavailable — captures will resolve without choreography.',
      err,
    );
  });

function requireEl<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing required element: ${selector}`);
  return found;
}

function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

/**
 * Duel rigs need a parent whose local space IS world space. Stage keeps its
 * pieces under per-square anchors inside a layer group that sits at the origin,
 * so that layer qualifies — it is the one thing this file reaches for through
 * the scene graph instead of a Stage method. Swap this for a real accessor if
 * Stage ever grows one.
 */
function findWorldLayer(stage: Stage): Object3D | null {
  for (let sq = 0; sq < 64; sq++) {
    // rig root → square anchor → piece layer.
    const layer = stage.getRigAt(sq)?.root.parent?.parent;
    if (layer) return layer;
  }
  return null;
}

/**
 * Ask the device for landscape. Browsers only honour an orientation lock while
 * fullscreen, and only from a user gesture, so this is called from the button
 * that starts a game and is best-effort throughout: if any step is refused the
 * CSS rotate prompt covers it. Desktop is left alone — nobody wants a browser
 * yanked into fullscreen by a chess game.
 */
function requestLandscape(): void {
  if (!matchMedia('(pointer: coarse)').matches) return;
  const root = document.documentElement;
  if (!root.requestFullscreen || document.fullscreenElement) return;
  root
    .requestFullscreen()
    .then(() => {
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      return orientation?.lock?.('landscape');
    })
    .catch(() => {
      /* refused — the rotate prompt asks the player instead */
    });
}

function mountRotatePrompt(): void {
  const prompt = document.createElement('div');
  prompt.id = 'cf-rotate';
  prompt.append(
    Object.assign(document.createElement('div'), {
      className: 'cf-rotate-glyph',
      ariaHidden: 'true',
    }),
    Object.assign(document.createElement('strong'), { textContent: 'Rotate your device' }),
    Object.assign(document.createElement('span'), {
      textContent: 'Crestfall plays in landscape — the board is square, and it needs the width.',
    }),
  );
  document.body.append(prompt);
}

const SIDE_LABEL: Record<Color, string> = { w: 'Ash', b: 'Ember' };
const sideLabel = (side: Color): string => SIDE_LABEL[side];
const other = (side: Color): Color => (side === 'w' ? 'b' : 'w');

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** How a finished game reads, and what was worth counting along the way. */
function describeResult(
  e: GameEvent,
  history: MoveRecord[],
  elapsedMs: number,
  naming: { forSide: Color | null; opponent: string | null },
): Pick<GameOverSummary, 'headline' | 'outcome' | 'decisive' | 'stats'> {
  const captures = { w: 0, b: 0 };
  let checks = 0;
  let promotions = 0;
  let castles = 0;
  for (const r of history) {
    if (r.capture) captures[r.color]++;
    if (r.check || r.checkmate) checks++;
    if (r.promotion) promotions++;
    if (r.castle) castles++;
  }
  const duels = captures.w + captures.b;

  // After a mate the side to move is the mated one, so the winner is the other.
  const winner = other(e.turn);
  const namedWinner =
    naming.forSide === null
      ? `${sideLabel(winner)} wins`
      : winner === naming.forSide
        ? 'You win'
        : `${naming.opponent ?? sideLabel(winner)} wins`;

  const DRAWS: Record<string, [string, string]> = {
    stalemate: ['Stalemate', 'Nobody wins'],
    'draw-fifty': ['Draw', 'Fifty moves without progress'],
    'draw-repetition': ['Draw', 'The same position, three times'],
    'draw-material': ['Draw', 'Not enough left to force a mate'],
  };
  const draw = DRAWS[e.status];

  const stats: [string, string][] = [
    ['Moves', String(Math.ceil(history.length / 2))],
    ['Duration', clock(elapsedMs)],
    ['Duels fought', String(duels)],
    // Split per side rather than "1 · 0", which leaves the reader guessing
    // which number belongs to whom.
    ['Ash captured', String(captures.w)],
    ['Ember captured', String(captures.b)],
  ];
  if (checks > 0) stats.push(['Checks given', String(checks)]);
  if (promotions > 0) stats.push(['Promotions', String(promotions)]);
  if (castles > 0) stats.push(['Castles', String(castles)]);

  return {
    headline: draw ? draw[0] : 'Checkmate',
    outcome: draw ? draw[1] : namedWinner,
    decisive: !draw,
    stats,
  };
}

/**
 * Transient status for things the player must hear about but that belong to
 * neither the menu nor the in-game panel — an opponent joining or vanishing.
 * Styled inline so it stays out of both stylesheets.
 */
function notify(text: string): void {
  const existing = document.getElementById('cf-notice');
  existing?.remove();
  const note = document.createElement('div');
  note.id = 'cf-notice';
  note.setAttribute('role', 'status');
  note.textContent = text;
  note.style.cssText = [
    'position:fixed',
    'left:50%',
    'top:1rem',
    'transform:translateX(-50%)',
    'z-index:7500',
    'max-width:min(90vw,30rem)',
    'padding:0.6rem 1rem',
    'border:1px solid #d9a441',
    'border-radius:3px',
    'background:rgba(36,28,21,0.94)',
    'color:#efe8d4',
    'font:0.9rem/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
    'box-shadow:0 10px 30px rgba(0,0,0,0.5)',
  ].join(';');
  document.body.append(note);
  setTimeout(() => note.remove(), 6000);
}

function kingSquare(e: GameEvent): Square | null {
  if (!e.inCheck) return null;
  for (let sq = 0; sq < 64; sq++) {
    const p = e.board[sq];
    if (p && p.type === 'k' && p.color === e.turn) return sq;
  }
  return null;
}

function boot(): void {
  document.head.appendChild(
    Object.assign(document.createElement('style'), { textContent: SHELL_CSS }),
  );
  mountRotatePrompt();

  const canvas = requireEl<HTMLCanvasElement>('#stage');
  const uiMount = requireEl<HTMLElement>('#ui-root');

  const settings = new SettingsStore();
  const audio = new AudioEngine();
  const stage = new Stage(canvas, settings.get());

  // ── Game state ────────────────────────────────────────────────────────────

  const worker = new Worker(new URL('./ai/worker.ts', import.meta.url), {
    type: 'module',
  });

  /**
   * The controller has exactly one port for "the side I do not control", and
   * both the AI and a remote friend need it. This routes requests to whichever
   * is playing; replies from both are safe because the controller discards any
   * whose generation is stale.
   */
  const workerPort = createAiPort(worker);
  const opponentPort = createOpponentPort();
  let opponentIsRemote = false;
  const routedPort: AiPort = {
    post: (req) => (opponentIsRemote ? opponentPort.post(req) : workerPort.post(req)),
    onReply: (fn) => {
      workerPort.onReply(fn);
      opponentPort.onReply(fn);
    },
  };
  const controller = new GameController(routedPort);

  /**
   * The seed lives inside the controller and duel variants are chosen from it,
   * but `NewGameOptions.seed` is only ever seen on the way in — and the UI owns
   * the new-game dialog, so it calls `newGame` without telling us. This façade
   * is how integration keeps its copy in step. Everything else delegates.
   */
  let gameSeed = randomSeed();
  const api: GameApi = {
    tryMove: (from, to, promotion) => controller.tryMove(from, to, promotion),
    legalTargets: (from) => controller.legalTargets(from),
    needsPromotion: (from, to) => controller.needsPromotion(from, to),
    // Taking moves back would desync the two boards, and there is no protocol
    // for agreeing to it. In a challenge match the buttons simply decline.
    undo: () => (matchLive ? false : controller.undo()),
    redo: () => (matchLive ? false : controller.redo()),
    newGame: (opts: NewGameOptions) => {
      gameSeed = opts.seed;
      controller.newGame(opts);
    },
    loadFEN: (fen) => controller.loadFEN(fen),
    importPGN: (pgn) => controller.importPGN(pgn),
    exportPGN: () => controller.exportPGN(),
    exportFEN: () => controller.exportFEN(),
    subscribe: (fn) => controller.subscribe(fn),
    getState: () => controller.getState(),
    history: () => controller.history(),
  };

  // ── Duels ─────────────────────────────────────────────────────────────────

  interface ActiveDuel {
    /** Square the attacker occupies once the board has synced. */
    dest: Square;
    group: Group;
    rigs: CharacterRig[];
  }

  const activeDuels = new Set<ActiveDuel>();
  /** Board rigs hidden behind a duel overlay, so we can always put them back. */
  const hiddenRigs = new Set<CharacterRig>();
  let duelHandles: DuelHandle[] = [];
  /** True while we snap duels for undo/redo/newgame: no resolve cue for those. */
  let clearingDuels = false;

  const director = new DuelDirector({
    cameraRig: stage.getDuelCameraRig(),
    cue: (name, intensity) => audio.play(name, intensity),
    settings: () => settings.get(),
  });

  function unhideBoardRigs(): void {
    for (const rig of hiddenRigs) rig.root.visible = true;
    hiddenRigs.clear();
  }

  /**
   * Re-hide the board rig standing in for each on-screen duel. Called after
   * every sync because `syncBoard` reuses rigs across squares — hiding by rig
   * reference alone would eventually blank the wrong piece.
   */
  function reapplyDuelHides(): void {
    unhideBoardRigs();
    for (const duel of activeDuels) {
      const rig = stage.getRigAt(duel.dest);
      if (!rig) continue;
      rig.root.visible = false;
      hiddenRigs.add(rig);
    }
  }

  function endDuel(duel: ActiveDuel): void {
    if (!activeDuels.delete(duel)) return;
    duel.group.removeFromParent();
    for (const rig of duel.rigs) rig.dispose();
    reapplyDuelHides();
    if (!clearingDuels) audio.play('capture-resolve');
    // The last duel of the game has just landed; now the result can be shown.
    maybeShowResult();
  }

  function duelsEnabled(e: GameEvent): boolean {
    return e.moveIndex <= settings.get().duelsFirstNMoves;
  }

  /**
   * Stage the capture. The board already holds the resolved truth by now, so
   * everything below is decoration that can be abandoned at any frame.
   */
  function startDuel(
    e: GameEvent,
    record: MoveRecord,
    capture: NonNullable<MoveRecord['capture']>,
  ): boolean {
    const layer = findWorldLayer(stage);
    if (!layer) return false;

    // 2D suppresses full duels; the vignette is the same DuelScript codepath.
    const flat = stage.getViewMode() === '2d';
    // Ply index, matching the convention the determinism harnesses use.
    const ply = e.moveIndex - 1;
    const script = flat
      ? VIGNETTE_2D
      : pickDuel?.(gameSeed, ply, record.piece, capture.type);
    if (!script) return false;

    const attacker = buildCharacter(
      PIECE_CHARACTER[record.piece],
      FACTION[record.color],
      { flat },
    );
    const victim = buildCharacter(
      PIECE_CHARACTER[capture.type],
      FACTION[capture.color],
      { flat },
    );

    const group = new Group();
    group.add(attacker.root, victim.root);
    group.traverse((o) => {
      o.castShadow = true;
    });
    layer.add(group);

    const duel: ActiveDuel = { dest: record.to, group, rigs: [attacker, victim] };
    activeDuels.add(duel);
    reapplyDuelHides();

    // En passant stages against the pawn's actual square, not the destination.
    duelHandles.push(
      director.play({
        script,
        attacker,
        victim,
        attackerPiece: record.piece,
        victimPiece: capture.type,
        seed: gameSeed,
        moveIndex: ply,
        attackerPos: squareToWorld(record.from),
        victimPos: squareToWorld(capture.square),
        onDone: () => endDuel(duel),
      }),
    );
    return true;
  }

  function skipDuels(): void {
    // skip() on a finished playback is a no-op, so stale handles are harmless.
    const handles = duelHandles;
    duelHandles = [];
    for (const h of handles) h.skip();
  }

  // ── Audio ─────────────────────────────────────────────────────────────────

  function isMuted(): boolean {
    return settings.get().masterVolume === 0;
  }

  function setMuted(muted: boolean): void {
    if (muted) {
      const current = settings.get().masterVolume;
      if (current > 0) {
        try {
          localStorage.setItem(PREMUTE_KEY, String(current));
        } catch {
          /* blocked storage just means we come back to the default level */
        }
      }
      settings.set({ masterVolume: 0 });
      return;
    }
    let previous = DEFAULT_UNMUTE_VOLUME;
    try {
      const stored = Number(localStorage.getItem(PREMUTE_KEY));
      if (Number.isFinite(stored) && stored > 0) previous = stored;
    } catch {
      /* fall through to the default */
    }
    settings.set({ masterVolume: previous });
    // Un-muting always happens inside a click, so it counts as the gesture
    // WebAudio wants — and the context may never have been created.
    armAudio();
  }

  let audioArmed = false;
  function armAudio(): void {
    // Staying silent while muted also means never building the audio graph.
    if (audioArmed || isMuted()) return;
    audioArmed = true;
    // WebAudio needs a gesture; a blocked context must not break the game.
    void audio
      .resume()
      .then(() => {
        audio.applySettings(settings.get());
        audio.startScore();
      })
      .catch((err: unknown) => {
        console.warn('Audio unavailable — running silent.', err);
      });
  }
  window.addEventListener('pointerdown', armAudio, { once: true });
  window.addEventListener('keydown', armAudio, { once: true });

  function fireEventCues(e: GameEvent): void {
    const r = e.record;
    if (r && (e.kind === 'move' || e.kind === 'redo')) {
      // A capture's beat is the duel's resolve cue, fired when it lands.
      if (!r.capture) audio.play(r.castle ? 'castle' : 'move');
      if (r.promotion) audio.play('promote');
      if (r.check || r.checkmate) audio.play('check');
    }
    if (e.status === 'checkmate') audio.play('game-over-win');
    else if (e.status !== 'active') audio.play('game-over-draw');
  }

  // ── Pointer input ─────────────────────────────────────────────────────────

  let selected: Square | null = null;

  function clearSelection(): void {
    selected = null;
    stage.setSelectedSquare(null);
    stage.setLegalTargets([]);
  }

  function select(sq: Square): void {
    selected = sq;
    stage.setSelectedSquare(sq);
    stage.setLegalTargets(api.legalTargets(sq));
  }

  stage.onSquareHover = (sq) => stage.setHoverSquare(sq);

  stage.onSquareClick = (sq) => {
    const state = api.getState();
    if (selected === null) {
      const piece = state.board[sq];
      if (piece && piece.color === state.turn) select(sq);
      return;
    }
    if (selected === sq) {
      clearSelection();
      return;
    }
    const piece = state.board[sq];
    const from = selected;
    // Promotion by pointer takes the Valkyrie: the picker lives in the UI and
    // is only reachable from its keyboard path (no hook exposes it here).
    const promotion = api.needsPromotion(from, sq) ? 'q' : undefined;
    if (api.tryMove(from, sq, promotion)) return; // the event clears selection
    if (piece && piece.color === state.turn) {
      select(sq);
      return;
    }
    if (!controller.thinking) audio.play('illegal');
  };

  // ── Event flow ────────────────────────────────────────────────────────────

  function onGameEvent(e: GameEvent): void {
    clearSelection();

    if (e.kind !== 'move') {
      // The scene re-derives from the event, so all we owe abandoned duels is
      // a clean end state. Their onDone still runs and tidies up.
      clearingDuels = true;
      director.clear();
      clearingDuels = false;
    }

    stage.syncBoard(e.board, buildCharacter);
    stage.setLastMove(e.lastMove ?? null);
    stage.setCheckSquare(kingSquare(e));
    reapplyDuelHides();
    // Gates the export controls, which only earn their space once there is a
    // finished game to export.
    document.body.dataset.cfGameOver = String(e.status !== 'active');

    fireEventCues(e);
    audio.setScoreIntensity(
      Math.min(1, 0.15 + e.moveIndex / 60 + (e.inCheck ? 0.25 : 0)),
    );

    const r = e.record;
    if (r?.capture && (e.kind === 'move' || e.kind === 'redo')) {
      const staged = duelsEnabled(e) && startDuel(e, r, r.capture);
      if (!staged) audio.play('capture-resolve');
    }

    // Send only our own moves: a move that arrived from the opponent is applied
    // through the same event, and echoing it back would loop.
    if (matchLive && session && e.kind === 'move' && r && r.color === localSide) {
      void session
        .sendMove({ from: r.from, to: r.to, promotion: r.promotion }, e.moveIndex)
        .catch(() => notify('That move could not be sent — check your connection.'));
    }

    pendingResult = e.status === 'active' ? null : e;
    maybeShowResult();
  }

  api.subscribe(onGameEvent);

  settings.subscribe((s) => {
    audio.applySettings(s);
    stage.setViewMode(s.viewMode);
  });

  // ── UI ────────────────────────────────────────────────────────────────────

  /**
   * The in-game panel is built on the first real game rather than at boot: the
   * player lands on the menu, and until they pick a mode there is nothing for a
   * move list or a clock to describe.
   */
  let ui: UIHandle | null = null;
  let gameStarted = false;
  /** Kept so a rematch can repeat the setup with a fresh seed. */
  let lastGameOptions: NewGameOptions | null = null;
  let gameStartedAt = 0;
  /**
   * A finished game whose result has not been shown yet. The mating move has a
   * duel of its own, and covering it with a result screen would rob the player
   * of the one thing they just earned — so the screen waits for the board to
   * fall quiet.
   */
  let pendingResult: GameEvent | null = null;

  function maybeShowResult(): void {
    const e = pendingResult;
    if (!e || activeDuels.size > 0 || director.active) return;
    pendingResult = null;
    shell.showGameOver({
      ...describeResult(e, api.history(), performance.now() - gameStartedAt, {
        forSide: matchLive ? localSide : null,
        opponent: session?.opponent ?? null,
      }),
      fen: api.exportFEN(),
      pgn: api.exportPGN(),
      // Both players would have to agree, and the protocol has no word for it.
      canRematch: !matchLive,
      rematchHint: matchLive
        ? 'A rematch needs a fresh challenge link — there is no way to agree one mid-match.'
        : undefined,
    });
  }

  function ensureUI(): void {
    if (ui) return;
    ui = createUI(api, settings, uiMount, {
      setViewMode: (mode) => stage.setViewMode(mode),
      skipDuel: skipDuels,
    });
    decorateToolbar(uiMount);
  }

  // ── Challenge matches ─────────────────────────────────────────────────────

  let netConfig: NetConfig | null = null;
  let session: ChallengeSession | null = null;
  /** True from the moment both players are present until one leaves. */
  let matchLive = false;
  let localSide: Color = 'w';

  const arrivalCode = codeFromSearch(location.search);

  /** Config is a local fetch, so this resolves long before the menu appears. */
  void loadNetConfig().then((cfg) => {
    netConfig = cfg;
  });

  function endMatch(reason: 'left' | 'resigned' | 'disconnected'): void {
    if (!matchLive) return;
    matchLive = false;
    opponentIsRemote = false;
    const gone = session;
    session = null;
    void gone?.dispose();
    notify(
      reason === 'disconnected'
        ? 'Your opponent disconnected. The board is yours.'
        : `Your opponent ${reason === 'resigned' ? 'resigned' : 'left the match'}.`,
    );
  }

  /**
   * Both sides run this off their own copy of the handshake, and the shared
   * seed makes the two games identical — including which duel variants play.
   * Guarded because a re-sent hello must not reset a match in progress.
   */
  function beginMatch(): void {
    const info = session?.match;
    if (!info || matchLive) return;
    matchLive = true;
    opponentIsRemote = true;
    localSide = info.localSide;
    gameStartedAt = performance.now();
    gameStarted = true;
    ensureUI();
    api.newGame({ mode: 'online', seed: info.seed, humanColor: info.localSide });
    armAudio();
    shell.close();
    notify(`${session?.opponent ?? 'Your opponent'} joined. You play ${sideLabel(info.localSide)}.`);
  }

  async function openSession(): Promise<ChallengeSession> {
    if (!netConfig) throw new Error('Challenges are not configured in this build.');
    // First challenge of the session pays for the client library; a player who
    // never opens one never downloads it.
    const { ChallengeSession } = await import('./net/session.ts');
    await session?.dispose();
    session = new ChallengeSession(netConfig, {
      onOpponent: () => beginMatch(),
      onRemoteMove: (move) => opponentPort.deliver(move),
      onOpponentGone: (reason) => endMatch(reason),
    });
    return session;
  }

  const shell = createShell({
    settings,
    audio: { isMuted, setMuted },
    net: {
      get available(): boolean {
        return netConfig !== null;
      },
      pendingCode: arrivalCode,
      createChallenge: async (name, side) => {
        const s = await openSession();
        const info = await s.host(name, side);
        return {
          code: info.code,
          link: inviteLink(location.origin, location.pathname, info.code),
        };
      },
      joinChallenge: async (code, name) => {
        const s = await openSession();
        await s.join(code, name);
        // The host's greeting may already have arrived; beginMatch is idempotent.
        beginMatch();
      },
      cancelChallenge: async () => {
        const s = session;
        session = null;
        await s?.leave('left');
      },
    },
    onStartGame: (opts) => {
      // Starting a local game abandons any challenge in flight.
      if (session) {
        const leaving = session;
        session = null;
        matchLive = false;
        opponentIsRemote = false;
        void leaving.leave('left');
      }
      lastGameOptions = opts;
      gameStartedAt = performance.now();
      gameStarted = true;
      ensureUI();
      api.newGame(opts);
      armAudio();
      requestLandscape();
    },
    onRematch: () => {
      const base: NewGameOptions = lastGameOptions ?? { mode: 'hotseat', seed: 0 };
      const opts: NewGameOptions = { ...base, seed: randomSeed() };
      lastGameOptions = opts;
      gameStartedAt = performance.now();
      gameStarted = true;
      ensureUI();
      api.newGame(opts);
      shell.close();
      armAudio();
    },
    onVisibilityChange: (open) => {
      // Hiding #ui-root collapses the sidebar, so the board gets the full width
      // behind the floating menu.
      uiMount.hidden = open || !gameStarted;
      lastRectKey = '';
    },
    hasGame: () => gameStarted,
  });

  /**
   * The keyboard overlay is an 8×8 grid laid over the board. The board is
   * centred and square, so a centred square is the closest rect we can offer
   * without projecting its corners through the active camera — in 3D the cells
   * approximate the perspective board rather than matching it square for square.
   */
  const BOARD_VIEWPORT_FRACTION = 0.78;
  let lastRectKey = '';
  function syncBoardRect(): void {
    if (!ui || uiMount.hidden) return;
    const c = canvas.getBoundingClientRect();
    const m = uiMount.getBoundingClientRect();
    const size = Math.min(c.width, c.height) * BOARD_VIEWPORT_FRACTION;
    const left = c.left - m.left + (c.width - size) / 2;
    const top = c.top - m.top + (c.height - size) / 2;
    const key = `${left}|${top}|${size}`;
    if (key === lastRectKey) return;
    lastRectKey = key;
    ui.setBoardRect({ left, top, width: size, height: size });
  }

  /**
   * Reserve exactly as much room as the floating Menu/Help bar actually takes.
   * A hardcoded gap is a guess that goes stale the moment a label, a font size
   * or a breakpoint changes — and when it is too small the bar sits on top of
   * the status banner.
   */
  function trackHudGap(): void {
    const bar = document.getElementById(SHELL_BAR_ID);
    if (!bar) return;
    const apply = (): void => {
      const width = bar.getBoundingClientRect().right;
      if (width > 0) {
        document.documentElement.style.setProperty('--cf-hud-gap', `${Math.ceil(width) + 10}px`);
      }
    };
    apply();
    new ResizeObserver(apply).observe(bar);
  }
  trackHudGap();

  window.addEventListener('resize', () => {
    stage.resize();
    syncBoardRect();
  });

  // ── Frame loop ────────────────────────────────────────────────────────────

  let last = performance.now();
  function frame(now: number): void {
    const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - last) / 1000));
    last = now;
    director.update(dt);
    stage.render(dt);
    syncBoardRect();
    requestAnimationFrame(frame);
  }

  // A fresh seed per session, so duel variants differ game to game. This first
  // deal is only the backdrop the menu floats over — `gameStarted` stays false
  // until the player actually picks a mode.
  api.newGame({ mode: 'hotseat', seed: gameSeed });
  uiMount.hidden = true;
  requestAnimationFrame(frame);

  // The splash owns the first beat and announces its own exit, so the shell
  // arrives as the title card clears. Someone who followed a challenge link
  // lands on the accept screen instead of the menu.
  const firstScreen = arrivalCode ? 'join' : 'menu';
  if (document.getElementById(SPLASH_ID)) {
    document.addEventListener(SPLASH_DISMISSED, () => shell.open(firstScreen), { once: true });
  } else {
    shell.open(firstScreen);
  }
}

boot();
