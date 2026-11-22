# Resilient CSV Reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/0xb3e689/resilient-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/0xb3e689/resilient-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A CSV reader that matches the csv-reader 1.0.0 recovery rules and runs on Node.js without additional packages. The CommonJS driver reads compact case JSON directly into WebAssembly memory and decodes the CSV strings in place. The same module scans those strings with SIMD and writes JSON directly. Other JSON layouts use Node's JSON parser. A JavaScript CSV parser handles lone surrogates and inputs that exceed the WebAssembly buffers.

Import `run({ text, header })` from `solve.js` to parse one input.

## Run it

Use Node.js 22.18 or later. Put the case array in `input/cases.json`.

```sh
mkdir -p output
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=output node main.ts
npm test
```

Read the resulting array from `output/answers.json`.

## Rebuild the WebAssembly module

The repository includes `reader.wasm`. To rebuild it from `reader.c`, use Clang and LLD with WebAssembly support.

```sh
clang --target=wasm32 -Oz -msimd128 -ffreestanding -fno-builtin -c reader.c -o /tmp/csv-reader.o
wasm-ld --no-entry --export=parse --export=errors_size --export=__heap_base \
  --export=decode_cases --export=cases_offset --strip-all /tmp/csv-reader.o -o reader.wasm
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=93p1fwth&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
