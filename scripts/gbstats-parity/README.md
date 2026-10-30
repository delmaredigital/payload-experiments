# gbstats parity fixtures

`generate.py` runs the Python `gbstats` package on a fixed set of inputs and writes
`packages/stats/fixtures/<function>.json` with `{ cases: [{ input, expected }] }`.
The TypeScript tests in `packages/stats/tests/parity/` load the same files.

Run with `python3 -I` (the `-I` isolates the interpreter from the working directory).
Pinned: `gbstats==0.8.0` (`requirements.txt`). Regenerate only when adding a function
or when the weekly drift workflow reports a change you have read and understood;
record the reason in CHANGELOG.
