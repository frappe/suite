# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Acting on a whole thread the client holds only part of.

A long thread reaches the client in part (see `thread_window`), so the client can name only the
messages it was given. Filing or reading such a thread, it names the thread as well, and the rest of
its messages are dealt with here, by the same rules as the ones named: the request files or marks
what the client named, as it does for any thread, and hands over the thread ids.

A rest of up to INLINE_MAX messages is done in the request. A longer one goes to a background job,
which a request would not outlast.

Undo puts each message back exactly where it was, and the client can say that only for the messages
it holds. So what the rest looked like before a filing is kept here for a while, with the messages
the client named and where they were: when the client puts those back there, the rest goes back
with them (see `restore_rest`).

Other actions on a whole thread (a pin, a star taken off, a delete for good) keep nothing for an
Undo and are no slower for being long: their rest is only added to what the request does (see
`rest_of`).

A thread is worked on a slice at a time, and only by the latest work asked of it: an Undo that comes
while a filing is still running stops it at its next slice and puts back what it had done.

A filing that fails part-way would leave the thread in two places, and the client, which took it off
its list on the click, none the wiser. So it is undone here, the messages the client named with the
rest, and a filing that failed in a job tells the reader's open tabs (see `work`).

The rest is filed as the messages the client named were: of those the list it acted from shows. A
list leaves out mail thrown away, and Trash and Junk show nothing else (see `visible_in_mailbox`),
so archiving a thread from the Inbox must not bring back the message of it that was trashed last
year (see `_view`).

A job takes its time, a few seconds a slice, and until it is done the thread is in the folder it is
leaving as well as the one it is going to. A list leaves out a thread on its way out of its folder
(see `leaving`), so the thread is gone on the click and stays gone, as a short one is.
"""

import time
from collections.abc import Generator
from contextlib import contextmanager
from typing import Literal
from uuid import uuid7

import frappe
from frappe import _

from suite.mail import filing
from suite.mail.doctype.mail_message.mail_message import (
    get_messages_mailboxes,
    get_thread_email_ids,
    set_messages_mailboxes,
    set_seen_status,
)
from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import chunked_get, get_account_client, get_mailbox_id_by_role
from suite.utils import enqueue_job
from suite.utils.lock import acquire_lock, release_lock

# The most messages a request deals with itself, and the most a job takes at a time: one write to
# the mail server.
INLINE_MAX = 500
SLICE = 500
JOB_TIMEOUT = 30 * 60
# How long a filing can be undone: well past the toast that offers it.
UNDO_KEPT = 15 * 60
# A slice waits this long for the one before it, and holds the thread no longer than that.
TURN_WAIT = 120
TURN_HELD = 300
# How long a list goes on leaving a thread out with no word from its job: until the job starts, and
# then from one slice to the next. Past that the job is taken for dead, and the thread is shown
# wherever it still is.
STARTS_WITHIN = 120
SLICE_WITHIN = 90

Kind = Literal["file", "restore", "seen"]
# Which of a thread's messages the list an action came from shows: the trashed, the junked, the
# ones that are neither, or all of them (a search).
View = Literal["trash", "junk", "kept", "all"]


def file_rest(
    account: str,
    threads: list[str],
    named: list[str],
    action: str,
    target: str | None = None,
    before: list[dict] | None = None,
) -> None:
    """Files the messages of `threads` the client did not name, as `named` were filed.

    `before` is where the named messages were until the request filed them. It is kept with each
    thread, for a filing that fails: the whole thread goes back then, not only the rest of it."""

    thrown = _thrown(account)
    _filed(account)  # Lets go of filings past their Undo.
    for thread_id, rest, held, queued in _rests(account, threads, named):
        was = [mail for mail in before or [] if mail["id"] in held]
        # The folders the thread leaves and the ones it enters, read off the messages named, which
        # the request has filed already. Only a job needs them: it is the one that takes time.
        left, entered = _crossed(was, get_messages_mailboxes(account, held)) if queued and was else ([], [])
        op = str(uuid7())
        frappe.cache.hset(
            _filed_key(account),
            thread_id,
            {
                "op": op,
                "named": held,
                "before": was,
                "left": left,
                "entered": entered,
                "queued": queued,
                "at": time.time(),
            },
        )
        _start(
            account,
            thread_id,
            "file",
            queued,
            op=op,
            out_of=left,
            ids=rest,
            action=action,
            target=target,
            view=_view(was, *thrown),
        )


def set_rest_seen(account: str, threads: list[str], named: list[str], seen: bool) -> None:
    """Marks the messages of `threads` the client did not name read or unread, as `named` were."""

    thrown = _thrown(account)
    for thread_id, rest, held, queued in _rests(account, threads, named):
        view = _view(get_messages_mailboxes(account, held), *thrown)
        _start(account, thread_id, "seen", queued, ids=rest, seen=seen, view=view)


def restore_rest(account: str, mails: list[dict]) -> None:
    """Puts back the rest of each thread filed whole whose named messages `mails` puts back where
    they were before the filing: its Undo. Mail put somewhere else, by the Undo of a later action or
    a move of some other kind, is no Undo of the filing, and leaves the rest where it is."""

    restored = {mail["id"]: set(mail.get("mailbox_ids") or []) for mail in mails}
    for thread_id, filed in _filed(account).items():
        was = filed.get("before") or []
        if was and all(restored.get(mail["id"]) == set(mail["mailbox_ids"]) for mail in was):
            # On its way back, the thread is leaving the folders the filing took it into.
            _start(
                account,
                thread_id,
                "restore",
                filed["queued"],
                out_of=filed.get("entered"),
                filing_op=filed["op"],
            )


def rest_of(account: str, threads: list[str], named: list[str], keyword: str | None = None) -> list[str]:
    """The messages of `threads` the client did not name, of those the list it acted from shows; with
    `keyword`, only those marked with it."""

    rests = list(_rests(account, threads, named))
    if not rests:
        return []
    thrown = _thrown(account)
    view = _view(get_messages_mailboxes(account, [id for _, _, held, _ in rests for id in held]), *thrown)
    states = _states(account, [id for _, rest, _, _ in rests for id in rest])
    return [
        mail["id"]
        for mail in states
        if _shown(view, mail, *thrown) and (not keyword or mail["keywords"].get(keyword))
    ]


def leaving(account: str, mailbox: str) -> set[str]:
    """The threads a job is taking out of `mailbox`, for its list to leave out until the job is done."""

    now = time.time()
    moving = _entries(_moving_key(account))
    # A job that died says nothing more: its thread is shown again, and its entry is done with.
    if dead := [thread_id for thread_id, entry in moving.items() if entry["until"] <= now]:
        frappe.cache.hdel(_moving_key(account), dead)
    return {
        thread_id
        for thread_id, entry in moving.items()
        if mailbox in entry["out_of"] and entry["until"] > now
    }


def _thrown(account: str) -> tuple[str | None, str | None]:
    """The account's Trash and Junk: the folders whose mail other lists leave out."""

    return get_mailbox_id_by_role(account, "trash"), get_mailbox_id_by_role(account, "junk")


