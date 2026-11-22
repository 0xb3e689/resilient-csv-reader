const { isUtf8 } = require('node:buffer');
const { closeSync, fstatSync, openSync, readFileSync, readSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const rawInput = Symbol('CSV byte offsets');
let reader;

function loadReader() {
  reader ??= new WebAssembly.Instance(new WebAssembly.Module(readFileSync(join(__dirname, 'reader.wasm')))).exports;
  return reader.__heap_base.value;
}

function memory(size) {
  const wasm = reader.memory;
  const needed = size - wasm.buffer.byteLength;
  if (needed > 0) wasm.grow(Math.ceil(needed / 65536));
  return Buffer.from(wasm.buffer);
}

function render(start, length, capacity, output, header, write) {
  const rowsCapacity = 3 * capacity + 64;
  const errorStart = output + rowsCapacity;
  const errorCapacity = capacity + 1024;
  const bytes = memory(errorStart + errorCapacity);
  const rowsSize = reader.parse(start, length, +header, output, rowsCapacity, errorStart, errorCapacity);
  if (!rowsSize) return null;
  const rows = bytes.subarray(output, output + rowsSize);
  const errors = bytes.subarray(errorStart, errorStart + reader.errors_size());
  if (write) {
    write(rows);
    write(errors);
    return true;
  }
  return JSON.parse(rows.toString('utf8') + errors.toString('utf8'));
}

/** Return the parsed result, or stream its JSON to a synchronous byte sink. */
function run(input, write, encoding = 'utf8') {
  const raw = input[rawInput];
  const source = raw ? undefined : input.text;
  let text = raw ? '' : String(source);
  const header = input.header === true;
  if (raw) {
    const [start, length, output] = raw;
    const result = render(start, length, length, output, header, write);
    if (result !== null) return write ? undefined : result;
    text = Buffer.from(reader.memory.buffer, start, length).toString('utf8');
  } else {
    const encoded = encoding === 'latin1' && typeof source === 'string';
    if (text.length <= 8 * 1024 * 1024 && (encoded || text.isWellFormed())) {
      const start = loadReader();
      const capacity = encoded ? text.length : 3 * text.length;
      const output = start + capacity + 16;
      const length = memory(output).write(text, start, capacity, encoded ? 'latin1' : 'utf8');
      const result = render(start, length, capacity, output, header, write);
      if (result !== null) return write ? undefined : result;
    }
    if (encoded) text = Buffer.from(text, 'latin1').toString('utf8');
  }

  // Preserve lone surrogates and handle results larger than the scratch buffers.
  const result = require('./fallback.cjs')({ text, header });
  if (write) write(Buffer.from(JSON.stringify(result)));
  else return result;
}

function readCompactCases(fd, size) {
  const start = loadReader();
  const output = start + size + 17;
  const bytes = memory(output);
  // Positional reads leave the original file available to JSON.parse if this layout is unsupported.
  let length = 0;
  while (length <= size) {
    const count = readSync(fd, bytes, start + length, size + 1 - length, length);
    if (!count) break;
    length += count;
  }
  if (length !== size || !isUtf8(bytes.subarray(start, start + length))) return null;
  const count = reader.decode_cases(start, length);
  if (count < 0) return null;

  const table = reader.cases_offset();
  const cases = [];
  for (let i = 0; i < count; i++) {
    const at = table + 12 * i;
    cases.push({ input: {
      header: bytes.readUInt32LE(at + 8) === 1,
      [rawInput]: [bytes.readUInt32LE(at), bytes.readUInt32LE(at + 4), output],
    } });
  }
  return { cases, encoding: 'utf8' };
}

function readCases(path) {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (stat.isFile() && stat.size >= 2 && stat.size <= 32 * 1024 * 1024) {
      const compact = readCompactCases(fd, stat.size);
      if (compact) return compact;
    }
    const source = readFileSync(fd);
    const encoding = !source.includes('\\u') && isUtf8(source) ? 'latin1' : 'utf8';
    return { cases: JSON.parse(source.toString(encoding)), encoding };
  } finally {
    closeSync(fd);
  }
}

function main() {
  require('node:v8').setFlagsFromString('--no-incremental-marking --liftoff-only');
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
}

module.exports = { main, run, readCases };
