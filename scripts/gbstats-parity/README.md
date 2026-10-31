# gbstats parity generator

Run `pnpm parity:generate` (or `python3 -I scripts/gbstats-parity/generate.py`).
The system Python 3.9 launcher explicitly loads local modules with `importlib`;
it does not import numerical dependencies. Generation provisions CPython 3.12
with `uv python find --system cpython@3.12` (or `uv python install cpython@3.12`
when absent), creates `.venv` using `uv venv --seed --python <resolved-path>`,
and re-executes its Python with `-I`. The guard requires `sys.prefix` to resolve
to this generator's `.venv`; a re-exec into another prefix fails without looping.
`XP_PYTHON` may select a CPython 3.10–3.12 interpreter instead (using that
interpreter's `venv` module). The implementation and version are checked inside
the venv too.

`_common.py` pins GrowthBook to `0553a68def700abbcaaca8f5096da913f197804c`.
`requirements.lock` preserves upstream `packages/stats/requirements.txt` at that
commit byte-for-byte after its five-line provenance header. The upstream bytes
have SHA256 `1de48780c5ca6d60ef1ee18077bb5ba9528303bcc5281dd93eded9c3bd15b78c`;
the copied resource path is recorded in the header. This is the full hash-locked
freeze (including numpy 1.26.4, scipy 1.13.1, pandas 2.3.1, pydantic 2.11.7,
nbformat 5.10.4 and packaging 25.0), installed with
`pip install --only-binary :all: --require-hashes`.
gbstats is then installed from the Git commit with `--no-deps`, retaining pip's
default build isolation (no `--no-build-isolation`); VCS installs cannot use pip
requirement hashes, and upstream's isolated build backend is not hash-pinned.
`.venv/.xp-stamp` hashes the lock bytes, the interpreter's resolved executable
path, implementation, version and ref (including its resolved commit); a
mismatch rebuilds the environment. Only a successful install writes the stamp.

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
  A `_*` stem without `--include-examples` is an error. Selected Python modules
  and discovered Node steps are printed to stderr, including `none selected`;
  Node scripts filter the forwarded areas themselves.
- `--out <dir>`: output directory; defaults to `packages/stats/fixtures`.
  Only that default destination also writes sorted `last-freeze.txt`.
- `--ref <sha|main>`: full commit SHA, defaulting to the pin. A different ref is
  drift mode. `main` resolves with `git ls-remote`; its resolved commit is used
  for installation, environment invalidation, Python fixture provenance and
  every Node step.
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

`cases()` contains exactly one top-level `return` of a dict display whose keys are string literals of the form `"<area>.<exportName>"`. No `**` unpacking, no computed keys, no other `return` in its top-level body. Values are arbitrary expressions; build case lists with helpers or loops. `--list` reads the keys from the AST without calling `cases()`, and generation fails a module whose returned keys differ from them. Fixture names produced by Node steps are not listed.

Duplicate fixture keys fail both listing and generation. The area before the
first `.` must equal the module stem; the required `_example.py` →
`example.identity` demonstration is the sole exception. Fixture entries and
cases must have exactly the keys shown above, with string module/symbol/name,
a list of cases, `input: {"args": list}`, and unique case names per fixture.
Module-level code must import on
Python 3.9: future annotations, no `match` or newer stdlib imports. Modules may
use `from _common import camel, encode, raises` even under `-I`.

Inputs use TypeScript argument order, camelCase keys and `type` discriminants.
Project upstream outputs to that same TS shape. `_common.camel` recursively
converts snake_case keys after the encoding pre-walk has converted dataclasses
and numpy values to plain objects; `_lead` and `a__b` stay unchanged. Only
`[a-z0-9]_[a-z]` boundaries convert; acronyms require explicit projection where
the TS spelling differs. `raises(expected_exc, fn, *args, **kw)` returns
`{"$raises": "ExceptionName"}` only for an instance of the expected type or tuple
of types; unexpected exceptions propagate, and no exception raises
`AssertionError("expected <name>")`. Each selected module runs independently;
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
`node <file> --out <dir> --ref <40-hex resolved sha>` and the original
`--only <areas>` when set. Node steps always receive a 40-character sha, never
`main`, together with `--out` and the requested `--only` selection. Drift ⇔
sha ≠ PIN; scripts never call `ls-remote`.
No matching files means no Node work. Scripts own their relevant-area filtering
and upstream checks: use pinned source hashes normally, skip those source hashes
when the resolved SHA differs from PIN. Python dependency hashes remain locked.
Use `--ref main --out
<temporary-dir>` to generate comparison fixtures without updating the default
fixtures or `last-freeze.txt`.

The workflow remains dispatch-only until STATS-L9 restores its schedule.
