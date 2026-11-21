import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './solve.js';

test('repairs broken rows in encounter order and tracks physical lines', () => {
  const text = '\uFEFF\r\nname,note\r\n"東京","a\rb\r\nc\n"\r!\nshort\nlong,ok,extra\r\n"open,end';
  assert.deepEqual(run({ text, header: true }), {
    columns: ['name', 'note'],
    rows: [['東京', 'a\nb\nc\n!'], ['short', ''], ['long', 'ok'], ['"open', 'end']],
    errors: [
      { code: 'stray_cr', line: 3, row: 0 },
      { code: 'quote_junk', line: 3, row: 0 },
      { code: 'short_row', line: 7, row: 1, fields: 1 },
      { code: 'long_row', line: 8, row: 2, extra: ['extra'] },
      { code: 'unterminated_quote', line: 9, row: 3 },
    ],
  });
});

test('keeps empty quoted and delimited records, including a trailing field', () => {
  assert.deepEqual(run({ text: '\r\r\n""\n"""x""",', header: false }), {
    columns: null,
    rows: [[''], ['"x"']],
    errors: [
      { code: 'stray_cr', line: 1, row: 0 },
      { code: 'long_row', line: 3, row: 1, extra: [''] },
    ],
  });
});
