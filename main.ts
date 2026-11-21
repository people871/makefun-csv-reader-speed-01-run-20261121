// Driver for the csv-reader-speed entry: reads every case from
// /input/cases.json (or $MAKEFUN_INPUT_DIR), answers each one alone with
// run() from solve.js, and writes /output/answers.json (or
// $MAKEFUN_OUTPUT_DIR) as a JSON array of the answers, in the cases' order.
// Runs on Node 22, which executes this TypeScript as it stands.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of
// its work runs under it (the house baseline runs the same way, and the
// rules allow an entry to tune V8's flags too).
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types). */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];
const answers: unknown[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) answers[i] = run(cases[i].input);
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
