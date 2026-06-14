"""Build monkey binary for current platform."""
import subprocess, sys, hashlib, platform
from pathlib import Path

def build():
    plat = platform.system().lower()
    plat_name = {"darwin": "macos", "linux": "linux", "windows": "windows"}.get(plat, plat)
    name = f"monkey-{plat_name}"
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile", "--clean", "--noconfirm",
        f"--name={name}",
        "--add-data=monkey:monkey",
        "monkey/main.py",
    ]
    print(f"Building {name}...")
    subprocess.run(cmd, check=True)
    binary = Path(f"dist/{name}")
    if not binary.exists() and plat == "windows":
        binary = Path(f"dist/{name}.exe")
    if binary.exists():
        sha256 = hashlib.sha256(binary.read_bytes()).hexdigest()
        size_mb = binary.stat().st_size / 1024 / 1024
        print(f"Built: {binary} ({size_mb:.1f}MB)")
        print(f"SHA256: {sha256}")
        print("\nSidecar prêt pour packaging desktop.")
    else:
        print("Build failed — binary not found in dist/")

if __name__ == "__main__":
    build()