def _view(named: list[dict], trash: str | None, junk: str | None) -> View:
    """The list an action came from, told by the messages it named, as they were before it: every
    one of them trashed, every one junked, or none of them either. A mix is a search, which shows
    them all. With nothing to go by, the list is taken for an ordinary one, which leaves mail
    thrown away where it is."""

    if named and all(_shown("trash", mail, trash, junk) for mail in named):
        return "trash"
    if named and all(_shown("junk", mail, trash, junk) for mail in named):
        return "junk"
    if all(_shown("kept", mail, trash, junk) for mail in named):
        return "kept"
    return "all"


def _shown(view: View, mail: dict, trash: str | None, junk: str | None) -> bool:
    """Whether a list of that kind shows the message (`id`, `mailbox_ids`, `junk`), by the rules of
    `visible_in_mailbox`."""

    trashed = trash in mail["mailbox_ids"]
    if view == "trash":
        return trashed
    if view == "junk":
        return bool(mail["junk"]) or junk in mail["mailbox_ids"]
    return view == "all" or not (trashed or mail["junk"])


def _crossed(was: list[dict], now: list[dict]) -> tuple[list[str], list[str]]:
    """The folders a filing took its messages out of altogether, and the ones it took them into."""

    before = {mailbox for mail in was for mailbox in mail["mailbox_ids"]}
    after = {mailbox for mail in now for mailbox in mail["mailbox_ids"]}
    return sorted(before - after), sorted(after - before)


def _rests(
    account: str, threads: list[str], named: list[str]
) -> Generator[tuple[str, list[str], list[str], bool]]:
    """Each thread with messages the client did not name: those, the ones it did, and whether they
    are too many for the request."""

    get_user_for_jmap_account(account, allow_system_manager=False, raise_exception=True)
    given = set(named)
    emails = get_thread_email_ids(account, list(dict.fromkeys(threads)))
    rests = {thread_id: [id for id in ids if id not in given] for thread_id, ids in emails.items()}
    queued = sum(len(rest) for rest in rests.values()) > INLINE_MAX
    for thread_id, rest in rests.items():
        if rest:
            yield thread_id, rest, [id for id in emails[thread_id] if id in given], queued


