import { describe, expect, it } from 'vitest';

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  INVITE_TTL_MS,
  MAX_NAME_LENGTH,
  channelName,
  codeFromSearch,
  generateCode,
  inviteLink,
  isValidCode,
  normalizeCode,
  opposite,
  parseMsg,
  sanitizeName,
} from '../src/net/protocol.ts';

describe('invite codes', () => {
  it('generates codes of the declared shape', () => {
    let seed = 1;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 500; i++) {
      const code = generateCode(random);
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isValidCode(code)).toBe(true);
    }
  });

  it('excludes characters that are confusable when read aloud', () => {
    for (const ch of 'ILO01') expect(CODE_ALPHABET).not.toContain(ch);
  });

  it('rejects codes of the wrong shape', () => {
    for (const bad of ['', 'ABC', 'ABCDEFG', 'abcdef', 'ABCDE1', 'ABCDEI', 'AB CDE']) {
      expect(isValidCode(bad)).toBe(false);
    }
  });

  it('normalises what people actually paste', () => {
    expect(normalizeCode('ab-cd-ef')).toBe('ABCDEF');
    expect(normalizeCode(' a b c d e f ')).toBe('ABCDEF');
    expect(normalizeCode('abc/def?')).toBe('ABCDEF');
  });

  it('agrees with the SQL default on the invite window', () => {
    expect(INVITE_TTL_MS).toBe(15 * 60 * 1000);
  });
});

describe('links', () => {
  it('builds a shareable link', () => {
    expect(inviteLink('https://crestfall.vercel.app', '/', 'ABCDEF')).toBe(
      'https://crestfall.vercel.app/?join=ABCDEF',
    );
  });

  it('does not stack query strings when the host already has one', () => {
    expect(inviteLink('https://x.dev', '/?join=OLD123', 'ABCDEF')).toBe(
      'https://x.dev/?join=ABCDEF',
    );
  });

  it('reads a code back out of a URL', () => {
    expect(codeFromSearch('?join=ABCDEF')).toBe('ABCDEF');
    expect(codeFromSearch('?a=1&join=ab-cd-ef')).toBe('ABCDEF');
  });

  it('refuses a malformed or absent code', () => {
    expect(codeFromSearch('')).toBeNull();
    expect(codeFromSearch('?join=')).toBeNull();
    expect(codeFromSearch('?join=nope')).toBeNull();
    expect(codeFromSearch('?other=ABCDEF')).toBeNull();
  });

  it('namespaces the channel by code', () => {
    expect(channelName('ABCDEF')).toBe('crestfall:ABCDEF');
  });
});

describe('names', () => {
  it('keeps ordinary names intact, spaces and hyphens included', () => {
    expect(sanitizeName('Jackson Mafra')).toBe('Jackson Mafra');
    expect(sanitizeName('Anne-Marie')).toBe('Anne-Marie');
    expect(sanitizeName('Þórr')).toBe('Þórr');
  });

  it('strips control characters and collapses whitespace', () => {
    expect(sanitizeName('a\u0000b')).toBe('ab');
    expect(sanitizeName('a\u001fb')).toBe('ab');
    expect(sanitizeName('  wide   gaps  ')).toBe('wide gaps');
    expect(sanitizeName('line\nbreak')).toBe('line break');
  });

  it('caps length', () => {
    expect(sanitizeName('x'.repeat(100))).toHaveLength(MAX_NAME_LENGTH);
  });

  it('can return empty, so callers must check', () => {
    expect(sanitizeName('   ')).toBe('');
    expect(sanitizeName('\u0000')).toBe('');
  });
});

describe('sides', () => {
  it('flips', () => {
    expect(opposite('w')).toBe('b');
    expect(opposite('b')).toBe('w');
  });
});

describe('parseMsg', () => {
  const hello = { type: 'hello', clientId: 'c1', name: 'Ada', side: 'w', seed: 7 };
  const move = { type: 'move', clientId: 'c1', from: 12, to: 28, ply: 1 };

  it('accepts well-formed messages', () => {
    expect(parseMsg(hello)).toEqual({
      type: 'hello',
      clientId: 'c1',
      name: 'Ada',
      side: 'w',
      seed: 7,
    });
    expect(parseMsg(move)).toEqual({
      type: 'move',
      clientId: 'c1',
      from: 12,
      to: 28,
      promotion: undefined,
      ply: 1,
    });
    expect(parseMsg({ type: 'bye', clientId: 'c1', reason: 'resigned' })).toEqual({
      type: 'bye',
      clientId: 'c1',
      reason: 'resigned',
    });
  });

  it('rejects non-objects and unknown types', () => {
    for (const bad of [null, undefined, 3, 'hello', [], { type: 'nope', clientId: 'c' }]) {
      expect(parseMsg(bad)).toBeNull();
    }
  });

  it('requires a client id on every message', () => {
    expect(parseMsg({ ...hello, clientId: '' })).toBeNull();
    expect(parseMsg({ ...move, clientId: undefined })).toBeNull();
  });

  it('rejects squares outside the board', () => {
    for (const bad of [-1, 64, 1.5, NaN, '12', null]) {
      expect(parseMsg({ ...move, from: bad })).toBeNull();
      expect(parseMsg({ ...move, to: bad })).toBeNull();
    }
  });

  it('rejects a bad ply', () => {
    for (const bad of [-1, 1.5, NaN, '1', undefined]) {
      expect(parseMsg({ ...move, ply: bad })).toBeNull();
    }
  });

  it('only allows real promotion pieces', () => {
    expect(parseMsg({ ...move, promotion: 'q' })).toMatchObject({ promotion: 'q' });
    for (const bad of ['k', 'p', 'x', 1, null]) {
      expect(parseMsg({ ...move, promotion: bad })).toBeNull();
    }
  });

  it('rejects a hello with a bad side, seed or name', () => {
    expect(parseMsg({ ...hello, side: 'x' })).toBeNull();
    expect(parseMsg({ ...hello, side: undefined })).toBeNull();
    expect(parseMsg({ ...hello, seed: 'big' })).toBeNull();
    expect(parseMsg({ ...hello, seed: Infinity })).toBeNull();
    expect(parseMsg({ ...hello, name: '   ' })).toBeNull();
    expect(parseMsg({ ...hello, name: 42 })).toBeNull();
  });

  it('sanitises the name it hands on, and floors the seed', () => {
    const parsed = parseMsg({ ...hello, name: '  Ada\u0000  Lovelace ', seed: 7.9 });
    expect(parsed).toMatchObject({ name: 'Ada Lovelace', seed: 7 });
  });

  it('treats an unknown bye reason as a plain departure', () => {
    expect(parseMsg({ type: 'bye', clientId: 'c1', reason: 'exploded' })).toMatchObject({
      reason: 'left',
    });
  });
});
