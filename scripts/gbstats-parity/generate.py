from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import traceback

# -I omits this directory from sys.path. Explicit loads also keep --list free
# of bytecode writes, even when importing modules that use _common.
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
DEFAULT_OUT = HERE.parent.parent / "packages" / "stats" / "fixtures"
VENV = HERE / ".venv"
LOCK = HERE / "requirements.lock"
REPO = "https://github.com/growthbook/growthbook"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("cannot load " + str(path))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


common = load_module("_common", HERE / "_common.py")


def case_paths(args):
    return [
        path for path in sorted((HERE / "cases").glob("*.py"))
        if path.stem != "__init__"
        and (args.include_examples or not path.stem.startswith("_"))
        and (args.areas is None or path.stem in args.areas)
    ]


def fixture_names(path):
    # cases() may import unavailable numerical libraries. Literal mapping keys
    # can be listed without evaluating those imports or computing statistics.
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and node.name == "cases"]
    if len(functions) != 1:
        raise ValueError("expected one def cases()")
    # Restrict inspection to the returned mapping, never nested case inputs.
    returns = [node for node in functions[0].body if isinstance(node, ast.Return)]
    if len(returns) != 1 or not isinstance(returns[0].value, ast.Dict):
        raise ValueError("--list requires cases() to return a literal fixture dictionary")
    names = set()
    for key in returns[0].value.keys:
        if (not isinstance(key, ast.Constant) or not isinstance(key.value, str)
                or not re.fullmatch(r"[A-Za-z0-9_]+\.[A-Za-z0-9_]+", key.value)):
            raise ValueError("--list requires literal <area>.<exportName> fixture keys")
        if key.value in names:
            raise ValueError("duplicate fixture: " + key.value)
        # The frozen example contract is example.identity in _example.py.
        area = "example" if path.stem == "_example" else path.stem
        if key.value.split(".", 1)[0] != area:
            raise ValueError("fixture area must equal case-module stem: " + key.value)
        names.add(key.value)
    return names


def resolve_ref(ref):
    if ref != "main":
        if not re.fullmatch(r"[0-9a-fA-F]{40}", ref):
            raise ValueError("--ref must be a full commit SHA or main")
        return ref.lower()
    output = subprocess.check_output(
        ["git", "ls-remote", REPO, "main"], text=True,
    )
    lines = output.splitlines()
    if len(lines) != 1 or not re.fullmatch(r"[0-9a-f]{40}\s+refs/heads/main", lines[0]):
        raise RuntimeError("could not resolve growthbook/growthbook main")
    return lines[0].split()[0]


def interpreter():
    override = os.environ.get("XP_PYTHON")
    if override:
        python = override
    else:
        found = subprocess.run(["uv", "python", "find", "--system", "cpython@3.12"],
                               capture_output=True, text=True)
        if found.returncode:
            subprocess.run(["uv", "python", "install", "cpython@3.12"], check=True)
            found = subprocess.run(["uv", "python", "find", "--system", "cpython@3.12"],
                                   check=True, capture_output=True, text=True)
        python = found.stdout.strip()
    identity = subprocess.check_output([
        python, "-I", "-c",
        "import sys; from pathlib import Path; print(Path(sys.executable).resolve()); "
        "print('.'.join(map(str, sys.version_info[:3]))); print(sys.implementation.name)",
    ], text=True).splitlines()
    python, version, implementation = identity
    if implementation != "cpython":
        raise RuntimeError("generator requires CPython")
    parts = tuple(int(part) for part in version.split("."))
    if override:
        if not (3, 10) <= parts[:2] < (3, 13):
            raise RuntimeError("XP_PYTHON must be Python 3.10, 3.11 or 3.12")
    elif parts[:2] != (3, 12):
        raise RuntimeError("uv must provide CPython 3.12")
    return python, version, implementation


def ensure_venv(ref, resolved):
    python, version, implementation = interpreter()
    # Including the resolved SHA makes repeated --ref main runs refresh on drift.
    stamp = hashlib.sha256(
        LOCK.read_bytes() + b"\0" + str(Path(python).resolve()).encode() + b"\0"
        + implementation.encode() + b"\0" + version.encode() + b"\0"
        + ref.encode() + b"\0" + resolved.encode()
    ).hexdigest()
    stamp_path = VENV / ".xp-stamp"
    venv_python = VENV / "bin" / "python"
    if (venv_python.exists() and stamp_path.exists()
            and stamp_path.read_text(encoding="utf-8").strip() == stamp):
        return venv_python
    if VENV.exists():
        shutil.rmtree(VENV)
    if os.environ.get("XP_PYTHON"):
        subprocess.run([python, "-I", "-m", "venv", str(VENV)], check=True)
    else:
        subprocess.run(["uv", "venv", "--seed", "--python", python, str(VENV)], check=True)
    subprocess.run([str(venv_python), "-I", "-m", "pip", "install",
                    "--only-binary", ":all:", "--require-hashes", "-r", str(LOCK)], check=True)
    subprocess.run([str(venv_python), "-I", "-m", "pip", "install", "--no-deps",
                    "gbstats @ git+" + REPO + "@" + resolved
                    + "#subdirectory=packages/stats"], check=True)
    stamp_path.write_text(stamp + "\n", encoding="utf-8")
    return venv_python


