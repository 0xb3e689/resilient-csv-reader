const { closeSync, openSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { setFlagsFromString } = require('node:v8');
const { readCases, run } = require('./runner.cjs');

setFlagsFromString('--no-incremental-marking --liftoff-only');

const input = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const { cases, encoding } = readCases(join(input, 'cases.json'));

const file = openSync(join(output, 'answers.json'), 'w');
const write = (bytes) => writeFileSync(file, bytes);
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
