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
            re.sub(r"_([a-zA-Z0-9])", lambda match: match[1].upper(), key)
            if isinstance(key, str) else key: camel(value)
            for key, value in obj.items()
        }
    if isinstance(obj, (list, tuple)):
        return [camel(value) for value in obj]
    return obj


def raises(fn, *args, **kw):
    """Record an expected upstream exception; otherwise return the result."""
    try:
        return fn(*args, **kw)
    except Exception as error:
        return {"$raises": type(error).__name__}


def pins():
    from importlib.metadata import version

    return {name: version(name) for name in ("numpy", "scipy", "pandas", "pydantic")}


def write_fixture(out_dir, name, module, symbol, cases, ref):
    """Write a fixture; ref must already be a resolved upstream commit SHA."""
    if not re.fullmatch(r"[A-Za-z0-9_]+\.[A-Za-z0-9_]+", name):
        raise ValueError("invalid fixture name: " + name)
    if not re.fullmatch(r"[0-9a-fA-F]{40}", ref):
        raise ValueError("fixture ref must be a resolved 40-character commit SHA")
    fixture = {
        "source": {
            "repo": "growthbook/growthbook", "sha": ref.lower(),
            "module": module, "symbol": symbol, "pins": pins(),
        },
        "cases": cases,
    }
    encoded = encode(fixture)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / (name + ".json")).write_text(encoded, encoding="utf-8")
