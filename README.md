# csv-reader-speed: single-pass slice/indexOf CSV reader, ~2x end-to-end and ~4x parse-only vs csv-reader 1.0.0

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/people871/makefun-csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/people871/makefun-csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` returns
exactly csv-reader's answer (`{columns, rows, errors}`) for every
`{text, header}` input, and `main.ts` answers every case in
`/input/cases.json` with it, writing `/output/answers.json`.

## Technique

- Plain fields are taken as one `slice()` up to the next comma or line break,
  located with native `indexOf` — no per-character string building.
- Whole records with no quote and no stray CR go through `String.split(',')`.
- Quoted fields are scanned for the closing quote with `indexOf`; doubled
  quotes, embedded CRLF/lone-CR (read as LF), junk after the closing quote
  (`quote_junk`), a quote that never closes (`unterminated_quote`, re-read as
  unquoted), stray CRs (`stray_cr`), short rows (padded, `short_row`) and
  long rows (cut, `long_row`) all follow csv-reader 1.0.0 exactly, including
  error order and the `line`/`row` of every error.
- No dependencies, no caching between cases, deterministic output.

## Measured (practice set, 6 cases, 10.2M chars)

- Exactness: 6/6 practice cases byte-identical to the reference answers;
  25,090 handcrafted + fuzz cases and 18 freshly generated sets (31M chars)
  all identical to csv-reader 1.0.0.
- Speed, fresh Node processes, end to end (`main.ts` incl. JSON in/out):
  ~0.92 s CPU vs ~1.86 s for the house baseline (~2.0x).
- Speed, parse only (`run()` on the practice set): ~0.19 s CPU vs
  ~0.86 s for csv-reader 1.0.0 (~4x).

## Run

```sh
node main.ts   # reads /input/cases.json (or $MAKEFUN_INPUT_DIR), writes /output/answers.json
```
