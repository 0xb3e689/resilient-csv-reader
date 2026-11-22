import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { run } from './solve.js';
import runner from './runner.cjs';

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

test('writes JSON bytes for quoted Unicode across SIMD blocks', () => {
  const field = 'a'.repeat(15);
  const input = { text: `key,note\r\n${field},"x""y\r\n東京"!\n`, header: true };
  const expected = {
    columns: ['key', 'note'],
    rows: [[field, 'x"y\n東京!']],
    errors: [{ code: 'quote_junk', line: 2, row: 0 }],
  };
  let json = '';
  run(input, (bytes) => { json += bytes.toString('utf8'); });
  assert.equal(json, JSON.stringify(expected));
  assert.deepEqual(run(input), expected);
});

test('keeps lone UTF-16 surrogates in both output modes', () => {
  const input = { text: '\ud800,\udc00' };
  const expected = { columns: null, rows: [['\ud800', '\udc00']], errors: [] };
  let json = '';
  run(input, (bytes) => { json += bytes.toString('utf8'); });
  assert.equal(json, JSON.stringify(expected));
  assert.deepEqual(run(input), expected);
});

test('recovers all errors when an output exceeds the WASM scratch limit', () => {
  const input = { text: '\r'.repeat(100) + ',x' };
  const expected = {
    columns: null,
    rows: [['', 'x']],
    errors: Array.from({ length: 100 }, () => ({ code: 'stray_cr', line: 1, row: 0 })),
  };
  let json = '';
  run(input, (bytes) => { json += bytes.toString('utf8'); });
  assert.equal(json, JSON.stringify(expected));
  assert.deepEqual(run(input), expected);
});

test('passes raw UTF-8 bytes through JSON decoding and CSV parsing', () => {
  const input = { text: '\uFEFF東京,🌊\r\n' + '\r'.repeat(100) + 'café,雪', header: true };
  const byteInput = JSON.parse(Buffer.from(JSON.stringify(input)).toString('latin1'));
  let json = '';
  run(byteInput, (bytes) => { json += bytes.toString('utf8'); }, 'latin1');
  assert.equal(json, JSON.stringify(run(input)));
});

function parseDocument(source) {
  const dir = mkdtempSync(join(tmpdir(), 'csv-cases-'));
  try {
    const path = join(dir, 'cases.json');
    writeFileSync(path, source);
    const { cases, encoding } = runner.readCases(path);
    return cases.map(({ input }) => run(input, undefined, encoding));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('decodes compact JSON case strings with escapes and retains batch order', () => {
  const inputs = [
    { text: '名,note\r\n東京,"say ""hi""\r\n🌊"\r\n', header: true },
    { text: '\\path,/text,\t\b\f\r\n', header: false },
    { text: '', header: true },
  ];
  const cases = inputs.map((input, id) => ({ id: `case-\"-${id}`, input }));
  assert.deepEqual(parseDocument(JSON.stringify(cases)), inputs.map((input) => run(input)));
});

test('handles Unicode escapes and alternate JSON layouts and rejects invalid input', () => {
  const source = String.raw`[ {"input":{"header":false,"text":"\ud800,\u00e9"},"id":"case"} ]`;
  assert.deepEqual(parseDocument(source), [run({ text: '\ud800,é', header: false })]);
  const invalid = String.raw`[{"id":"case","input":{"text":"bad\q","header":false}}]`;
  assert.throws(() => parseDocument(invalid), SyntaxError);
});
