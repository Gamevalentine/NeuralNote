"""Snapshot MIT-licensed MuScriptor source inside the NOTIQ AI Core workspace.

Requires the NeuralNote-pinned Git submodule already checked out.
Never alters original NeuralNote or checks in the GGUF model.
"""
from pathlib import Path
from shutil import copytree, copy2
import subprocess

root = Path(__file__).resolve().parents[2]
source = root / "ThirdParty" / "muscriptor.cpp"
dest = root / "notiq-ai-core" / "vendor" / "muscriptor"
if not (source / "cpp" / "CMakeLists.txt").is_file():
    raise SystemExit("Missing MuScriptor submodule checkout. See NOTIQ AI Core README.")
if dest.exists():
    raise SystemExit("NOTIQ copy already exists; refusing to overwrite local changes.")
dest.mkdir(parents=True)
copytree(source / "cpp", dest / "cpp")
copy2(source / "LICENSE", dest / "LICENSE")
revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
(dest / "SOURCE_REVISION").write_text(revision + "\n", encoding="utf-8")
print(f"NOTIQ AI Core C++ snapshot created from commit {revision}")
