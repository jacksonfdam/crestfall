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
import { squareToWorld } from './render/boardMath.ts';
import { Stage } from './render/stage.ts';
import { createUI } from './ui/index.ts';
import type { UIHandle } from './ui/index.ts';
import { SettingsStore } from './ui/settings.ts';
import { applyToolbarTooltips, createShell } from './ui/shell.ts';

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
html, body { height: 100%; margin: 0; background: #0b0e14; }
#app { position: relative; display: flex; height: 100dvh; }
#stage { flex: 1 1 auto; display: block; min-width: 0; touch-action: none; }
#ui-root { position: relative; flex: 0 0 clamp(260px, 24vw, 380px); }
.sr-only {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  border: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
}
@media (max-width: 720px) {
  #app { flex-direction: column; }
  #stage { flex: 1 1 55dvh; }
  #ui-root { flex: 0 0 auto; }
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

  const canvas = requireEl<HTMLCanvasElement>('#stage');
  const uiMount = requireEl<HTMLElement>('#ui-root');

  const settings = new SettingsStore();
  const audio = new AudioEngine();
  const stage = new Stage(canvas, settings.get());

  // ── Game state ────────────────────────────────────────────────────────────

  const worker = new Worker(new URL('./ai/worker.ts', import.meta.url), {
    type: 'module',
  });
  const controller = new GameController(createAiPort(worker));

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
    undo: () => controller.undo(),
    redo: () => controller.redo(),
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

    fireEventCues(e);
    audio.setScoreIntensity(
      Math.min(1, 0.15 + e.moveIndex / 60 + (e.inCheck ? 0.25 : 0)),
    );

    const r = e.record;
    if (r?.capture && (e.kind === 'move' || e.kind === 'redo')) {
      const staged = duelsEnabled(e) && startDuel(e, r, r.capture);
      if (!staged) audio.play('capture-resolve');
    }
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

  function ensureUI(): void {
    if (ui) return;
    ui = createUI(api, settings, uiMount, {
      setViewMode: (mode) => stage.setViewMode(mode),
      skipDuel: skipDuels,
    });
    applyToolbarTooltips(uiMount);
  }

  const shell = createShell({
    settings,
    audio: { isMuted, setMuted },
    onStartGame: (opts) => {
      gameStarted = true;
      ensureUI();
      api.newGame(opts);
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
   * The keyboard overlay is an 8×8 grid laid over the board. We can only offer
   * the canvas rect without projecting the board corners through the active
   * camera, so in 3D the cells approximate the perspective board rather than
   * matching it square for square.
   */
  let lastRectKey = '';
  function syncBoardRect(): void {
    if (!ui || uiMount.hidden) return;
    const c = canvas.getBoundingClientRect();
    const m = uiMount.getBoundingClientRect();
    const key = `${c.left - m.left}|${c.top - m.top}|${c.width}|${c.height}`;
    if (key === lastRectKey) return;
    lastRectKey = key;
    ui.setBoardRect({
      left: c.left - m.left,
      top: c.top - m.top,
      width: c.width,
      height: c.height,
    });
  }

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

  // The splash owns the first beat and announces its own exit, so the menu
  // arrives as the title card clears. If it has already gone (or never
  // mounted), open straight away rather than waiting for an event that passed.
  if (document.getElementById(SPLASH_ID)) {
    document.addEventListener(SPLASH_DISMISSED, () => shell.open('menu'), { once: true });
  } else {
    shell.open('menu');
  }
}

boot();
