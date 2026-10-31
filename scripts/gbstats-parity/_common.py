from __future__ import annotations

import dataclasses
import json
import math
import re
from pathlib import Path

PIN = "0553a68def700abbcaaca8f5096da913f197804c"


def _plain(obj):
    # Avoid importing numpy in the system-Python launcher (or --list).
    if type(obj).__module__.split(".")[0] == "numpy":
        return _plain(obj.tolist() if hasattr(obj, "tolist") else obj.item())
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return _plain(dataclasses.asdict(obj))
    if isinstance(obj, float) and not math.isfinite(obj):
        return {"$num": "nan" if math.isnan(obj) else ("inf" if obj > 0 else "-inf")}
    if isinstance(obj, dict):
        return {key: _plain(value) for key, value in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_plain(value) for value in obj]
    return obj


def encode(obj):
    """Encode fixtures, including non-finite and numpy values, deterministically."""
    return json.dumps(_plain(obj), allow_nan=False, sort_keys=True, indent=2) + "\n"


def camel(obj):
    """Recursively turn snake_case dictionary keys into camelCase."""
    if isinstance(obj, dict):
        return {
            # Acronyms stay lower-case; project explicitly when TS differs.
            re.sub(r"(?<=[a-z0-9])_([a-z])", lambda match: match[1].upper(), key)
            if isinstance(key, str) else key: camel(value)
            for key, value in obj.items()
        }
    if isinstance(obj, (list, tuple)):
        return [camel(value) for value in obj]
    return obj


def raises(expected_exc, fn, *args, **kw):
    """Record only the expected exception; unexpected exceptions propagate."""
    try:
        fn(*args, **kw)
    except expected_exc as error:
        return {"$raises": type(error).__name__}
    names = expected_exc if isinstance(expected_exc, tuple) else (expected_exc,)
    raise AssertionError("expected " + " or ".join(exc.__name__ for exc in names))


def pins():
    from importlib.metadata import version

    return {name: version(name) for name in ("numpy", "scipy", "pandas", "pydantic")}


def validate_fixture(fixture):
    """Reject malformed fixture entries before encoding or writing anything."""
    if not isinstance(fixture, dict) or set(fixture) != {"module", "symbol", "cases"}:
        raise ValueError("fixture must contain exactly module, symbol and cases")
    if not isinstance(fixture["module"], str) or not isinstance(fixture["symbol"], str):
        raise TypeError("fixture module and symbol must be strings")
    if not isinstance(fixture["cases"], list):
        raise TypeError("fixture cases must be a list")
    names = set()
    for case in fixture["cases"]:
        if not isinstance(case, dict) or set(case) != {"name", "input", "expected"}:
            raise ValueError("case must contain exactly name, input and expected")
        if not isinstance(case["name"], str):
            raise TypeError("case name must be a string")
        if case["name"] in names:
            raise ValueError("duplicate case name: " + case["name"])
        names.add(case["name"])
        inputs = case["input"]
        if (not isinstance(inputs, dict) or set(inputs) != {"args"}
                or not isinstance(inputs["args"], list)):
            raise TypeError("case input must contain exactly args, a list")


def write_fixture(out_dir, name, module, symbol, cases, ref):
    """Write a fixture; ref must already be a resolved upstream commit SHA."""
    if not re.fullmatch(r"[A-Za-z0-9_]+\.[A-Za-z0-9_]+", name):
        raise ValueError("invalid fixture name: " + name)
    if not re.fullmatch(r"[0-9a-fA-F]{40}", ref):
        raise ValueError("fixture ref must be a resolved 40-character commit SHA")
    validate_fixture({"module": module, "symbol": symbol, "cases": cases})
    fixture = {
        "source": {
            "repo": "growthbook/growthbook", "sha": ref.lower(),
            "module": module, "symbol": symbol, "pins": pins(),
        },
        "cases": cases,
    }
    encoded = encode(camel(_plain(fixture)))
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / (name + ".json")).write_text(encoded, encoding="utf-8")
