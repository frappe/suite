#!/usr/bin/env python3
"""Download the newest coverage artifact for each suite on a base branch."""

import argparse
import io
import json
import os
import subprocess
import zipfile
from urllib.parse import quote

ARTIFACTS = {
    "suite-backend-coverage": ("coverage.xml", "backend.xml"),
    "suite-frontend-coverage": ("cobertura-coverage.xml", "frontend.xml"),
}
MAX_ARTIFACT_BYTES = 20 * 1024 * 1024


def gh(*args: str) -> bytes:
    result = subprocess.run(["gh", "api", *args], capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace").strip())
    return result.stdout


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--branch", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    query = (
        f"repos/{args.repo}/actions/workflows/suite-ci.yml/runs"
        f"?branch={quote(args.branch, safe='')}&event=push&status=success&per_page=100"
    )
    runs = json.loads(gh(query))["workflow_runs"]
    remaining = dict(ARTIFACTS)
    os.makedirs(args.output, exist_ok=True)

    for run in runs:
        artifacts = json.loads(gh(f"repos/{args.repo}/actions/runs/{run['id']}/artifacts"))["artifacts"]
        for artifact in artifacts:
            if artifact["name"] not in remaining or artifact["expired"]:
                continue
            source_name, output_name = remaining[artifact["name"]]
            try:
                archive = gh(f"repos/{args.repo}/actions/artifacts/{artifact['id']}/zip")
                if len(archive) > MAX_ARTIFACT_BYTES:
                    print(f"Skipping oversized baseline artifact {artifact['name']}.")
                    continue
                with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
                    member = next(
                        (name for name in bundle.namelist() if os.path.basename(name) == source_name), None
                    )
                    if member is None:
                        print(f"Could not find {source_name} in {artifact['name']}.")
                        continue
                    if bundle.getinfo(member).file_size > MAX_ARTIFACT_BYTES:
                        print(f"Skipping oversized {source_name} in {artifact['name']}.")
                        continue
                    with (
                        bundle.open(member) as source,
                        open(os.path.join(args.output, output_name), "wb") as target,
                    ):
                        target.write(source.read())
                remaining.pop(artifact["name"])
            except (RuntimeError, OSError, zipfile.BadZipFile) as error:
                print(f"Could not use baseline artifact {artifact['name']}: {error}")
        if not remaining:
            break

    for artifact_name in remaining:
        print(f"No {artifact_name} baseline found on {args.branch}.")


if __name__ == "__main__":
    main()
