"""
Circular-import detection for mmr-admin.

Run:  python3 -m pytest test_imports.py -v
  or: python3 test_imports.py

Discovers every .py module in this directory (excluding __pycache__, tests,
and this file itself) and attempts to import it in a subprocess.  A subprocess
is used so that:
  1. Each module is tested in isolation — one bad import can't mask another.
  2. Circular imports surface as ImportError / AttributeError immediately.
  3. Side effects (like Flask app startup) don't pollute the test runner.

Exit code 0 = all clean, 1 = at least one module failed to import.
"""

import subprocess
import sys
from pathlib import Path

SKIP = {"test_imports.py", "conftest.py"}
HERE = Path(__file__).resolve().parent


def _discover_modules() -> list[str]:
    """Return importable module names (without .py) for every Python file."""
    modules = []
    for f in sorted(HERE.glob("*.py")):
        if f.name.startswith("_") or f.name in SKIP:
            continue
        modules.append(f.stem)
    # Also check sub-packages (one level deep) for future Blueprint split
    for d in sorted(HERE.iterdir()):
        if d.is_dir() and (d / "__init__.py").exists():
            pkg = d.name
            for f in sorted(d.glob("*.py")):
                if f.name.startswith("_"):
                    continue
                modules.append(f"{pkg}.{f.stem}")
    return modules


def _try_import_subprocess(module_name: str) -> tuple[bool, str, bool]:
    """Import a module in a child process.

    Returns (ok, stderr, is_missing_dep).
    - ok=True: imported fine
    - ok=False, is_missing_dep=True: failed due to missing third-party package
      (acceptable in CI without full deps installed)
    - ok=False, is_missing_dep=False: structural error like circular import,
      syntax error, or AttributeError — this is a real failure
    """
    # The import script catches ModuleNotFoundError for third-party deps
    # and exits with code 2 (missing dep) vs code 1 (real error).
    script = f"""
import sys, traceback
sys.path.insert(0, {str(HERE)!r})
try:
    import {module_name}
except ModuleNotFoundError as e:
    # Only treat as "missing dep" if it's NOT one of our own modules
    own_modules = {set(_discover_module_names())!r}
    missing = str(e).replace("No module named ", "").strip("'").strip('"')
    root = missing.split(".")[0]
    if root in own_modules:
        traceback.print_exc()
        sys.exit(1)  # real error — our own module can't be found / circular
    else:
        print(f"MISSING_DEP: {{e}}", file=sys.stderr)
        sys.exit(2)  # third-party dep not installed
except Exception:
    traceback.print_exc()
    sys.exit(1)
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        timeout=30,
    )
    is_missing_dep = result.returncode == 2
    ok = result.returncode == 0
    return ok, result.stderr.strip(), is_missing_dep


def _discover_module_names() -> list[str]:
    """Return just the top-level stem names for our own modules."""
    names = []
    for f in sorted(HERE.glob("*.py")):
        if f.name.startswith("_") or f.name in SKIP:
            continue
        names.append(f.stem)
    for d in sorted(HERE.iterdir()):
        if d.is_dir() and (d / "__init__.py").exists():
            names.append(d.name)
    return names


# ---------------------------------------------------------------------------
# pytest-compatible tests (also works standalone)
# ---------------------------------------------------------------------------

def _make_test(mod_name: str):
    """Factory: return a test function for one module."""
    def test_func():
        ok, err, is_missing_dep = _try_import_subprocess(mod_name)
        if is_missing_dep:
            import pytest
            pytest.skip(f"Missing third-party dep: {err}")
        assert ok, f"Failed to import '{mod_name}':\n{err}"
    test_func.__name__ = f"test_import_{mod_name.replace('.', '_')}"
    test_func.__qualname__ = test_func.__name__
    return test_func


# Dynamically generate test_import_<module> functions so pytest discovers them
_modules = _discover_modules()
for _mod in _modules:
    globals()[f"test_import_{_mod.replace('.', '_')}"] = _make_test(_mod)


# ---------------------------------------------------------------------------
# Standalone runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    modules = _discover_modules()
    if not modules:
        print("No modules found to test.")
        sys.exit(0)

    print(f"Testing {len(modules)} module(s) for import errors...\n")
    failures = []
    skipped = []
    for mod in modules:
        ok, err, is_missing_dep = _try_import_subprocess(mod)
        if ok:
            print(f"  ✅  {mod}")
        elif is_missing_dep:
            print(f"  ⏭️   {mod}  (skipped — {err})")
            skipped.append(mod)
        else:
            print(f"  ❌  {mod}")
            for line in err.splitlines()[-3:]:
                print(f"       {line}")
            failures.append(mod)

    print()
    if skipped:
        print(f"Skipped {len(skipped)} module(s) due to missing third-party deps.")
    if failures:
        print(f"FAILED: {len(failures)} module(s) have structural import errors:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print(f"All {len(modules) - len(skipped)} tested module(s) imported cleanly.")
        sys.exit(0)
