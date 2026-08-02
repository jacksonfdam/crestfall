export const BOARD_CUES = [
  'move',
  'capture-resolve',
  'check',
  'promote',
  'castle',
  'game-over-win',
  'game-over-draw',
  'ui-click',
  'ui-toggle',
  'illegal',
] as const;

export const DUEL_CUES = [
  'whoosh',
  'impact-metal',
  'impact-stone',
  'impact-shield',
  'impact-flesh',
  'stone-grind',
  'rune',
  'wing',
  'horse',
  'fall',
] as const;

export const VOCAL_CUES = [
  'vocal:huscarl',
  'vocal:berserkr',
  'vocal:volva',
  'vocal:jotunn',
  'vocal:valkyrie',
  'vocal:jarl',
] as const;

export const CUE_NAMES = [
  ...BOARD_CUES,
  ...DUEL_CUES,
  ...VOCAL_CUES,
] as const;

export type CueName = (typeof CUE_NAMES)[number];

export function isCueName(name: string): name is CueName {
  return (CUE_NAMES as readonly string[]).includes(name);
}
