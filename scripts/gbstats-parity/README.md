# gbstats parity generator

Run `pnpm parity:generate` (or `python3 -I scripts/gbstats-parity/generate.py`).
The system Python 3.9 launcher explicitly loads local modules with `importlib`;
it does not import numerical dependencies. Generation provisions CPython 3.12
with `uv python find/install 3.12`, creates `.venv` using `uv venv --seed`, and
re-executes its Python with `-I`. `XP_PYTHON` may select a Python 3.10–3.12
interpreter instead (using that interpreter's `venv` module).

`_common.py` pins GrowthBook to `0553a68def700abbcaaca8f5096da913f197804c`.
`requirements.lock` preserves upstream `packages/stats/requirements.txt` at that
commit byte-for-byte after its five-line provenance header. The upstream bytes
have SHA256 `1de48780c5ca6d60ef1ee18077bb5ba9528303bcc5281dd93eded9c3bd15b78c`;
the copied resource path is recorded in the header. This is the full hash-locked
freeze (including numpy 1.26.4, scipy 1.13.1, pandas 2.3.1, pydantic 2.11.7,
nbformat 5.10.4 and packaging 25.0), installed with `pip --require-hashes`.
gbstats is then installed from the Git commit with `--no-deps`; VCS installs
cannot use pip requirement hashes. `.venv/.xp-stamp` hashes the lock bytes,
interpreter version and ref (including its resolved commit); a mismatch rebuilds
the environment. Only a successful install writes the stamp.

Flags:

- `--list`: load selected modules and print sorted fixture names, without a venv,
  installs, network, bytecode or other writes. It reads literal fixture-name
  keys in the dictionary returned directly by `cases()` via the Python AST,
  without calling `cases()`. Unsupported computed mappings fail explicitly.
- `--include-examples`: include `cases/_*.py` (otherwise skipped).
  `cases/__init__.py` is always excluded. Try `--list --include-examples` to see
  `example.identity`.
- `--only <area>[,<area>…]`: select module stems, such as `statistics,moments`.
  To select the example, use `--include-examples --only _example`.
- `--out <dir>`: output directory; defaults to `packages/stats/fixtures`.
  Only that default destination also writes sorted `last-freeze.txt`.
- `--ref <sha|main>`: full commit SHA, defaulting to the pin. A different ref is
  drift mode. `main` resolves with `git ls-remote`; its resolved commit is used
  for installation, environment invalidation and Python fixture provenance.
  Dependency hashes remain enforced in drift mode.

## Case-module contract

`cases/<area>.py` defines `def cases() -> dict`, mapping fixture names
`"<area>.<exportName>"` to the following shape:

```python
from __future__ import annotations


def cases() -> dict:
    # Import gbstats/numpy/scipy here, never at module level.
    return {
        "example.identity": {
            "module": "example",
            "symbol": "identity",
            "cases": [
                {"name": "number", "input": {"args": [7]}, "expected": 7},
            ],
        },
    }
```

Return a dictionary literal directly from `cases()`, with literal fixture-name
keys, so `--list` can discover them without executing statistics. Its values may
use computed cases or helpers. Module-level code must import on
Python 3.9: future annotations, no `match` or newer stdlib imports. Modules may
use `from _common import camel, encode, raises` even under `-I`.

Inputs use TypeScript argument order, camelCase keys and `type` discriminants.
Project upstream outputs to that same TS shape. `_common.camel` recursively
converts snake_case keys; `raises(fn, *args, **kw)` returns the result or
`{"$raises": "ExceptionName"}`. Each selected module runs independently;
failures print its name and traceback, other modules continue, and the final
exit status is non-zero if any module or Node step failed.

Fixtures contain `source: {repo, sha, module, symbol, pins}` and `cases`. `pins`
records installed numpy/scipy/pandas/pydantic versions, with no timestamps or
Python version. Encoding recursively handles dataclasses, numpy scalars/arrays
and tuples; non-finite floats become `{"$num": "inf"|"-inf"|"nan"}`. JSON uses
sorted keys, two-space indentation, `allow_nan=False` and a final newline.

## Node steps and drift

After Python modules, the generator runs each discovered `fetch_*.mjs` and
`*_fixtures.mjs` once, sorted by filename, with
`node <file> --out <dir> --ref <ref>` and the original `--only <areas>` when set.
No matching files means no Node work. Scripts own their relevant-area filtering
and upstream checks: use pinned source hashes normally, skip those source hashes
for drift refs. Python dependency hashes remain locked. Use `--ref main --out
<temporary-dir>` to generate comparison fixtures without updating the default
fixtures or `last-freeze.txt`.

The workflow remains dispatch-only until STATS-L9 restores its schedule.
