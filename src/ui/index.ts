import type {
  AiTier,
  Color,
  GameEvent,
  GameApi,
  GameMode,
  NewGameOptions,
  PieceType,
  Settings,
  Square,
} from '../core/contract.ts';
import { squareName } from '../core/contract.ts';
import type { SettingsStore } from './settings.ts';
import { PIECE_LABEL, describeEvent, describeStatus, formatClock, sideLabel } from './announce.ts';
import { button, el } from './dom.ts';
import './style.css';

export interface UIHooks {
  setViewMode(m: '3d' | '2d'): void;
  skipDuel(): void;
  announceExtra?(s: string): void;
}

export interface BoardRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface UIHandle {
  dispose(): void;
  /** Integration calls this whenever the canvas board area moves/resizes (mount-relative px). */
  setBoardRect(rect: BoardRect): void;
}

const DUEL_N_CHOICES = ['10', '20', '40', 'always'];

const PROMOTION_CHOICES: { type: PieceType; label: string }[] = [
  { type: 'q', label: 'Valkyrie (Q)' },
  { type: 'r', label: 'Jötunn (R)' },
  { type: 'b', label: 'Völva (B)' },
  { type: 'n', label: 'Berserkr (N)' },
];

function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

export function createUI(
  api: GameApi,
  settings: SettingsStore,
  mount: HTMLElement,
  hooks: UIHooks,
): UIHandle {
  if (getComputedStyle(mount).position === 'static') mount.style.position = 'relative';

  const root = el('div', { class: 'cf-ui' });

  // ── Screen-reader announcer ──────────────────────────────────────────────
  const sr = el('div', {
    id: 'sr-announcer',
    class: 'cf-visually-hidden',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });

  function announce(text: string): void {
    sr.textContent = text;
    hooks.announceExtra?.(text);
  }

  // ── Session state the UI tracks locally ─────────────────────────────────
  let gameMode: GameMode = 'hotseat';
  let aiColor: Color | null = null;
  let pendingPromotion: { from: Square; to: Square } | null = null;

  // ── Status banner ────────────────────────────────────────────────────────
  const banner = el('div', { class: 'cf-banner', role: 'status' });

  function updateBanner(e: GameEvent): void {
    let text = describeStatus(e.status, e.turn);
    if (e.inCheck && e.status === 'active') text += ' Check.';
    if (gameMode === 'vs-ai' && aiColor === e.turn && e.status === 'active') {
      text += ` ${sideLabel(e.turn)} is thinking…`;
    }
    banner.textContent = text;
  }

  // ── Clocks (count-up, no time control in v1) ────────────────────────────
  const elapsed: Record<Color, number> = { w: 0, b: 0 };
  let running: Color | null = api.getState().status === 'active' ? api.getState().turn : null;
  let lastTick = performance.now();

  function makeClock(color: Color) {
    const time = el('span', { class: 'cf-clock-time' }, ['0:00']);
    const note = el('span', { class: 'cf-visually-hidden' });
    const box = el('div', { class: 'cf-clock', 'data-color': color }, [
      el('span', { class: 'cf-clock-marker', 'aria-hidden': 'true' }, ['▸']),
      el('span', { class: 'cf-clock-label' }, [sideLabel(color)]),
      time,
      note,
    ]);
    return { box, time, note, color };
  }
  const clocks = [makeClock('w'), makeClock('b')];
  const clocksWrap = el('div', { class: 'cf-clocks' }, clocks.map((c) => c.box));

  function tickClocks(): void {
    const now = performance.now();
    if (running) elapsed[running] += now - lastTick;
    lastTick = now;
  }

  function renderClocks(): void {
    for (const c of clocks) {
      c.time.textContent = formatClock(elapsed[c.color]);
      const active = running === c.color;
      c.box.classList.toggle('cf-active', active);
      c.note.textContent = active ? '(to move)' : '';
    }
  }

  const intervalId = window.setInterval(() => {
    tickClocks();
    renderClocks();
  }, 250);

  // ── Move list ────────────────────────────────────────────────────────────
  const moveList = el('ol', { class: 'cf-moves', role: 'list', 'aria-label': 'Move list' });

  function renderMoves(moveIndex: number): void {
    moveList.textContent = '';
    const hist = api.history();
    const current = Math.min(moveIndex - 1, hist.length - 1);
    hist.forEach((rec, i) => {
      const num = i % 2 === 0 ? `${i / 2 + 1}. ` : '';
      const li = el('li', { class: 'cf-move', role: 'listitem' }, [num + rec.san]);
      if (i === current) {
        li.classList.add('cf-current');
        li.setAttribute('aria-current', 'true');
      }
      moveList.appendChild(li);
    });
    moveList.scrollTop = moveList.scrollHeight;
  }

  // ── Dialog plumbing ──────────────────────────────────────────────────────
  function makeDialog(title: string): { dlg: HTMLDialogElement; body: HTMLElement } {
    const body = el('div', { class: 'cf-dialog-body' });
    const dlg = el('dialog', { class: 'cf-dialog', 'aria-label': title }, [
      el('h2', { class: 'cf-dialog-title' }, [title]),
      body,
    ]);
    root.appendChild(dlg);
    return { dlg, body };
  }

  // ── New game dialog ──────────────────────────────────────────────────────
  const ng = makeDialog('New game');
  const modeRadios: HTMLInputElement[] = [];
  const colorRadios: HTMLInputElement[] = [];

  function makeRadio(
    list: HTMLInputElement[],
    name: string,
    value: string,
    labelText: string,
    checked: boolean,
  ): HTMLElement {
    const input = el('input', { type: 'radio', name, value });
    input.checked = checked;
    list.push(input);
    return el('label', { class: 'cf-choice' }, [input, labelText]);
  }

  const tierSelect = el('select', { id: 'cf-tier', class: 'cf-control' });
  for (const t of ['thrall', 'karl', 'jarl', 'konungr'] as AiTier[]) {
    tierSelect.append(el('option', { value: t }, [t]));
  }

  const aiFieldset = el('fieldset', { class: 'cf-fieldset' }, [
    el('legend', {}, ['Opponent']),
    el('div', { class: 'cf-field' }, [
      el('label', { for: 'cf-tier' }, ['Tier']),
      tierSelect,
    ]),
    el('div', { class: 'cf-choices' }, [
      makeRadio(colorRadios, 'cf-color', 'w', 'Play White', true),
      makeRadio(colorRadios, 'cf-color', 'b', 'Play Black', false),
    ]),
  ]);

  function currentMode(): GameMode {
    return (modeRadios.find((r) => r.checked)?.value ?? 'hotseat') as GameMode;
  }
  function syncAiFieldset(): void {
    aiFieldset.disabled = currentMode() !== 'vs-ai';
  }

  const modeChoices = el('div', { class: 'cf-choices' }, [
    makeRadio(modeRadios, 'cf-mode', 'hotseat', 'Hotseat', true),
    makeRadio(modeRadios, 'cf-mode', 'vs-ai', 'Versus AI', false),
    makeRadio(modeRadios, 'cf-mode', 'attract', 'Attract', false),
  ]);
  for (const r of modeRadios) r.addEventListener('change', syncAiFieldset);
  syncAiFieldset();

  ng.body.append(
    modeChoices,
    aiFieldset,
    el('div', { class: 'cf-dialog-actions' }, [
      button('Start game', () => {
        const m = currentMode();
        const opts: NewGameOptions = { mode: m, seed: randomSeed() };
        if (m === 'vs-ai') {
          opts.aiTier = tierSelect.value as AiTier;
          const human = (colorRadios.find((r) => r.checked)?.value ?? 'w') as Color;
          opts.humanColor = human;
          aiColor = human === 'w' ? 'b' : 'w';
        } else {
          aiColor = null;
        }
        gameMode = m;
        ng.dlg.close();
        api.newGame(opts);
      }),
      button('Cancel', () => ng.dlg.close()),
    ]),
  );

  // ── FEN / PGN dialogs ────────────────────────────────────────────────────
  function makeIODialog(
    kind: 'FEN' | 'PGN',
    exportText: () => string,
    importText: (v: string) => boolean,
  ): { open(): void } {
    const { dlg, body } = makeDialog(`${kind} import / export`);
    const ta = el('textarea', {
      class: 'cf-io-text',
      'aria-label': `${kind} text`,
      rows: kind === 'FEN' ? '3' : '10',
      spellcheck: 'false',
    });
    const err = el('div', { class: 'cf-error', role: 'alert' });
    body.append(
      ta,
      err,
      el('div', { class: 'cf-dialog-actions' }, [
        button('Copy', () => {
          navigator.clipboard.writeText(ta.value).then(
            () => announce(`${kind} copied to clipboard.`),
            () => announce('Copy failed.'),
          );
        }),
        button(`Load ${kind}`, () => {
          err.textContent = '';
          if (importText(ta.value.trim())) dlg.close();
          else err.textContent = `Invalid ${kind} — the position was not loaded.`;
        }),
        button('Close', () => dlg.close()),
      ]),
    );
    return {
      open(): void {
        ta.value = exportText();
        err.textContent = '';
        dlg.showModal();
      },
    };
  }
  const fenDialog = makeIODialog('FEN', () => api.exportFEN(), (v) => api.loadFEN(v));
  const pgnDialog = makeIODialog('PGN', () => api.exportPGN(), (v) => api.importPGN(v));

  // ── Promotion picker ─────────────────────────────────────────────────────
  const promo = makeDialog('Choose promotion');
  const promoBtns: HTMLButtonElement[] = [];
  for (const { type, label } of PROMOTION_CHOICES) {
    const b = button(label, () => {
      const pp = pendingPromotion;
      pendingPromotion = null;
      promo.dlg.close();
      if (pp && !api.tryMove(pp.from, pp.to, type)) announce('Illegal move.');
    });
    promoBtns.push(b);
    promo.body.appendChild(b);
  }
  promo.body.appendChild(
    button('Cancel', () => {
      pendingPromotion = null;
      promo.dlg.close();
      announce('Promotion cancelled.');
    }),
  );
  promo.dlg.addEventListener('cancel', () => {
    pendingPromotion = null;
    announce('Promotion cancelled.');
  });
  promo.dlg.addEventListener('keydown', (ev) => {
    const i = promoBtns.indexOf(document.activeElement as HTMLButtonElement);
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
      promoBtns[(i + 1 + promoBtns.length) % promoBtns.length].focus();
      ev.preventDefault();
    } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
      promoBtns[(i - 1 + promoBtns.length) % promoBtns.length].focus();
      ev.preventDefault();
    }
  });

  function openPromotionPicker(from: Square, to: Square): void {
    pendingPromotion = { from, to };
    promo.dlg.showModal();
    promoBtns[0].focus();
    announce('Choose a promotion: Valkyrie, Jötunn, Völva, or Berserkr.');
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────
  const viewBtn = button('View: 3D', () => {
    const next = settings.get().viewMode === '3d' ? '2d' : '3d';
    settings.set({ viewMode: next });
    hooks.setViewMode(next);
  });
  const speedBtn = button('Duel speed: 1×', () => {
    const cur = settings.get().duelSpeed;
    settings.set({ duelSpeed: cur === 1 ? 2 : cur === 2 ? 0 : 1 });
  });

  const duelsSelect = el('select', { id: 'cf-duels', class: 'cf-control' });
  for (const v of DUEL_N_CHOICES) {
    duelsSelect.append(el('option', { value: v }, [v === 'always' ? 'Always' : v]));
  }
  duelsSelect.addEventListener('change', () => {
    settings.set({
      duelsFirstNMoves: duelsSelect.value === 'always' ? Infinity : Number(duelsSelect.value),
    });
  });

  function makeSlider(id: string, labelText: string, key: 'masterVolume' | 'musicVolume' | 'sfxVolume') {
    const input = el('input', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.05',
      id,
      class: 'cf-range',
    });
    input.addEventListener('input', () => {
      const p: Partial<Settings> = {};
      p[key] = Number(input.value);
      settings.set(p);
    });
    const wrap = el('div', { class: 'cf-slider' }, [el('label', { for: id }, [labelText]), input]);
    return { wrap, input, key };
  }
  const sliders = [
    makeSlider('cf-vol-master', 'Master volume', 'masterVolume'),
    makeSlider('cf-vol-music', 'Music volume', 'musicVolume'),
    makeSlider('cf-vol-sfx', 'Effects volume', 'sfxVolume'),
  ];

  const toolbar = el('div', { class: 'cf-toolbar', role: 'toolbar', 'aria-label': 'Game controls' }, [
    button('New game', () => ng.dlg.showModal()),
    button('Undo', () => {
      if (!api.undo()) announce('Nothing to undo.');
    }),
    button('Redo', () => {
      if (!api.redo()) announce('Nothing to redo.');
    }),
    viewBtn,
    speedBtn,
    el('div', { class: 'cf-field' }, [
      el('label', { for: 'cf-duels' }, ['Duels for first']),
      duelsSelect,
    ]),
    button('FEN…', () => fenDialog.open()),
    button('PGN…', () => pgnDialog.open()),
    el('div', { class: 'cf-sliders' }, sliders.map((s) => s.wrap)),
  ]);

  function applySettings(s: Settings): void {
    viewBtn.textContent = s.viewMode === '3d' ? 'View: 3D' : 'View: 2D';
    speedBtn.textContent =
      s.duelSpeed === 1 ? 'Duel speed: 1×' : s.duelSpeed === 2 ? 'Duel speed: 2×' : 'Duel speed: instant';
    const v = s.duelsFirstNMoves === Infinity ? 'always' : String(s.duelsFirstNMoves);
    duelsSelect.value = DUEL_N_CHOICES.includes(v) ? v : 'always';
    for (const sl of sliders) sl.input.value = String(s[sl.key]);
    root.classList.toggle('cf-reduced', s.reducedMotion);
    overlay.classList.toggle('cf-reduced', s.reducedMotion);
  }

  // ── Keyboard board cursor (DOM overlay aligned to the canvas) ────────────
  const overlay = el('div', {
    class: 'cf-overlay',
    tabindex: '0',
    role: 'application',
    'aria-label':
      'Chess board. Arrow keys move the cursor, Enter selects and moves, Escape cancels, Space skips a duel.',
  });
  const cells: HTMLElement[] = [];
  for (let row = 0; row < 8; row++) {
    for (let file = 0; file < 8; file++) {
      const sq = (7 - row) * 8 + file;
      const cell = el('div', { class: 'cf-cell', 'aria-hidden': 'true' });
      cells[sq] = cell;
      overlay.appendChild(cell);
    }
  }

  let cursor: Square = 12;
  let selected: Square | null = null;
  let targets: Square[] = [];

  function refreshOverlay(): void {
    for (let sq = 0; sq < 64; sq++) {
      const c = cells[sq];
      c.classList.toggle('cf-cursor', sq === cursor);
      c.classList.toggle('cf-selected', sq === selected);
      c.classList.toggle('cf-target', targets.includes(sq));
    }
  }

  function clearSelection(): void {
    selected = null;
    targets = [];
  }

  function moveCursor(df: number, dr: number): void {
    const f = Math.min(7, Math.max(0, (cursor & 7) + df));
    const r = Math.min(7, Math.max(0, (cursor >> 3) + dr));
    cursor = r * 8 + f;
    refreshOverlay();
    const p = api.getState().board[cursor];
    announce(
      p
        ? `${squareName(cursor)}, ${sideLabel(p.color)} ${PIECE_LABEL[p.type]}`
        : `${squareName(cursor)}, empty`,
    );
  }

  function activateSquare(): void {
    const state = api.getState();
    if (selected === null) {
      const p = state.board[cursor];
      if (p && p.color === state.turn) {
        selected = cursor;
        targets = api.legalTargets(cursor);
        announce(
          `Selected ${PIECE_LABEL[p.type]} on ${squareName(cursor)}. ` +
            `${targets.length} legal ${targets.length === 1 ? 'move' : 'moves'}.`,
        );
      } else {
        announce(p ? 'That piece is not yours to move.' : 'Empty square.');
      }
    } else if (selected === cursor) {
      clearSelection();
      announce('Selection cancelled.');
    } else {
      const from = selected;
      const to = cursor;
      if (api.needsPromotion(from, to)) {
        openPromotionPicker(from, to);
      } else if (api.tryMove(from, to)) {
        clearSelection();
      } else {
        announce('Illegal move.');
      }
    }
    refreshOverlay();
  }

  overlay.addEventListener('keydown', (ev) => {
    switch (ev.key) {
      case 'ArrowLeft':
        moveCursor(-1, 0);
        break;
      case 'ArrowRight':
        moveCursor(1, 0);
        break;
      case 'ArrowUp':
        moveCursor(0, 1);
        break;
      case 'ArrowDown':
        moveCursor(0, -1);
        break;
      case 'Enter':
        activateSquare();
        break;
      case 'Escape':
        if (selected !== null) {
          clearSelection();
          refreshOverlay();
          announce('Selection cancelled.');
        }
        break;
      case ' ':
        hooks.skipDuel();
        break;
      default:
        return;
    }
    ev.preventDefault();
    ev.stopPropagation();
  });

  function setBoardRect(rect: BoardRect): void {
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.classList.add('cf-placed');
  }

  // ── Duel skipping (canvas click / Space anywhere outside a control) ──────
  const onMountClick = (ev: MouseEvent): void => {
    if (ev.target instanceof HTMLCanvasElement) hooks.skipDuel();
  };
  mount.addEventListener('click', onMountClick);

  const onDocKeydown = (ev: KeyboardEvent): void => {
    if (ev.key !== ' ') return;
    const t = ev.target;
    if (
      t instanceof Element &&
      t.closest('input, textarea, select, button, a, dialog, [role="application"]')
    ) {
      return;
    }
    hooks.skipDuel();
    ev.preventDefault();
  };
  document.addEventListener('keydown', onDocKeydown);

  // ── Event flow ───────────────────────────────────────────────────────────
  function applyEvent(e: GameEvent, announceIt: boolean): void {
    tickClocks();
    if (e.kind === 'newgame' || e.kind === 'load') {
      elapsed.w = 0;
      elapsed.b = 0;
    }
    running = e.status === 'active' ? e.turn : null;
    renderClocks();
    renderMoves(e.moveIndex);
    updateBanner(e);
    clearSelection();
    refreshOverlay();
    if (announceIt) announce(describeEvent(e));
  }

  const unsubGame = api.subscribe((e) => applyEvent(e, true));
  const unsubSettings = settings.subscribe(applySettings);

  // ── Assemble ─────────────────────────────────────────────────────────────
  root.append(
    sr,
    banner,
    toolbar,
    el('div', { class: 'cf-side' }, [
      clocksWrap,
      el('section', { class: 'cf-panel', 'aria-label': 'Moves' }, [
        el('h2', { class: 'cf-panel-title' }, ['Moves']),
        moveList,
      ]),
    ]),
  );
  mount.append(root, overlay);
  applySettings(settings.get());
  applyEvent(api.getState(), false);

  return {
    setBoardRect,
    dispose(): void {
      unsubGame();
      unsubSettings();
      window.clearInterval(intervalId);
      document.removeEventListener('keydown', onDocKeydown);
      mount.removeEventListener('click', onMountClick);
      overlay.remove();
      root.remove();
    },
  };
}