def run_cases(args, out, resolved):
    failed = False
    written = set()
    for path in case_paths(args):
        try:
            static_names = fixture_names(path)
            module = load_module("_xp_cases_" + path.stem, path)
            fixtures = module.cases()
            if not isinstance(fixtures, dict):
                raise TypeError("cases() must return a dict")
            if set(fixtures) != static_names:
                raise ValueError("cases() keys differ from the literal return keys")
            for fixture in fixtures.values():
                common.validate_fixture(fixture)
            for name, fixture in sorted(fixtures.items()):
                if name in written:
                    raise ValueError("duplicate fixture: " + name)
                common.write_fixture(out, name, fixture["module"], fixture["symbol"],
                                     fixture["cases"], resolved)
                written.add(name)
        except Exception:
            print("case module failed: " + path.stem, file=sys.stderr)
            traceback.print_exc()
            failed = True
    # A script matching both patterns still runs only once.
    for step in node_steps(args.areas):
        command = ["node", str(step), "--out", str(out), "--ref", resolved]
        if args.only is not None:
            command.extend(["--only", args.only])
        try:
            subprocess.run(command, check=True)
        except Exception:
            print("Node step failed: " + step.name, file=sys.stderr)
            traceback.print_exc()
            failed = True
    return 1 if failed else 0


def node_steps(areas):
    steps = []
    for path in sorted(set(HERE.glob("fetch_*.mjs")) | set(HERE.glob("*_fixtures.mjs"))):
        with path.open(encoding="utf-8") as source:
            header = source.readline().rstrip("\r\n")
        match = re.fullmatch(r"// xp-areas: ([A-Za-z0-9_]+(?:,[A-Za-z0-9_]+)*)", header)
        if match is None:
            raise ValueError("Node step requires a first-line // xp-areas: header: " + path.name)
        if areas is None or areas.intersection(match.group(1).split(",")):
            steps.append(path)
    return steps


def main():
    parser = argparse.ArgumentParser(description="Generate pinned GrowthBook parity fixtures")
    parser.add_argument("--list", action="store_true", help="list without installs or writes")
    parser.add_argument("--include-examples", action="store_true")
    parser.add_argument("--only", help="comma-separated case-module stems")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--ref", default=common.PIN, help="full commit SHA or main (drift)")
    args = parser.parse_args()
    args.areas = set(args.only.split(",")) if args.only is not None else None
    if args.areas is not None and ("" in args.areas or any(
            not re.fullmatch(r"[A-Za-z0-9_]+", area) for area in args.areas)):
        parser.error("--only requires comma-separated module stems")
    if (args.areas is not None and not args.include_examples
            and any(area.startswith("_") for area in args.areas)):
        parser.error("--only selecting a _* stem requires --include-examples")
    print("Python modules: " + (", ".join(path.stem for path in case_paths(args))
                               or "none selected"), file=sys.stderr)
    print("Node steps: " + (", ".join(step.name for step in node_steps(args.areas))
                           or "none selected")
          + (" (not run in --list mode)" if args.list else ""), file=sys.stderr)
    if args.list:
        names = set()
        failed = False
        for path in case_paths(args):
            try:
                load_module("_xp_cases_" + path.stem, path)
                module_names = fixture_names(path)
                duplicates = names & module_names
                if duplicates:
                    raise ValueError("duplicate fixture: " + ", ".join(sorted(duplicates)))
                names.update(module_names)
            except Exception:
                print("case module failed: " + path.stem, file=sys.stderr)
                traceback.print_exc()
                failed = True
        for name in sorted(names):
            print(name)
        return 1 if failed else 0

    # Carry the resolution through exec: resolving main again could label
    # commit A's installed code as commit B if upstream advances during setup.
    carried = os.environ.pop("_XP_GBSTATS_RESOLVED_REF", None)
    resolved = carried if carried is not None else resolve_ref(args.ref)
    if not re.fullmatch(r"[0-9a-f]{40}", resolved):
        raise ValueError("invalid resolved upstream commit")
    if Path(sys.prefix).resolve() != VENV.resolve():
        if carried is not None:
            raise RuntimeError("re-exec did not land in " + str(VENV))
        python = ensure_venv(args.ref, resolved)
        environment = dict(os.environ, _XP_GBSTATS_RESOLVED_REF=resolved)
        os.execve(str(python),
                  [str(python), "-I", str(Path(__file__).resolve()), *sys.argv[1:]],
                  environment)
    if Path(sys.prefix).resolve() != VENV.resolve():
        raise RuntimeError("re-exec did not land in " + str(VENV))
    assert sys.implementation.name == "cpython", "generator requires CPython"
    if os.environ.get("XP_PYTHON"):
        assert (3, 10) <= sys.version_info[:2] < (3, 13), "XP_PYTHON requires Python 3.10–3.12"
    else:
        assert sys.version_info[:2] == (3, 12), "generator requires CPython 3.12"
    out = args.out.resolve()
    if out == DEFAULT_OUT:
        freeze = subprocess.check_output([sys.executable, "-I", "-m", "pip", "freeze"], text=True)
        (HERE / "last-freeze.txt").write_text(
            "\n".join(sorted(freeze.splitlines())) + "\n", encoding="utf-8",
        )
    return run_cases(args, out, resolved)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
