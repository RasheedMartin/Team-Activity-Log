"""Every third-party import in the app must be a *runtime* dependency (not just a dev extra),
or the production image crashes at startup. That happened once with httpx."""

import ast
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# import name -> distribution name, where they differ (or arrive through another dependency)
PROVIDED_BY = {"PIL": "pillow", "argon2": "argon2-cffi", "pydantic_settings": "pydantic-settings", "pydantic": "fastapi", "starlette": "fastapi", "botocore": "boto3", "elastic_transport": "elasticsearch"}


def runtime_deps() -> set[str]:
    deps = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["dependencies"]
    return {d.split("[")[0].split(">")[0].split("<")[0].split("=")[0].strip().lower() for d in deps}


def imported_top_levels() -> set[str]:
    names: set[str] = set()
    for f in (ROOT / "src" / "tal").rglob("*.py"):
        for node in ast.walk(ast.parse(f.read_text())):
            if isinstance(node, ast.Import):
                names |= {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names.add(node.module.split(".")[0])
    return {n for n in names if n not in sys.stdlib_module_names and n not in ("tal", "__future__")}


def test_third_party_imports_are_runtime_dependencies():
    deps = runtime_deps()
    missing = sorted(n for n in imported_top_levels() if PROVIDED_BY.get(n, n).lower().replace("_", "-") not in deps)
    assert not missing, f"imported by the app but not in [project.dependencies]: {missing}"
