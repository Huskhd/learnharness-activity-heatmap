"""Portable fixture tests; no host installation, Git, or network required."""

import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "package_plugin.py"
spec = importlib.util.spec_from_file_location("package_plugin", SCRIPT)
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.root = self.base / "repo"
        self.dist = self.root / "dist"
        self.dist.mkdir(parents=True)
        self.manifest = {
            "apiVersion": 1, "id": "activity-heatmap", "version": "1.0.0",
            "main": "main.js", "backend": "backend.cjs", "styles": "styles.css",
        }
        self.write_manifest()
        for name in ("main.js", "backend.cjs", "styles.css"):
            (self.dist / name).write_text(f"/* {name} */\n", encoding="utf-8")
        (self.root / "version.txt").write_text("1.0.0\n", encoding="utf-8")
        (self.root / ".release-please-manifest.json").write_text('{".": "1.0.0"}\n', encoding="utf-8")
        self.output = self.base / "output"

    def write_manifest(self):
        (self.dist / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf-8")

    def symlink(self, target, link, is_directory=False):
        try:
            link.symlink_to(target, target_is_directory=is_directory)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f"Symlinks unavailable on this host: {error}")

    def test_valid_archive_layout_and_contents(self):
        assets = self.dist / "assets"
        assets.mkdir()
        (assets / "icon.svg").write_text("<svg/>", encoding="utf-8")
        archive_path = packager.package_plugin(self.root, self.output)
        self.assertEqual(archive_path.name, "activity-heatmap-1.0.0.zip")
        with zipfile.ZipFile(archive_path) as archive:
            expected = sorted(f"activity-heatmap/dist/{p.relative_to(self.dist).as_posix()}"
                              for p in self.dist.rglob("*") if p.is_file())
            self.assertEqual(archive.namelist(), expected)
            self.assertIsNone(archive.testzip())
            for item in archive.infolist():
                self.assertEqual(item.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual((item.external_attr >> 16) & 0o777, 0o644)
            self.assertEqual(archive.read("activity-heatmap/dist/assets/icon.svg"), b"<svg/>")

    def test_repeated_archives_have_identical_bytes(self):
        first = packager.package_plugin(self.root, self.output).read_bytes()
        (self.dist / "main.js").touch()
        second = packager.package_plugin(self.root, self.output).read_bytes()
        self.assertEqual(first, second)

    def test_mismatched_versions(self):
        for filename, content in (("version.txt", "1.0.1"),
                                  (".release-please-manifest.json", '{".": "1.0.1"}')):
            with self.subTest(filename=filename):
                path = self.root / filename
                before = path.read_text()
                path.write_text(content)
                with self.assertRaisesRegex(ValueError, "versions must match"):
                    packager.validate_package(self.root)
                path.write_text(before)

    def test_missing_runtime_file(self):
        for name in ("main.js", "backend.cjs", "styles.css"):
            with self.subTest(name=name):
                path = self.dist / name
                before = path.read_bytes()
                path.unlink()
                with self.assertRaises(ValueError):
                    packager.validate_package(self.root)
                path.write_bytes(before)

    def test_manifest_entry_escape(self):
        for field in ("main", "backend", "styles"):
            with self.subTest(field=field):
                before = self.manifest[field]
                self.manifest[field] = "../outside.js"
                self.write_manifest()
                with self.assertRaises(ValueError):
                    packager.validate_package(self.root)
                self.manifest[field] = before

    def test_invalid_manifest_values(self):
        for field, value in (("apiVersion", True), ("apiVersion", "1"), ("apiVersion", 2),
                             ("id", "other"), ("version", 1), ("version", "1.0"),
                             ("version", "01.0.0"), ("version", "1.0.0-beta.1"),
                             ("version", "../1.0.0"), ("version", "1.0.0\n")):
            with self.subTest(field=field, value=value):
                before = self.manifest[field]
                self.manifest[field] = value
                self.write_manifest()
                with self.assertRaises(ValueError):
                    packager.validate_package(self.root)
                self.manifest[field] = before

    def test_nonobject_and_malformed_manifest(self):
        for content in ("[]", "null", "{"):
            with self.subTest(content=content):
                (self.dist / "manifest.json").write_text(content)
                with self.assertRaises(ValueError):
                    packager.validate_package(self.root)

    def test_forbidden_paths(self):
        for name in ("data", "node_modules", ".git", ".env", ".env.local", "credentials.json",
                     "secrets.json", "private.key", "cert.pem", "package-lock.json", "id_rsa"):
            with self.subTest(name=name):
                path = self.dist / name
                path.mkdir()
                with self.assertRaisesRegex(ValueError, "non-distributable"):
                    packager.validate_package(self.root)
                path.rmdir()

    def test_unsafe_zip_components(self):
        # Test directly: several of these names cannot be created on Windows.
        for name in ("..", "../escape", "a\\b", "a:b", "newline\n", "trailing.", "trailing ", "CON.txt"):
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    packager._validate_component(name)

    def test_symlink_file_escape(self):
        target = self.base / "outside.txt"
        target.write_text("private")
        self.symlink(target, self.dist / "outside.txt")
        with self.assertRaisesRegex(ValueError, "Symlinks"):
            packager.validate_package(self.root)

    def test_symlink_directory_escape(self):
        self.symlink(self.base, self.dist / "assets", is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlinks"):
            packager.validate_package(self.root)

    def test_symlink_dist(self):
        real_dist = self.root / "real-dist"
        self.dist.rename(real_dist)
        self.symlink(real_dist, self.dist, is_directory=True)
        with self.assertRaisesRegex(ValueError, "dist must be"):
            packager.validate_package(self.root)

    def test_symlink_version_file(self):
        original = self.root / "version.txt"
        original.rename(self.root / "real-version.txt")
        self.symlink(self.root / "real-version.txt", original)
        with self.assertRaises(ValueError):
            packager.validate_package(self.root)

    def test_output_inside_dist(self):
        for output in (self.dist, self.dist / "releases"):
            with self.subTest(output=output):
                with self.assertRaisesRegex(ValueError, "outside dist"):
                    packager.package_plugin(self.root, output)
        self.assertFalse((self.dist / "releases").exists())

    def test_symlink_output_directory(self):
        destination = self.base / "real-output"
        destination.mkdir()
        self.symlink(destination, self.output, is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlinks"):
            packager.package_plugin(self.root, self.output)

    def test_symlink_output_parent(self):
        destination = self.base / "real-output"
        destination.mkdir()
        self.symlink(destination, self.output, is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlinks"):
            packager.package_plugin(self.root, self.output / "nested")

    def test_symlink_output_file(self):
        self.output.mkdir()
        destination = self.base / "keep.txt"
        destination.write_text("keep")
        self.symlink(destination, self.output / "activity-heatmap-1.0.0.zip")
        with self.assertRaisesRegex(ValueError, "symlink"):
            packager.package_plugin(self.root, self.output)
        self.assertEqual(destination.read_text(), "keep")

    def test_case_insensitive_collision(self):
        upper = self.dist / "MAIN.js"
        if upper.exists():
            self.skipTest("Fixture requires a case-sensitive filesystem")
        upper.write_text("collision")
        with self.assertRaisesRegex(ValueError, "collision"):
            packager.validate_package(self.root)

    def test_check_cli_writes_no_archive(self):
        script = self.root / "scripts" / SCRIPT.name
        script.parent.mkdir()
        shutil.copyfile(SCRIPT, script)
        result = subprocess.run([sys.executable, str(script), "--check", "--output-dir", str(self.output)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Validated activity-heatmap 1.0.0", result.stdout)
        self.assertFalse(self.output.exists())

    def test_cli_packages_from_another_working_directory(self):
        script = self.root / "scripts" / SCRIPT.name
        script.parent.mkdir()
        shutil.copyfile(SCRIPT, script)
        result = subprocess.run([sys.executable, str(script), "--output-dir", str(self.output)],
                                cwd=self.base, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.output / "activity-heatmap-1.0.0.zip").is_file())


if __name__ == "__main__":
    unittest.main()
