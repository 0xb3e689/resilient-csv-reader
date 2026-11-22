import { isUtf8 } from 'node:buffer';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { run } from './solve.js';

setFlagsFromString('--no-incremental-marking --liftoff-only');

const input = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const source = readFileSync(join(input, 'cases.json'));
// Latin-1 keeps the original UTF-8 bytes through JSON.parse. Unicode escapes require decoding first.
const encoding = !source.includes('\\u') && isUtf8(source) ? 'latin1' : 'utf8';
const cases = JSON.parse(source.toString(encoding));

const file = openSync(join(output, 'answers.json'), 'w');
const write = (bytes: string | Buffer) => writeFileSync(file, bytes);
try {
  write('[');
  for (let i = 0; i < cases.length; i++) {
    if (i > 0) write(',');
    run(cases[i].input, write, encoding);
  }
  write(']');
} finally {
  closeSync(file);
}
