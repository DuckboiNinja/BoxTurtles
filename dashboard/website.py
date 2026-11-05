"""Build the local React UI if needed, then serve it with the Python API."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    os.chdir(ROOT)
    try:
        import uvicorn
        import fastapi
        import sqlalchemy
    except ImportError:
        print("Install dependencies first: python -m pip install -r requirements.txt")
        return 1
    frontend = ROOT / "frontend"
    built = frontend / "dist" / "index.html"
    inputs = [frontend / "package.json", frontend / "package-lock.json", frontend / "index.html", frontend / "vite.config.js"]
    inputs += list((frontend / "src").rglob("*")) + list((frontend / "public").rglob("*"))
    stale = not built.exists() or any(p.is_file() and p.stat().st_mtime > built.stat().st_mtime for p in inputs)
    if stale:
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
        if not npm and os.name == "nt":
            portable = sorted((ROOT / ".tools").glob("node-*-win-x64/npm.cmd"))
            if portable:
                npm = str(portable[-1])
                os.environ["PATH"] = str(portable[-1].parent) + os.pathsep + os.environ.get("PATH", "")
        if not npm:
            print("Install Node.js 22 LTS, then run npm ci and npm run build inside frontend/.")
            return 1
        if not (frontend / "node_modules").exists():
            print("Frontend dependencies are missing. Run npm ci inside frontend/, then restart.")
            return 1
        print("Building the React dashboard…", flush=True)
        result = subprocess.run([npm, "run", "build"], cwd=frontend)
        if result.returncode:
            return result.returncode
    print("\nAsian Baddies is available at http://127.0.0.1:8000", flush=True)
    print("API docs: http://127.0.0.1:8000/docs · Press Ctrl+C to stop.\n", flush=True)
    # Import after building so FastAPI finds the production frontend.
    from backend.app.main import app
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