def _start(
    account: str,
    thread_id: str,
    kind: Kind,
    queued: bool,
    op: str | None = None,
    out_of: list[str] | None = None,
    **what,
) -> None:
    """Makes this the latest work asked of the thread, and does it: now, or in a job. `out_of` are
    the folders a job takes the thread out of, whose lists leave it out meanwhile (see `leaving`)."""

    op = op or str(uuid7())
    frappe.cache.set_value(_op_key(account, thread_id, kind), op, expires_in_sec=JOB_TIMEOUT + UNDO_KEPT)
    if not queued:
        return work(account, thread_id, op, kind, **what)
    if kind != "seen":
        # The latest filing's word on where the thread is going, whatever an earlier one said.
        frappe.cache.hset(
            _moving_key(account), thread_id, {"out_of": out_of or [], "until": time.time() + STARTS_WITHIN}
        )
    enqueue_job(
        "suite.mail.long_threads.work",
        queue="long",
        timeout=JOB_TIMEOUT,
        account=account,
        thread_id=thread_id,
        op=op,
        kind=kind,
        announce=True,
        **what,
    )


def work(
    account: str,
    thread_id: str,
    op: str,
    kind: Kind,
    ids: list[str] | None = None,
    action: filing.Action | None = None,
    target: str | None = None,
    seen: bool = True,
    view: View = "all",
    filing_op: str | None = None,
    announce: bool = False,
) -> None:
    """Does one piece of work on a thread's rest, a slice at a time, for as long as it is the latest
    asked of the thread. Of the rest, only the messages the list the action came from shows are
    touched (see `_view`).

    A restore undoes the filing `filing_op`. A filing that fails is undone. In a request the failure is the request's answer; a job has no
    one waiting on it, so with `announce` it tells the reader's open tabs what became of the thread:
    that it is where it was going, for their lists to read again, or that it could not be moved."""

    moves = announce and kind != "seen"
    try:
        done = _work(account, thread_id, op, kind, ids, action, target, seen, view, filing_op, moves)
    except Exception:
        put_back = kind == "file" and _put_back(account, thread_id, op)
        if moves:
            frappe.cache.hdel(_moving_key(account), thread_id)
            _announce_failure(account, thread_id, put_back)
        raise
    # Stopped for later work on the thread, it leaves the thread's lists to that work.
    if moves and done:
        frappe.cache.hdel(_moving_key(account), thread_id)
        frappe.publish_realtime("mail_changed", user=frappe.session.user)


def _put_back(account: str, thread_id: str, op: str) -> bool:
    """Undoes the filing `op`, stopped part-way, and says whether it could. The rest goes back as an
    Undo puts it back, and the messages the client named with it: no client is restoring those."""

    try:
        filed = _entries(_filed_key(account)).get(thread_id) or {}
        _start(account, thread_id, "restore", queued=False, filing_op=op)
        if filed.get("op") == op and filed.get("before"):
            set_messages_mailboxes(account, filed["before"])
    except Exception:
        frappe.log_error(title="A long thread's filing failed and could not be undone")
        return False
    return True


def _announce_failure(account: str, thread_id: str, put_back: bool) -> None:
    """Tells the open tabs of the reader whose filing failed, and has their lists read again: the
    thread left them on the click."""

    user = frappe.session.user
    frappe.publish_realtime(
        "mail_thread_filing_failed",
        {"account": account, "thread_id": thread_id, "put_back": put_back},
        user=user,
    )
    frappe.publish_realtime("mail_changed", user=user)


