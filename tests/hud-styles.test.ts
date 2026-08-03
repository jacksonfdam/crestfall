import { describe, expect, it } from 'vitest';

import { HUD_CSS } from '../src/hudStyles.ts';

/**
 * The HUD floats over the board, so its stylesheet decides whether the board is
 * clickable at all. These assertions exist because it once was not: a
 * `#ui-root > *` wildcard granting pointer events (specificity 1-0-0) outranked
 * the base stylesheet's `.cf-overlay { pointer-events: none }` (0-1-0), the
 * keyboard cursor overlay swallowed every click over the board, and no piece
 * could be selected with the mouse.
 *
 * Text assertions are a weak proxy for rendered behaviour, so they are kept
 * narrow: each one guards a specific mistake that has actually happened.
 */
describe('HUD stylesheet', () => {
  it('is a syntactically closed stylesheet', () => {
    // A stray backtick would have terminated the template literal early; this is
    // the other way that file has broken.
    expect(HUD_CSS).not.toContain('`');
    const opens = (HUD_CSS.match(/{/g) ?? []).length;
    const closes = (HUD_CSS.match(/}/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(opens).toBeGreaterThan(10);
  });

  it('lets clicks through the HUD container', () => {
    expect(HUD_CSS).toMatch(/#ui-root\s*{[^}]*pointer-events:\s*none/);
  });

  it('never grants pointer events to every child of the HUD container', () => {
    // The overlay is one of those children, and it covers the whole board.
    expect(HUD_CSS).not.toMatch(/#ui-root\s*>\s*\*\s*{[^}]*pointer-events:\s*auto/);
  });

  it('keeps the board cursor overlay transparent to the pointer', () => {
    expect(HUD_CSS).toMatch(/#ui-root\s+\.cf-overlay\s*{[^}]*pointer-events:\s*none/);
  });

  it('still opts the actual controls back in', () => {
    expect(HUD_CSS).toMatch(/\.cf-ui\s*>\s*\*[^{]*{[^}]*pointer-events:\s*auto/);
  });

  it('gives the board the whole viewport', () => {
    expect(HUD_CSS).toMatch(/#stage\s*{[^}]*position:\s*absolute/);
    expect(HUD_CSS).toMatch(/#stage\s*{[^}]*inset:\s*0/);
  });
});
