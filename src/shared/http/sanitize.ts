import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';

// eslint-disable-next-line no-control-regex -- deliberately matches C0/C1 control characters (keeps \t \n \r)
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/** Bidi overrides/isolates (Trojan Source), zero-width space, word joiners and BOM. ZWJ/ZWNJ are kept. */
const INVISIBLE_FORMATTING = /[\u200B\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

const codePoints = (value: string): number => Array.from(value).length;

const stripUnsafeCharacters = (value: string): string =>
  value.replace(CONTROL_CHARACTERS, '').replace(INVISIBLE_FORMATTING, '');

/**
 * Free-text sanitisation: strip control and invisible formatting characters, drop all HTML
 * (script/style contents included), then strip again and NFC-normalise. The second pass is required because
 * sanitize-html decodes numeric entities (e.g. &#x202E;) into the very characters the first pass removes, and
 * normalising last keeps text composed when stripping removes a character between a letter and a combining mark.
 * The result is HTML-escaped (&, <, >), so it is safe as HTML text content; quotes are not escaped, so it must be
 * escaped again before use inside an HTML attribute value.
 */
export function sanitizeText(input: string): string {
  const html = sanitizeHtml(stripUnsafeCharacters(input), {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  });
  return stripUnsafeCharacters(html).normalize('NFC').trim();
}

export const sanitizedText = (maxLength: number) =>
  z
    .string()
    .refine((value) => codePoints(value) <= maxLength, { message: `must be at most ${maxLength} characters` })
    .transform(sanitizeText)
    .refine((value) => value.length > 0, { message: 'must not be empty once markup is removed' })
    .refine((value) => codePoints(value) <= maxLength, {
      message: `must be at most ${maxLength} characters once special characters are escaped`,
    });
