import { describe, expect, it } from 'vitest';
import { sanitizedText, sanitizeText } from '../../../../src/shared/http/sanitize.js';

describe('sanitizeText', () => {
  it.each([
    ['<script>alert(1)</script>Hello', 'Hello'],
    ['<b>bold</b> text', 'bold text'],
    ['<img src=x onerror=alert(1)>hi', 'hi'],
    ['<a href="javascript:alert(1)">click</a>', 'click'],
    ['5 > 3 & 2 < 4', '5 &gt; 3 &amp; 2 &lt; 4'],
  ])('neutralises markup: %s', (input, expected) => {
    expect(sanitizeText(input)).toBe(expected);
  });

  it.each([
    ['Urdu', 'مصنوعی ذہانت کیا ہے؟'],
    ['Urdu with ZWNJ', 'می\u200Cخواهم'],
    ['Arabic', 'ما هو الذكاء الاصطناعي؟'],
    ['emoji with ZWJ sequences', '👨\u200D👩\u200D👧 rocks 🚀 and 👍🏽'],
    ['Chinese', '什么是检索增强生成？'],
    ['multi-line', 'line one\nline two\ttabbed'],
  ])('keeps %s intact', (_name, input) => {
    expect(sanitizeText(input)).toBe(input);
  });

  it('composes combining marks (NFC) without rewriting compatibility characters', () => {
    expect(sanitizeText('cafe\u0301')).toBe('café');
    expect(sanitizeText('café')).toBe('café');
    expect(sanitizeText('x² + ﬁ')).toBe('x² + ﬁ');
  });

  it('removes control, bidi-override and zero-width-space characters', () => {
    expect(sanitizeText('a\u0000b\u0007c')).toBe('abc');
    expect(sanitizeText('admin\u202Etxt.exe')).toBe('admintxt.exe');
    expect(sanitizeText('pass\u200Bword\uFEFF')).toBe('password');
  });

  it('treats SQL-looking text as plain text', () => {
    expect(sanitizeText("'; DROP TABLE users; --")).toBe("'; DROP TABLE users; --");
  });
});

describe('sanitizedText schema', () => {
  const schema = sanitizedText(10);

  it('rejects text that is empty once markup is removed', () => {
    expect(schema.safeParse('<script>x</script>   ').success).toBe(false);
  });

  it('measures length in code points, before and after escaping', () => {
    expect(schema.safeParse('😀'.repeat(10)).success).toBe(true);
    expect(schema.safeParse('a'.repeat(11)).success).toBe(false);
    expect(schema.safeParse('<<<<<<').success).toBe(false); // 6 chars become 24 after escaping
  });

  it('rejects non-strings', () => {
    expect(schema.safeParse(['a']).success).toBe(false);
    expect(schema.safeParse(42).success).toBe(false);
  });
});
