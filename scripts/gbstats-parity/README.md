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
  only Node steps whose declared areas intersect the selection are run.
  For example, `--list --only capping` selects the capping module and no Node steps.
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

`cases/_gb.py` supplies `to_gb`, `from_gb`, `moments_ts`, and `freq_ts`.
Use `from _gb import to_gb, from_gb, moments_ts, freq_ts` for the needed helpers.
The generator loads case modules by absolute path and preloads only `_common`;
under `-I`, `cases/` is absent from `sys.path`. Before that import, load `_gb.py`
with `importlib.util.spec_from_file_location("_gb", Path(__file__).with_name("_gb.py"))`,
register the resulting module in `sys.modules["_gb"]`, and call its loader's
`exec_module` (only if `_gb` is not already registered). See `statistics.py`.
The helper imports gbstats inside converter calls, so `--list` needs no numerical
dependencies. `moments_ts` drops `post_stratification_applied`; `freq_ts` converts
CI tuples to lists and leaves numpy infinities for `encode`.

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
Every Node step must declare its areas on its first line, for example
`// xp-areas: sdk,assignment`. A missing or malformed header is an error.
With `--only`, the generator runs only steps whose declared areas intersect
the selection; without it, all steps run. No matching files means no Node work.
Scripts own their upstream checks: use pinned source hashes normally, skip those source hashes
when the resolved SHA differs from PIN. Python dependency hashes remain locked.
Use `--ref main --out
<temporary-dir>` to generate comparison fixtures without updating the default
fixtures or `last-freeze.txt`.

The weekly `gbstats-parity.yml` workflow (Monday at 06:17 UTC, or manual dispatch)
generates against `main` into a temporary directory and compares numerically
at the parity tolerance. It opens an issue for an environment/generation failure
or a material change, including the last 200 log lines, then fails the job.
Successful runs create no issue. Header/platform differences do not trigger
reports, and committed fixtures are never rewritten by the workflow.

## SDK assignment fixtures

`node scripts/gbstats-parity/fetch_sdk_cases.mjs` projects the upstream SDK
`cases.json` into four SDK fixtures (upstream calls the range group
`getBucketRange`). `node scripts/gbstats-parity/sdk_composed_fixtures.mjs`
selects the upstream assignment declarations from `util.ts`, transpiles them
with the root's installed `@swc/core`, and evaluates the brief's compositions
without loading the local port. Both GET the pinned SHA above, fail before any
output writes on a SHA256 mismatch, accept `--out <dir>` and `--ref <40-hex sha>`,
and accept/ignore `--only`. A different SHA skips source hash checks for drift.
The composed script stubs upstream `process`/`console` in a temporary module
that it removes after importing; the pure port drops `console.error` and
`process.env` checks. Regenerate into a temporary `--out` and byte-compare all
nine fixtures to confirm deterministic output.
