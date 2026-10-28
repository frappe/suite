"""Compare real Framework builds on one runner with identical inputs and dependencies."""

import hashlib
import json
import os
import statistics
import subprocess
import time
from pathlib import Path

import psutil

root = Path.cwd()
app = root / "bench/apps/frappe"
output = root / "benchmark-results"
output.mkdir(exist_ok=True)
results = []


def snapshot():
    files = []
    for directory in [app / "frappe/public/studio", app / "frappe/public/flow"]:
        assert directory.is_dir(), directory
        files.extend(path for path in directory.rglob("*") if path.is_file())
    files.append(app / "frappe/www/flow/index.html")
    return {str(path.relative_to(app)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(files)}


def build(mode, index):
    env = {**os.environ, "FRAPPE_DOCKER_BUILD": "1"}
    env.pop("FRAPPE_BUILD_CONCURRENCY", None)
    if mode == "sequential":
        env["FRAPPE_BUILD_CONCURRENCY"] = "1"
    started = time.perf_counter()
    peak_rss = 0
    with (output / f"{index}-{mode}.log").open("w") as log:
        process = subprocess.Popen(
            ["node", "esbuild", "--production", "--apps", "frappe", "--run-build-command"],
            cwd=app, env=env, stdout=log, stderr=subprocess.STDOUT,
        )
        parent = psutil.Process(process.pid)
        while process.poll() is None:
            rss = 0
            try:
                processes = [parent, *parent.children(recursive=True)]
            except psutil.NoSuchProcess:
                processes = []
            for child in processes:
                try:
                    rss += child.memory_info().rss
                except psutil.NoSuchProcess:
                    pass
            peak_rss = max(peak_rss, rss)
            time.sleep(0.1)
    elapsed = time.perf_counter() - started
    if process.returncode:
        raise RuntimeError((output / f"{index}-{mode}.log").read_text()[-16000:])
    hashes = snapshot()
    (output / f"{index}-{mode}-files.json").write_text(json.dumps(hashes, indent=2))
    result = {"mode": mode, "seconds": elapsed, "peak_summed_rss_bytes": peak_rss,
              "output_files": len(hashes)}
    print(json.dumps(result), flush=True)
    return result, hashes


print(json.dumps({"cpus": os.cpu_count(), "memory_bytes": psutil.virtual_memory().total}), flush=True)
_, reference = build("sequential", "warmup")
for index, mode in enumerate(["sequential", "parallel", "parallel", "sequential", "sequential", "parallel"]):
    result, hashes = build(mode, index)
    changed = [path for path in reference.keys() | hashes.keys() if reference.get(path) != hashes.get(path)]
    result["changed_output_files"] = changed
    results.append(result)
    (output / "results.json").write_text(json.dumps(results, indent=2))
    assert not changed, f"Output changed in {mode}: {changed[:20]}"

summary = {mode: {metric: statistics.median(row[metric] for row in results if row["mode"] == mode)
                  for metric in ["seconds", "peak_summed_rss_bytes"]}
           for mode in ["sequential", "parallel"]}
summary["all_outputs_identical"] = True
(output / "summary.json").write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2), flush=True)