def _work(
    account: str,
    thread_id: str,
    op: str,
    kind: Kind,
    ids: list[str] | None,
    action: filing.Action | None,
    target: str | None,
    seen: bool,
    view: View,
    filing_op: str | None,
    moves: bool,
) -> bool:
    """The work itself. Says whether it was seen through: false when later work on the thread
    stopped it. `moves` is a job that files or restores, which keeps the thread's lists waiting
    for it a slice at a time (see `leaving`)."""

    def waited_for() -> None:
        moving = _entries(_moving_key(account)).get(thread_id)
        if moves and moving:
            frappe.cache.hset(
                _moving_key(account), thread_id, {**moving, "until": time.time() + SLICE_WITHIN}
            )

    if kind == "restore":
        before_key = _before_key(account, thread_id, filing_op or "")
        # Read once the filing it undoes has stopped: that is what says how far the filing got.
        with _turn(account, thread_id, kind, op) as latest:
            if not latest:
                return False
            before = frappe.cache.get_value(before_key, expires=True) or []
        for at in range(0, len(before), SLICE):
            with _turn(account, thread_id, kind, op) as latest:
                if not latest:
                    return False
                waited_for()
                set_messages_mailboxes(account, before[at : at + SLICE])
        frappe.cache.delete_value(before_key)
        # A later filing of the thread has an Undo of its own still to come.
        if (_entries(_filed_key(account)).get(thread_id) or {}).get("op") == filing_op:
            frappe.cache.hdel(_filed_key(account), thread_id)
        return True

    # Each filing keeps its own: an Undo of one never puts back what an earlier one moved.
    before_key = _before_key(account, thread_id, op)
    ids = ids or []
    thrown = _thrown(account)
    before = []
    for at in range(0, len(ids), SLICE):
        with _turn(account, thread_id, kind, op) as latest:
            if not latest:
                return False
            waited_for()
            # Where each message is now says whether the list shows it, and is what Undo restores.
            held = [mail for mail in _states(account, ids[at : at + SLICE]) if _shown(view, mail, *thrown)]
            chunk = [mail["id"] for mail in held]
            if kind == "seen":
                if differing := [mail["id"] for mail in held if mail["seen"] != seen]:
                    set_seen_status(account, differing, seen)
                continue
            if not action:
                raise ValueError("A filing needs an action.")
            if not chunk:
                continue
            # Kept before the write, so a filing cut short can still be put back.
            was = [{key: mail[key] for key in ("id", "mailbox_ids", "junk")} for mail in held]
            frappe.cache.set_value(before_key, before + was, expires_in_sec=UNDO_KEPT)
            updated = set(filing.file_messages(account, chunk, action, target)["updated"])
            before += [mail for mail in was if mail["id"] in updated]
            frappe.cache.set_value(before_key, before, expires_in_sec=UNDO_KEPT)
    return True


def _states(account: str, ids: list[str]) -> list[dict]:
    """Where each message is and how it is marked: `mailbox_ids` and `junk`, as
    `set_messages_mailboxes` restores them, `seen`, and its `keywords`."""

    emails = chunked_get(
        get_account_client(account),
        lambda b, chunk: b.mail.email.get(ids=chunk, properties=["id", "mailboxIds", "keywords"]),
        ids,
    )
    return [
        {
            "id": email["id"],
            "mailbox_ids": [mailbox for mailbox, held in (email.get("mailboxIds") or {}).items() if held],
            "junk": int(bool((email.get("keywords") or {}).get("$junk"))),
            "seen": bool((email.get("keywords") or {}).get("$seen")),
            "keywords": email.get("keywords") or {},
        }
        for email in (e.to_wire() for e in emails)
    ]


@contextmanager
def _turn(account: str, thread_id: str, kind: Kind, op: str) -> Generator[bool]:
    """Holds the thread for one slice, and says whether this work is still the latest asked of it."""

    name = f"mail:long-thread:{account}:{thread_id}"
    lock = acquire_lock(name, acquire_timeout=TURN_WAIT, lock_timeout=TURN_HELD)
    if not lock:
        raise frappe.ValidationError(_("This conversation is still being changed. Please try again."))
    try:
        # Later work sets its own op. With none left at all, the cache let it go: no later work
        # asked for the thread, so this is still the latest.
        yield frappe.cache.get_value(_op_key(account, thread_id, kind), expires=True) in (op, None)
    finally:
        release_lock(name, lock)


def _op_key(account: str, thread_id: str, kind: Kind) -> str:
    # Reading a thread and filing it are separate work: one does not stop the other.
    group = "seen" if kind == "seen" else "filing"
    return f"mail:long-thread:op:{group}:{account}:{thread_id}"


def _before_key(account: str, thread_id: str, op: str) -> str:
    return f"mail:long-thread:before:{account}:{thread_id}:{op}"


def _filed_key(account: str) -> str:
    return f"mail:long-thread:filed:{account}"


def _moving_key(account: str) -> str:
    return f"mail:long-thread:moving:{account}"


def _filed(account: str) -> dict[str, dict]:
    """The filings that can still be undone, by thread; the older ones are let go of."""

    filed = _entries(_filed_key(account))
    if past := [thread_id for thread_id, entry in filed.items() if time.time() - entry["at"] > UNDO_KEPT]:
        frappe.cache.hdel(_filed_key(account), past)
    return {thread_id: entry for thread_id, entry in filed.items() if thread_id not in past}


def _entries(name: str) -> dict[str, dict]:
    """A hash of the cache by thread id, read from the cache itself: a job outlives what `hget`
    remembers of it."""

    return {
        (thread_id.decode() if isinstance(thread_id, bytes) else thread_id): entry
        for thread_id, entry in (frappe.cache.hgetall(name) or {}).items()
    }
