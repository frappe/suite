"""Durable preimages for destructive legacy Slide body rewrites.

The journal is a write-ahead log. A caller appends one transition, commits
the matching database update, and then saves Build state. The files remain
useful when either later step stops halfway.

This module has no Frappe or product imports. The caller supplies the exact
journal root, body values, and diagnostic creation stamp.
"""

import hashlib
import json
import os
import time
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from tempfile import mkstemp

JOURNAL_VERSION = 1

_BODY_DOMAIN = b"suite.drive.build.slide-body\x00"
_TRANSITION_DOMAIN = b"suite.drive.build.slide-transition\x00"


class SlideJournalError(RuntimeError):
    """Base error for an unsafe or unreadable Slide journal."""


class JournalConflictError(SlideJournalError):
    """A transition path or chain already describes different data."""


class CorruptJournalError(SlideJournalError):
    """A record failed validation and was moved out of the active journal."""

    def __init__(self, path: Path, quarantined: Path | None, reason: str):
        self.path = path
        self.quarantined = quarantined
        self.reason = reason
        destination = f"; quarantined as {quarantined}" if quarantined else ""
        super().__init__(f"corrupt Slide journal record {path}: {reason}{destination}")


class JournalChainError(SlideJournalError):
    """Validated records do not form one exact transition chain."""


class UnknownBodyState(SlideJournalError):
    """The current body is not a boundary in its validated journal chain."""


@dataclass(frozen=True)
class SlideBody:
    """The two destructive Slide fields, without normalization."""

    elements: str | None
    background: str | None

    def __post_init__(self) -> None:
        for name in ("elements", "background"):
            value = getattr(self, name)
            if value is not None and not isinstance(value, str):
                raise TypeError(f"Slide {name} must be a string or None")


@dataclass(frozen=True)
class SlideTransition:
    """One durable before-to-after body transition."""

    presentation: str
    slide: str
    before: SlideBody
    after: SlideBody
    before_hash: str
    after_hash: str
    transition_hash: str
    changed_elements: int
    created_at: str

    def payload(self) -> dict:
        return {
            "schema_version": JOURNAL_VERSION,
            "presentation": self.presentation,
            "slide": self.slide,
            "before": {
                "elements": self.before.elements,
                "background": self.before.background,
            },
            "after": {
                "elements": self.after.elements,
                "background": self.after.background,
            },
            "before_hash": self.before_hash,
            "after_hash": self.after_hash,
            "transition_hash": self.transition_hash,
            "changed_elements": self.changed_elements,
            "created_at": self.created_at,
        }


@dataclass(frozen=True)
class JournalStatus:
    """The transitions on each side of the current database body."""

    current: SlideBody
    initial: SlideBody
    terminal: SlideBody
    applied: tuple[SlideTransition, ...]
    pending: tuple[SlideTransition, ...]

    @property
    def changed_elements(self) -> int:
        """Recover the report count from transitions SQL has applied."""
        return sum(transition.changed_elements for transition in self.applied)


@dataclass(frozen=True)
class RollbackStep:
    """One compare-before-write operation for a rollback runner."""

    presentation: str
    slide: str
    transition_hash: str
    expected: SlideBody
    restore: SlideBody


def _field_bytes(value: str | None) -> bytes:
    """Frame exact UTF-8 values, including the difference between null and empty."""
    if value is None:
        return b"N"
    encoded = value.encode("utf-8")
    return b"S" + len(encoded).to_bytes(8, "big") + encoded


def body_bytes(body: SlideBody) -> bytes:
    """Return the unambiguous bytes used for body identity."""
    return _BODY_DOMAIN + _field_bytes(body.elements) + _field_bytes(body.background)


def body_hash(body: SlideBody) -> str:
    """Hash both exact database fields without parsing their content."""
    return hashlib.sha256(body_bytes(body)).hexdigest()


def deck_hash(presentation: str) -> str:
    """Name a deck directory from its exact legacy id."""
    _require_id("Presentation", presentation)
    return hashlib.sha256(presentation.encode("utf-8")).hexdigest()


