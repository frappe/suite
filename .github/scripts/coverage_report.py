#!/usr/bin/env python3
"""Render backend and frontend Cobertura totals as a PR Markdown fragment."""

import argparse
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass

MAX_XML_BYTES = 10 * 1024 * 1024


@dataclass
class Coverage:
    covered: int
    total: int
    branches_covered: int | None
    branches_total: int | None


def parse_coverage(path: str) -> Coverage | None:
    try:
        if os.path.getsize(path) > MAX_XML_BYTES:
            raise ValueError("report exceeds the 10 MiB limit")
        with open(path, "rb") as handle:
            data = handle.read(MAX_XML_BYTES + 1)
        if b"<!ENTITY" in data.upper():
            raise ValueError("XML entity declarations are not allowed")
        root = ET.fromstring(data)
        covered = int(root.attrib["lines-covered"])
        total = int(root.attrib["lines-valid"])
        branches_covered = root.attrib.get("branches-covered")
        branches_total = root.attrib.get("branches-valid")
        return Coverage(
            covered,
            total,
            int(branches_covered) if branches_covered is not None else None,
            int(branches_total) if branches_total is not None else None,
        )
    except (FileNotFoundError, KeyError, OSError, ET.ParseError, ValueError) as error:
        print(f"Coverage unavailable for {path}: {error}")
        return None


def metric(covered: int | None, total: int | None) -> str:
    if covered is None or total is None or total == 0:
        return "Unavailable"
    return f"**{100 * covered / total:.1f}%** ({covered:,} / {total:,})"


def rate(covered: int | None, total: int | None) -> float | None:
    if covered is None or total is None or total == 0:
        return None
    return 100 * covered / total


def delta(current: float | None, baseline: float | None) -> str:
    if current is None or baseline is None:
        return ""
    change = current - baseline
    if abs(change) < 0.05:
        return " (+0%)"
    return f" ({change:+.1f}%)"


def row(label: str, coverage: Coverage | None, baseline: Coverage | None) -> str:
    if coverage is None:
        return f"| {label} | Unavailable | Unavailable |"
    baseline_lines = rate(baseline.covered, baseline.total) if baseline else None
    baseline_branches = rate(baseline.branches_covered, baseline.branches_total) if baseline else None
    return (
        f"| {label} | {metric(coverage.covered, coverage.total)}"
        f"{delta(rate(coverage.covered, coverage.total), baseline_lines)} | "
        f"{metric(coverage.branches_covered, coverage.branches_total)}"
        f"{delta(rate(coverage.branches_covered, coverage.branches_total), baseline_branches)} |"
    )


def summary_metric(label: str, coverage: Coverage | None, baseline: Coverage | None) -> str:
    if coverage is None:
        return f"{label} unavailable"
    current = rate(coverage.covered, coverage.total)
    if current is None:
        return f"{label} unavailable"
    baseline_rate = rate(baseline.covered, baseline.total) if baseline else None
    return f"{label} {current:.1f}%{delta(current, baseline_rate)}"


def render(
    backend: Coverage | None,
    frontend: Coverage | None,
    backend_baseline: Coverage | None,
    frontend_baseline: Coverage | None,
    baseline_ref: str,
    run_url: str,
    commit: str,
) -> str:
    short_commit = commit[:7]
    summary = " · ".join(
        [
            summary_metric("Backend", backend, backend_baseline),
            summary_metric("Frontend", frontend, frontend_baseline),
        ]
    )
    return (
        "\n".join(
            [
                "<details>",
                f"<summary><strong>Test coverage</strong>: {summary}</summary>",
                "",
                "| Suite | Lines | Branches |",
                "| --- | ---: | ---: |",
                row("Backend", backend, backend_baseline),
                row("Frontend", frontend, frontend_baseline),
                "",
                f"<sub>Delta is against the latest available `{baseline_ref}` coverage. Coverage is informational. "
                f"[Workflow run]({run_url}) for commit `{short_commit}`.</sub>",
                "",
                "</details>",
            ]
        )
        + "\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", required=True)
    parser.add_argument("--frontend", required=True)
    parser.add_argument("--backend-baseline", required=True)
    parser.add_argument("--frontend-baseline", required=True)
    parser.add_argument("--baseline-ref", required=True)
    parser.add_argument("--run-url", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    report = render(
        parse_coverage(args.backend),
        parse_coverage(args.frontend),
        parse_coverage(args.backend_baseline),
        parse_coverage(args.frontend_baseline),
        args.baseline_ref,
        args.run_url,
        args.commit,
    )
    with open(args.output, "w", encoding="utf-8") as handle:
        handle.write(report)


if __name__ == "__main__":
    main()
