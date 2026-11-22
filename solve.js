import { readFileSync } from 'node:fs';
import { readCsv } from './fallback.js';

const wasmURL = new URL('./reader.wasm', import.meta.url);
let reader;

/** Return the parsed result, or stream its JSON to a synchronous sink that consumes each chunk immediately. */
export function run(input, write) {
  const text = String(input.text);
  const header = input.header === true;

  if (text.length <= 8 * 1024 * 1024 && text.isWellFormed()) {
    reader ??= new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmURL))).exports;
    const { memory, parse, errors_size, __heap_base } = reader;
    const inputStart = __heap_base.value;
    const inputCapacity = 3 * text.length;
    const rowStart = inputStart + inputCapacity + 16;
    const rowCapacity = 3 * inputCapacity + 64;
    const errorStart = rowStart + rowCapacity;
    const errorCapacity = inputCapacity + 1024;
    const needed = errorStart + errorCapacity - memory.buffer.byteLength;
    if (needed > 0) memory.grow(Math.ceil(needed / 65536));

    const bytes = Buffer.from(memory.buffer);
    const length = bytes.write(text, inputStart, inputCapacity, 'utf8');
    const rowsSize = parse(inputStart, length, +header, rowStart, rowCapacity, errorStart, errorCapacity);
    if (rowsSize) {
      const rows = bytes.subarray(rowStart, rowStart + rowsSize);
      const errors = bytes.subarray(errorStart, errorStart + errors_size());
      if (write) {
        write(rows);
        write(errors);
        return;
      }
      return JSON.parse(rows.toString('utf8') + errors.toString('utf8'));
    }
  }

  // The string parser preserves lone surrogates and handles results larger than the scratch buffers.
  const result = readCsv({ text, header });
  if (write) write(Buffer.from(JSON.stringify(result)));
  else return result;
}