def transition_hash(presentation: str, slide: str, before: SlideBody) -> str:
    """Name a transition from both source ids and its exact preimage."""
    _require_id("Presentation", presentation)
    _require_id("Slide", slide)
    digest = hashlib.sha256()
    digest.update(_TRANSITION_DOMAIN)
    digest.update(_field_bytes(presentation))
    digest.update(_field_bytes(slide))
    digest.update(body_bytes(before))
    return digest.hexdigest()


class SlidePreimageJournal:
    """Append, inspect, and reverse Slide body transition records."""

    def __init__(self, root: Path):
        self.root = Path(root)

    @classmethod
    def for_site(cls):
        """Place rollback evidence outside the database under site private."""
        import frappe

        return cls(Path(frappe.get_site_path("private", "drive-build-slide-preimages")))

    def append(
        self,
        *,
        presentation: str,
        slide: str,
        before: SlideBody,
        after: SlideBody,
        changed_elements: int,
        created_at: str,
    ) -> SlideTransition:
        """Durably publish a transition before its matching SQL update."""
        transition = _make_transition(
            presentation=presentation,
            slide=slide,
            before=before,
            after=after,
            changed_elements=changed_elements,
            created_at=created_at,
        )
        directory = self._deck_directory(presentation)
        path = directory / f"{transition.transition_hash}.json"

        if path.exists():
            return self._reuse_existing(path, transition)

        existing = self.transitions(presentation, slide)
        if existing:
            chain = _ordered_chain(existing)
            if chain[-1].after != before:
                raise JournalConflictError(f"Slide {slide} can append only from its terminal journal state")

        self._ensure_directory(directory)
        raw = _json_bytes(transition.payload())
        descriptor, temp_name = mkstemp(
            prefix=f".{transition.transition_hash}.",
            suffix=".tmp",
            dir=directory,
        )
        temp = Path(temp_name)
        try:
            with os.fdopen(descriptor, "wb") as file:
                file.write(raw)
                file.flush()
                os.fsync(file.fileno())
            try:
                # A hard link publishes the complete file atomically. Unlike
                # os.replace, it cannot overwrite a concurrent transition.
                os.link(temp, path)
            except FileExistsError:
                return self._reuse_existing(path, transition)
            finally:
                temp.unlink(missing_ok=True)
            _sync_directory(directory)
        except BaseException:
            temp.unlink(missing_ok=True)
            raise
        return transition

    def transitions(self, presentation: str, slide: str | None = None) -> tuple[SlideTransition, ...]:
        """Read and validate records, with stable ordering for diagnostics."""
        _require_id("Presentation", presentation)
        if slide is not None:
            _require_id("Slide", slide)
        directory = self._deck_directory(presentation)
        if not directory.exists():
            return ()

        records = []
        for path in sorted(directory.glob("*.json")):
            record = self._read_record(path, presentation)
            if slide is None or record.slide == slide:
                records.append(record)
        return tuple(records)

    def status(self, presentation: str, slide: str, current: SlideBody) -> JournalStatus:
        """Classify the exact applied prefix and pending suffix."""
        chain = _ordered_chain(self.transitions(presentation, slide))
        if not chain:
            return JournalStatus(current, current, current, (), ())

        boundaries = [chain[0].before, *(transition.after for transition in chain)]
        matches = [index for index, body in enumerate(boundaries) if body == current]
        if len(matches) != 1:
            raise UnknownBodyState(f"Slide {slide} body matches no unique state in its journal chain")
        applied_count = matches[0]
        return JournalStatus(
            current=current,
            initial=boundaries[0],
            terminal=boundaries[-1],
            applied=chain[:applied_count],
            pending=chain[applied_count:],
        )

    def recover_changed_elements(self, presentation: str, current_bodies: Mapping[str, SlideBody]) -> int:
        """Recover one deck's applied element count after a state-save crash."""
        by_slide = self._by_slide(presentation)
        total = 0
        for slide in sorted(by_slide):
            if slide not in current_bodies:
                raise UnknownBodyState(f"Slide {slide} has a journal but no current body")
            status = _status_from_chain(slide, by_slide[slide], current_bodies[slide])
            total += status.changed_elements
        return total

    def plan_slide_rollback(
        self, presentation: str, slide: str, current: SlideBody
    ) -> tuple[RollbackStep, ...]:
        """Plan exact reverse writes back to one Slide's earliest preimage."""
        status = self.status(presentation, slide, current)
        return tuple(
            RollbackStep(
                presentation=presentation,
                slide=slide,
                transition_hash=transition.transition_hash,
                expected=transition.after,
                restore=transition.before,
            )
            for transition in reversed(status.applied)
        )

    def plan_rollback(
        self, presentation: str, current_bodies: Mapping[str, SlideBody]
    ) -> tuple[RollbackStep, ...]:
        """Plan stable per-Slide rollback steps for a complete deck."""
        by_slide = self._by_slide(presentation)
        plan = []
        for slide in sorted(by_slide):
            if slide not in current_bodies:
                raise UnknownBodyState(f"Slide {slide} has a journal but no current body")
            status = _status_from_chain(slide, by_slide[slide], current_bodies[slide])
            plan.extend(
                RollbackStep(
                    presentation=presentation,
                    slide=slide,
                    transition_hash=transition.transition_hash,
                    expected=transition.after,
                    restore=transition.before,
                )
                for transition in reversed(status.applied)
            )
        return tuple(plan)

    def _by_slide(self, presentation: str) -> dict[str, tuple[SlideTransition, ...]]:
        grouped = defaultdict(list)
        for transition in self.transitions(presentation):
            grouped[transition.slide].append(transition)
        return {slide: _ordered_chain(rows) for slide, rows in grouped.items()}

    def _deck_directory(self, presentation: str) -> Path:
        return self.root / deck_hash(presentation)

    def _ensure_directory(self, directory: Path) -> None:
        root_existed = self.root.exists()
        self.root.mkdir(parents=True, exist_ok=True)
        if not root_existed:
            _sync_directory(self.root.parent)
        deck_existed = directory.exists()
        directory.mkdir(exist_ok=True)
        if not deck_existed:
            _sync_directory(self.root)

    def _reuse_existing(self, path: Path, expected: SlideTransition) -> SlideTransition:
        actual = self._read_record(path, expected.presentation)
        if not _same_transition(actual, expected):
            raise JournalConflictError(
                f"transition {expected.transition_hash} already contains different data"
            )
        # A prior run can stop after publication but before the directory
        # fsync. Repeat both barriers before the caller updates SQL.
        _sync_file(path)
        _sync_directory(path.parent)
        return actual

    def _read_record(self, path: Path, presentation: str) -> SlideTransition:
        try:
            payload = json.loads(path.read_bytes())
            transition = _transition_from_payload(payload)
            if transition.presentation != presentation:
                raise ValueError("Presentation id does not match its deck directory")
            if deck_hash(transition.presentation) != path.parent.name:
                raise ValueError("deck directory hash does not match the Presentation id")
            if transition.transition_hash != path.stem:
                raise ValueError("transition hash does not match the record name")
            return transition
        except OSError:
            raise
        except Exception as error:
            quarantined = self._quarantine(path)
            raise CorruptJournalError(path, quarantined, str(error)) from error

    def _quarantine(self, path: Path) -> Path | None:
        if not path.exists():
            return None
        for attempt in range(100):
            stamp = time.time_ns()
            suffix = f".corrupt-{stamp}-{os.getpid()}-{attempt}"
            destination = path.with_name(f"{path.name}{suffix}")
            try:
                os.rename(path, destination)
                _sync_directory(path.parent)
                return destination
            except FileExistsError:
                continue
            except OSError:
                return None
        return None


