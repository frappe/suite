#!/usr/bin/env python3
"""Replace the generated coverage block at the end of a pull request body."""

import argparse
import json
import re
import subprocess

START = "<!-- suite-coverage:start -->"
END = "<!-- suite-coverage:end -->"


def replace_coverage(body: str, report: str) -> str:
    block = f"{START}\n{report.strip()}\n{END}"
    pattern = re.compile(rf"\n*{re.escape(START)}.*?{re.escape(END)}", re.DOTALL)
    without_old = pattern.sub("", body or "").rstrip()
    return f"{without_old}\n\n{block}\n" if without_old else f"{block}\n"


def gh(*args: str, input_text: str | None = None) -> str:
    result = subprocess.run(
        ["gh", *args],
        input=input_text,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--pr", required=True)
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()

    pull_request = json.loads(gh("api", f"repos/{args.repo}/pulls/{args.pr}"))
    if pull_request["head"]["sha"] != args.head_sha:
        print("The PR has advanced since this coverage run; leaving its description unchanged.")
        return
    with open(args.report, encoding="utf-8") as handle:
        body = replace_coverage(pull_request.get("body") or "", handle.read())

    gh(
        "api",
        "-X",
        "PATCH",
        f"repos/{args.repo}/pulls/{args.pr}",
        "--input",
        "-",
        input_text=json.dumps({"body": body}),
    )
    print("Updated the PR coverage block.")


if __name__ == "__main__":
    main()
