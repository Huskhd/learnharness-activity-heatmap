"""Validate and package the plugin using only Python's standard library."""

import argparse
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import zipfile


VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\Z")
REQUIRED_ENTRIES = {"main": "main.js", "backend": "backend.cjs", "styles": "styles.css"}
FORBIDDEN_NAMES = {
    "data", "node_modules", "__pycache__", "venv", "credentials.json", "secrets.json",
    "package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml",
    "id_rsa", "id_ed25519",
}
FORBIDDEN_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".keystore", ".pyc"}
WINDOWS_RESERVED = {"con", "prn", "aux", "nul"} | {
    f"{prefix}{number}" for prefix in ("com", "lpt") for number in range(1, 10)
}


def _regular_file(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Expected a regular file, not a symlink: {path}")


def _read_json(path):
    _regular_file(path)
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def _validate_component(name):
    lower = name.lower()
    if (
        name.startswith(".") or lower in FORBIDDEN_NAMES
        or Path(lower).suffix in FORBIDDEN_SUFFIXES
        or lower.split(".")[0] in WINDOWS_RESERVED
        or name.endswith((".", " "))
        or any(ord(char) < 32 or char in '\\/:*?"<>|' for char in name)
    ):
        raise ValueError(f"Unsafe or non-distributable dist path component: {name!r}")


def validate_package(root):
    """Return (version, {archive_path: bytes}) after validating a repository root.

    All dot-prefixed entries, known dependency/state directories, and common
    credential files are refused. This is a packaging guard, not a secret scanner.
    """
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError(f"Expected a repository directory, not a symlink: {root}")
    dist = root / "dist"
    if dist.is_symlink() or not dist.is_dir():
        raise ValueError("dist must be a real directory, not a symlink")

    manifest = _read_json(dist / "manifest.json")
    if type(manifest.get("apiVersion")) is not int or manifest["apiVersion"] != 1:
        raise ValueError("manifest apiVersion must be the integer 1")
    if manifest.get("id") != "activity-heatmap":
        raise ValueError("manifest id must be activity-heatmap")
    version = manifest.get("version")
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise ValueError("manifest version must be numeric SemVer x.y.z")
    for field, filename in REQUIRED_ENTRIES.items():
        if manifest.get(field) != filename:
            raise ValueError(f"manifest {field} must be {filename}")
        _regular_file(dist / filename)

    version_file = root / "version.txt"
    _regular_file(version_file)
    release_manifest = _read_json(root / ".release-please-manifest.json")
    if version_file.read_text(encoding="utf-8").strip() != version or release_manifest.get(".") != version:
        raise ValueError("dist/manifest.json, version.txt, and release manifest versions must match")

    files = {}
    seen = set()

    def visit(directory):
        for path in sorted(directory.iterdir(), key=lambda item: item.name):
            _validate_component(path.name)
            if path.is_symlink():
                raise ValueError(f"Symlinks are not distributable: {path}")
            relative = path.relative_to(dist).as_posix()
            folded = relative.casefold()
            if folded in seen:
                raise ValueError(f"Case-insensitive path collision: {relative}")
            seen.add(folded)
            if path.is_dir():
                visit(path)
            elif path.is_file():
                files[f"activity-heatmap/dist/{relative}"] = path.read_bytes()
            else:
                raise ValueError(f"Only regular files/directories are distributable: {path}")

    visit(dist)
    return version, dict(sorted(files.items()))


def _validate_output(root, output_dir):
    output = Path(output_dir).absolute()
    for path in (output, *output.parents):
        if path.is_symlink():
            raise ValueError(f"Output path must not traverse symlinks: {path}")
    output = output.resolve()
    dist = (Path(root) / "dist").resolve()
    if output == dist or dist in output.parents:
        raise ValueError("Output directory must be outside dist")
    if output.exists() and not output.is_dir():
        raise ValueError("Output directory is not a directory")
    return output


def package_plugin(root, output_dir):
    """Write a deterministic, CRC-checked ZIP and return its path."""
    version, files = validate_package(root)
    output = _validate_output(root, output_dir)
    target = output / f"activity-heatmap-{version}.zip"
    if target.is_symlink() or (target.exists() and not target.is_file()):
        raise ValueError("Output archive must be a regular file, not a symlink")
    output.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=output, suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
        # Stored entries avoid platform/zlib-dependent compression output.
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as archive:
            for name, content in files.items():
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(info, content)
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise ValueError("Generated archive failed its CRC check")
        if target.is_symlink():
            raise ValueError("Output archive became a symlink")
        os.replace(temporary, target)
        return target
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, help="Destination directory (required unless --check)")
    parser.add_argument("--check", action="store_true", help="Validate only; do not create an archive")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    if not args.check and args.output_dir is None:
        parser.error("--output-dir is required unless --check is used")
    try:
        if args.check:
            version, files = validate_package(root)
            if args.output_dir is not None:
                _validate_output(root, args.output_dir)
            print(f"Validated activity-heatmap {version}: {len(files)} distributable files")
        else:
            print(package_plugin(root, args.output_dir))
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Packaging failed: {error}\n")


if __name__ == "__main__":
    main()