def _make_transition(
    *,
    presentation: str,
    slide: str,
    before: SlideBody,
    after: SlideBody,
    changed_elements: int,
    created_at: str,
) -> SlideTransition:
    _require_id("Presentation", presentation)
    _require_id("Slide", slide)
    if not isinstance(before, SlideBody) or not isinstance(after, SlideBody):
        raise TypeError("before and after must be SlideBody values")
    if before == after:
        raise ValueError("a Slide journal transition must change the body")
    if isinstance(changed_elements, bool) or not isinstance(changed_elements, int):
        raise TypeError("changed_elements must be an integer")
    if changed_elements < 0:
        raise ValueError("changed_elements cannot be negative")
    if not isinstance(created_at, str) or not created_at:
        raise ValueError("created_at must be a non-empty string")
    return SlideTransition(
        presentation=presentation,
        slide=slide,
        before=before,
        after=after,
        before_hash=body_hash(before),
        after_hash=body_hash(after),
        transition_hash=transition_hash(presentation, slide, before),
        changed_elements=changed_elements,
        created_at=created_at,
    )


def _transition_from_payload(payload: object) -> SlideTransition:
    if not isinstance(payload, dict):
        raise ValueError("record must be a JSON object")
    if payload.get("schema_version") != JOURNAL_VERSION:
        raise ValueError("unsupported journal schema version")

    before = _body_from_payload(payload.get("before"), "before")
    after = _body_from_payload(payload.get("after"), "after")
    transition = _make_transition(
        presentation=payload.get("presentation"),
        slide=payload.get("slide"),
        before=before,
        after=after,
        changed_elements=payload.get("changed_elements"),
        created_at=payload.get("created_at"),
    )
    for name in ("before_hash", "after_hash", "transition_hash"):
        if payload.get(name) != getattr(transition, name):
            raise ValueError(f"{name} does not match the record body")
    return transition


def _body_from_payload(payload: object, name: str) -> SlideBody:
    if not isinstance(payload, dict):
        raise ValueError(f"{name} must be a JSON object")
    if "elements" not in payload or "background" not in payload:
        raise ValueError(f"{name} must contain elements and background")
    return SlideBody(elements=payload["elements"], background=payload["background"])


def _ordered_chain(
    transitions: tuple[SlideTransition, ...] | list[SlideTransition],
) -> tuple[SlideTransition, ...]:
    if not transitions:
        return ()
    slide = transitions[0].slide
    if any(transition.slide != slide for transition in transitions):
        raise JournalChainError("one chain cannot contain records from different Slides")

    by_before = {}
    incoming = defaultdict(list)
    for transition in transitions:
        if transition.before_hash in by_before:
            raise JournalChainError(f"Slide {slide} has two transitions from one body")
        by_before[transition.before_hash] = transition
        incoming[transition.after_hash].append(transition)
    if any(len(rows) > 1 for rows in incoming.values()):
        raise JournalChainError(f"Slide {slide} has transitions that converge")

    roots = [transition for transition in transitions if transition.before_hash not in incoming]
    if len(roots) != 1:
        raise JournalChainError(f"Slide {slide} does not have one journal root")

    ordered = []
    seen_states = set()
    current = roots[0]
    while current is not None:
        if current.before_hash in seen_states or current.after_hash in seen_states:
            raise JournalChainError(f"Slide {slide} journal contains a cycle")
        seen_states.add(current.before_hash)
        ordered.append(current)
        following = by_before.get(current.after_hash)
        if following is not None and following.before != current.after:
            raise JournalChainError(f"Slide {slide} has a body-hash collision")
        current = following
    if len(ordered) != len(transitions):
        raise JournalChainError(f"Slide {slide} journal contains disconnected records")
    return tuple(ordered)


def _status_from_chain(slide: str, chain: tuple[SlideTransition, ...], current: SlideBody) -> JournalStatus:
    boundaries = [chain[0].before, *(transition.after for transition in chain)]
    matches = [index for index, body in enumerate(boundaries) if body == current]
    if len(matches) != 1:
        raise UnknownBodyState(f"Slide {slide} body matches no unique journal state")
    applied_count = matches[0]
    return JournalStatus(
        current=current,
        initial=boundaries[0],
        terminal=boundaries[-1],
        applied=chain[:applied_count],
        pending=chain[applied_count:],
    )


def _same_transition(actual: SlideTransition, expected: SlideTransition) -> bool:
    """Ignore only the diagnostic stamp when an interrupted run resumes."""
    return (
        actual.presentation == expected.presentation
        and actual.slide == expected.slide
        and actual.before == expected.before
        and actual.after == expected.after
        and actual.before_hash == expected.before_hash
        and actual.after_hash == expected.after_hash
        and actual.transition_hash == expected.transition_hash
        and actual.changed_elements == expected.changed_elements
    )


def _require_id(label: str, value: object) -> None:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} id must be a non-empty string")


def _json_bytes(payload: dict) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _sync_directory(directory: Path) -> None:
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _sync_file(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
