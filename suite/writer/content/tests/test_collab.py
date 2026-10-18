import json
import threading
import time
import uuid
from dataclasses import replace
from unittest.mock import patch

import frappe
import pycrdt

from suite import drive
from suite.composition import content as routes
from suite.drive._core.access import grant
from suite.drive._core.principals import Principals
from suite.suite_core.content.stage import PIECE_MAX
from suite.suite_core.content.updates import encoded_string, encoded_uint, parse
from suite.writer import content as writer_content
from suite.writer.content.tests.support import (
    OUTSIDER,
    READER,
    WRITER,
    CollabCase,
    answer,
    body_item_update,
    call_route,
    element_update,
    embed_update,
    formatted_update,
    piece_body,
    push_body,
    read_frame,
    typed_updates,
)


class TestWriterCollab(CollabCase):
    def test_mode_off_answers_disabled_and_writes_nothing(self):
        self.set_mode("off")
        before = {kind: self.table_count(kind) for kind in ("doc", "update", "session")}
        node = self.new_document()

        header, rows = self.open_document(node)
        self.assertEqual((header["state"], rows), ("disabled", []))
        sid = uuid.uuid4().hex
        session = json.dumps({"sid": sid}).encode()
        push = push_body(uuid.uuid4().hex, sid, 1, 1, 0, self.typed_update(1, 1, "x"))
        for handler, body in (
            (routes.sessions_post, session),
            (routes.updates_post, push),
            (routes.updates_get, session),
            (routes.suspect_post, session),
            (lambda node: routes.stage_put(node, uuid.uuid4().hex, "0"), b"x"),
        ):
            response = call_route(handler, node, body=body)
            self.assertEqual((response.status_code, answer(response)), (409, {"collab": "disabled"}))
        self.assertEqual({kind: self.table_count(kind) for kind in before}, before)

    def test_two_writers_converge_on_one_order(self):
        self.set_mode("on")
        node = self.new_document()
        self.assertEqual(self.open_document(node)[0]["state"], "live")
        first, second = self.start_session(node), self.start_session(node)

        sent = []
        for seq in (1, 2):
            for sid, client_id in (first, second):
                sent.append(self.typed_update(client_id, seq, f"{client_id}:{seq}"))
                self.assertEqual(self.push(node, sid, client_id, seq, sent[-1])[0], 200)

        _header, rows = self.open_document(node)
        self.assertEqual([payload for _, payload in rows], sent)
        self.assert_one_order(node, 4)

    def test_a_push_at_the_size_cap_keeps_every_byte_value(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        doc = pycrdt.Doc(client_id=client_id)
        doc.get("meta", type=pycrdt.Map)["firstTabLabel"] = bytes(range(256)) * (16 * 2**10 - 1)
        payload = doc.get_update()
        self.assertLessEqual(len(payload), 4 * 2**20)

        stage_id = self.stage(node, sid, payload)
        self.assertEqual(self.push_staged(node, sid, client_id, payload, stage_id)[0], 200)

        self.assertEqual(self.open_document(node)[1], [(1, payload)])
        self.assert_one_order(node, 1)

    def test_a_resent_push_commits_once(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        first = self.push(node, sid, client_id, 1)
        status, body = self.push(node, sid, client_id, 1)

        self.assertEqual(first[0], 200)
        self.assertEqual((status, body["dup"], body["acked"]), (200, True, 1))
        self.assertEqual((body["rev"], body["chain"]), (first[1]["rev"], first[1]["chain"]))
        self.assert_one_order(node, 1)

    def test_a_resend_grown_by_more_typing_stores_only_the_new_typing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        a, b = typed_updates(client_id, ["first", " second"])
        both = pycrdt.merge_updates(a, b)

        self.push(node, sid, client_id, 1, a)
        status, body = self.push(node, sid, client_id, 1, both, entries=[a, b])
        again = self.push(node, sid, client_id, 1, both, entries=[a, b])

        self.assertEqual((status, "dup" in body, body["rev"], body["acked"]), (200, False, 2, 2))
        self.assertEqual((again[0], again[1]["dup"], again[1]["rev"], again[1]["acked"]), (200, True, 2, 2))
        self.assert_one_order(node, 2)
        self.assertEqual(self.stored_text(node), "first second")

    def test_a_resend_grown_by_typing_that_continues_one_struct_stores_the_rest_once(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        tab = pycrdt.Doc(client_id=client_id)
        text = tab.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText())
        text.insert(0, "first")
        a = tab.get_update()
        committed = tab.get_state()
        text.insert(5, " second")
        b = tab.get_update(committed)
        both = tab.get_update()
        next_clock = max(struct.clock + struct.length for struct in parse(a).structs)
        self.assertTrue(
            any(struct.clock < next_clock < struct.clock + struct.length for struct in parse(both).structs)
        )

        self.push(node, sid, client_id, 1, a)
        status, body = self.push(node, sid, client_id, 1, both, entries=[a, b])

        self.assertEqual((status, body["rev"], body["acked"]), (200, 2, 2))
        self.assert_one_order(node, 2)
        self.assertEqual(self.stored_text(node), "first second")

    def test_a_resend_grown_by_a_deletion_only_stores_the_deletion(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        tab = pycrdt.Doc(client_id=client_id)
        text = tab.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText())
        text.insert(0, "first second")
        a = tab.get_update()
        committed = tab.get_state()
        del text[5:12]
        b = tab.get_update(committed)
        both = tab.get_update()

        self.push(node, sid, client_id, 1, a)
        status, body = self.push(node, sid, client_id, 1, both, entries=[a, b])

        self.assertEqual((status, body["rev"], body["acked"]), (200, 2, 2))
        self.assertEqual(parse(self.open_document(node)[1][1][1]).structs, [])
        self.assertEqual(self.stored_text(node), "first")

    def test_a_refused_grown_resend_stores_nothing_and_its_retry_stores_the_rest(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]

        a, b = typed_updates(client_id, ["first", " second"])
        both = pycrdt.merge_updates(a, b)
        self.push(node, sid, client_id, 1, a)
        ahead = push_body(lineage, sid, client_id, 1, 5, both, entries=[a, b])
        refused = call_route(routes.updates_post, node, body=ahead)

        self.assertEqual((refused.status_code, answer(refused)), (409, {"collab": "diverged"}))
        self.assertEqual([payload for _, payload in self.open_document(node)[1]], [a])

        status, body = self.push(node, sid, client_id, 1, both, entries=[a, b])

        self.assertEqual((status, body["rev"], body["acked"]), (200, 2, 2))
        self.assertEqual(self.stored_text(node), "first second")

    def test_a_staged_resend_grown_by_a_big_paste_stores_the_paste_once(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        header = self.open_document(node)[0]

        paste = "p" * PIECE_MAX
        a, b = typed_updates(client_id, ["first ", paste])
        both = pycrdt.merge_updates(a, b)
        self.assertGreater(len(both), PIECE_MAX)
        self.push(node, sid, client_id, 1, a)
        stage_id = self.stage(node, sid, both, to=2)
        staged = push_body(header["lineage"], sid, client_id, 1, 1, b"", entries=[a, b], stage_id=stage_id)
        response = call_route(routes.updates_post, node, body=staged)

        self.assertEqual(
            (response.status_code, answer(response)["rev"], answer(response)["acked"]), (200, 2, 2)
        )
        self.assert_one_order(node, 2)
        self.assertEqual(self.stored_text(node), "first " + paste)
        self.assertEqual(self.staged(node), 0)

    def test_a_resend_grown_by_more_typing_with_different_committed_bytes_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        a = self.typed_update(client_id, 1, "a")
        self.push(node, sid, client_id, 1, a)
        c, d = typed_updates(client_id, ["c", "d"])
        status, body = self.push(node, sid, client_id, 1, pycrdt.merge_updates(c, d), entries=[c, d])

        self.assertEqual((status, body), (409, {"collab": "seq_conflict"}))
        self.assertEqual([payload for _, payload in self.open_document(node)[1]], [a])

    def test_a_resend_with_different_bytes_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        a = self.typed_update(client_id, 1, "a")
        self.push(node, sid, client_id, 1, a)
        c = self.typed_update(client_id, 1, "c")
        status, body = self.push(node, sid, client_id, 1, c)

        self.assertEqual((status, body), (409, {"collab": "seq_conflict"}))
        self.assertEqual([payload for _, payload in self.open_document(node)[1]], [a])

    def test_a_push_that_skips_seqs_is_out_of_another_lineage_or_ahead_of_the_log_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]
        first, second = typed_updates(client_id, ["a", "b"])

        for body, refusal in (
            (push_body(lineage, sid, client_id, 2, 0, second), {"collab": "seq", "acked": 0}),
            (push_body("0" * 32, sid, client_id, 1, 0, first), {"collab": "lineage"}),
            (push_body(lineage, sid, client_id, 1, 1, first), {"collab": "diverged"}),
        ):
            with self.subTest(refusal=refusal):
                response = call_route(routes.updates_post, node, body=body)
                self.assertEqual((response.status_code, answer(response)), (409, refusal))

        self.assertEqual(self.open_document(node)[1], [])
        self.assertEqual(self.push(node, sid, client_id, 1, first)[1]["rev"], 1)

    def test_a_push_of_bytes_no_tab_of_this_writer_could_send_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]
        [own] = typed_updates(client_id, ["a"])

        cases = (
            ("not an update", b"\x00\x01"),
            ("empty", b"\x00\x00"),
            ("nested too deep", embed_update(client_id, "[" * 100_000 + "]" * 100_000)),
            ("another writer's", typed_updates(client_id + 1, ["a"])[0]),
        )
        for case, payload in cases:
            with self.subTest(case):
                body = push_body(lineage, sid, client_id, 1, 0, payload)
                response = call_route(routes.updates_post, node, body=body)
                self.assertEqual((response.status_code, answer(response)), (400, {"collab": "malformed"}))

        self.assertEqual(self.open_document(node)[1], [])
        self.assertEqual(self.push(node, sid, client_id, 1, own)[0], 200)

    def test_a_push_from_a_build_newer_than_the_server_waits_and_is_stored_with_its_schema(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]
        newer = writer_content.SCHEMA.version + 1
        [a] = typed_updates(client_id, ["a"])
        body = push_body(lineage, sid, client_id, 1, 0, a, schema=newer)

        response = call_route(routes.updates_post, node, body=body)

        refusal = {
            "collab": "upgrading",
            "retry_ms": 30_000,
        }
        self.assertEqual((response.status_code, answer(response)), (423, refusal))
        self.assertEqual(self.open_document(node)[1], [])

        newer_schema = replace(writer_content.SCHEMA, version=newer)
        newer_spec = replace(writer_content.SPEC, schema=newer_schema)
        with patch.object(writer_content, "SPEC", newer_spec):
            self.assertEqual(call_route(routes.updates_post, node, body=body).status_code, 200)

        doc_id = routes.content.find(writer_content.ADAPTER, node).id
        self.assertEqual(
            frappe.db.sql("SELECT `schema` FROM `__writer_content_update` WHERE `doc_id` = %s", doc_id),
            ((newer,),),
        )

    def test_a_row_naming_what_its_schema_does_not_declare_is_refused_and_other_tabs_keep_saving(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        (sid, client_id), (other_sid, other_client_id) = self.start_session(node), self.start_session(node)
        marquee = push_body(lineage, sid, client_id, 1, 0, element_update(client_id, "marquee"))
        stepped = replace(
            writer_content.SCHEMA,
            version=2,
            features={**writer_content.SCHEMA.features, "marquee": 2},
            nodes=writer_content.SCHEMA.nodes | {"marquee"},
        )
        stepped_spec = replace(writer_content.SPEC, schema=stepped)
        [other_typing] = typed_updates(other_client_id, ["b"])
        other_body = push_body(lineage, other_sid, other_client_id, 1, 0, other_typing)
        stamped_body = push_body(
            lineage, sid, client_id, 1, 0, element_update(client_id, "marquee"), schema=2
        )

        undeclared = call_route(routes.updates_post, node, body=marquee)
        with patch.object(writer_content, "SPEC", stepped_spec):
            too_early = call_route(routes.updates_post, node, body=marquee)
            other = call_route(routes.updates_post, node, body=other_body)
            stamped = call_route(routes.updates_post, node, body=stamped_body)

        self.assertEqual(
            [(response.status_code, answer(response)) for response in (undeclared, too_early)],
            [(409, {"collab": "poison"})] * 2,
        )
        self.assertEqual((other.status_code, stamped.status_code), (200, 200))
        self.assertEqual(len(self.open_document(node)[1]), 2)

    def test_a_row_putting_a_type_the_editor_cannot_show_in_the_body_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        sid, client_id = self.start_session(node)

        refused = []
        # A Map, then a Text
        for shared in (1, 2):
            row = body_item_update(client_id, 7, encoded_uint(shared))
            body = push_body(lineage, sid, client_id, 1, 0, row)
            refused.append(call_route(routes.updates_post, node, body=body))

        self.assertEqual(
            [(response.status_code, answer(response)) for response in refused],
            [(409, {"collab": "poison"})] * 2,
        )
        self.assertEqual(self.open_document(node)[1], [])
        self.assertEqual(self.push(node, sid, client_id, 1, typed_updates(client_id, ["a"])[0])[0], 200)

    def test_a_row_using_a_name_in_the_wrong_role_or_an_embed_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        sid, client_id = self.start_session(node)
        rows = {
            "a mark name as a node": element_update(client_id, "bold"),
            "a node name as a mark": formatted_update(client_id, "paragraph"),
            "an overlapping mark's key": formatted_update(client_id, "bold--abc"),
            "an embed": body_item_update(client_id, 5, encoded_string("{}")),
        }

        for case, row in rows.items():
            with self.subTest(case):
                body = push_body(lineage, sid, client_id, 1, 0, row)
                response = call_route(routes.updates_post, node, body=body)
                self.assertEqual((response.status_code, answer(response)), (409, {"collab": "poison"}))

        self.assertEqual(self.open_document(node)[1], [])
        self.assertEqual(self.push(node, sid, client_id, 1, formatted_update(client_id, "bold"))[0], 200)

    def test_the_highest_schema_steps_up_only_when_a_stored_row_raises_it_and_older_tabs_stop_past_it(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        (sid, client_id), (newer_sid, newer_client_id), (later_sid, later_client_id) = (
            self.start_session(node) for _tab in range(3)
        )
        stepped = replace(
            writer_content.SCHEMA,
            version=2,
            features={**writer_content.SCHEMA.features, "marquee": 2},
            nodes=writer_content.SCHEMA.nodes | {"marquee"},
        )
        stepped_spec = replace(writer_content.SPEC, schema=stepped)

        def schema_steps():
            [(value,)] = frappe.db.sql(
                "SELECT `schema_steps` FROM `__writer_content_doc` WHERE `node` = %s", node
            )

            return json.loads(value)

        def push_with_schema(tab_sid, tab_client_id, seq, payload, schema):
            body = push_body(lineage, tab_sid, tab_client_id, seq, 0, payload, schema=schema)

            return call_route(routes.updates_post, node, body=body).status_code

        self.assertEqual(schema_steps(), [[0, 1]])
        self.assertEqual(self.open_document(node)[0]["schema"], 1)
        with patch.object(writer_content, "SPEC", stepped_spec):
            refused = [
                push_with_schema(
                    newer_sid, newer_client_id, 2, element_update(newer_client_id, "marquee"), 2
                ),
                push_with_schema(newer_sid, newer_client_id, 1, b"\x00", 2),
                push_with_schema(newer_sid, newer_client_id, 1, element_update(newer_client_id, "blink"), 2),
                push_with_schema(
                    newer_sid, newer_client_id, 1, element_update(newer_client_id, "marquee"), 3
                ),
            ]
            self.assertEqual(refused, [409, 400, 409, 423])
            self.assertEqual(push_with_schema(sid, client_id, 1, typed_updates(client_id, ["a"])[0], 1), 200)
            self.assertEqual(schema_steps(), [[0, 1]])
            self.assertEqual(
                push_with_schema(
                    newer_sid, newer_client_id, 1, element_update(newer_client_id, "marquee"), 2
                ),
                200,
            )
            self.assertEqual(
                push_with_schema(
                    later_sid, later_client_id, 1, element_update(later_client_id, "marquee"), 2
                ),
                200,
            )
            self.assertEqual(
                push_with_schema(sid, client_id, 2, typed_updates(client_id, ["a", "b"])[1], 1), 200
            )

        self.assertEqual(schema_steps(), [[0, 1], [2, 2]])
        pull = call_route(routes.updates_get, node)
        pulled = read_frame(pull.get_data())[0]
        self.assertEqual((self.open_document(node)[0]["schema"], pulled["schema"]), (2, 2))
        *_typed, third = typed_updates(client_id, ["a", "b", "c"])
        body = push_body(lineage, sid, client_id, 3, 2, third, schema=1)
        response = call_route(routes.updates_post, node, body=body)
        self.assertEqual((response.status_code, answer(response)), (409, {"collab": "schema"}))
        self.assertEqual(push_with_schema(sid, client_id, 3, third, 1), 200)

    def test_a_push_that_does_not_continue_its_writers_clocks_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        a, b, c = typed_updates(client_id, ["a", "b", "c"])

        # The text node takes clock 0, so "a" is clock 1 and "b" starts at 2
        self.assertEqual(self.push(node, sid, client_id, 1, b), (409, {"collab": "clock_gap", "clock": 0}))
        self.assertEqual(self.push(node, sid, client_id, 1, a)[0], 200)
        self.assertEqual(self.push(node, sid, client_id, 2, c), (409, {"collab": "clock_gap", "clock": 2}))
        self.assertEqual(self.push(node, sid, client_id, 2, a), (409, {"collab": "clock_gap", "clock": 2}))

        self.assertEqual(self.open_document(node)[1], [(1, a)])
        self.assertEqual(
            [self.push(node, sid, client_id, seq, each)[0] for seq, each in ((2, b), (3, c))], [200, 200]
        )

    def test_a_push_that_needs_another_writers_unsent_typing_waits_for_it(self):
        self.set_mode("on")
        node = self.new_document()
        (first_sid, first_client_id), (second_sid, second_client_id) = (
            self.start_session(node),
            self.start_session(node),
        )
        [abc] = typed_updates(first_client_id, ["abc"])
        tab = pycrdt.Doc(client_id=second_client_id)
        tab.apply_update(abc)
        before = tab.get_state()
        text = tab.get("default", type=pycrdt.XmlFragment).children[0]
        text.insert(3, "x")
        after_c = tab.get_update(before)

        # "x" sits after "c", the first writer's clock 3
        self.assertEqual(
            self.push(node, second_sid, second_client_id, 1, after_c),
            (409, {"collab": "missing_dep", "client": first_client_id, "clock": 3}),
        )
        self.assertEqual(self.open_document(node)[1], [])
        self.assertEqual(self.push(node, first_sid, first_client_id, 1, abc)[0], 200)
        self.assertEqual(self.push(node, second_sid, second_client_id, 1, after_c)[0], 200)
        self.assertEqual(self.open_document(node)[1], [(1, abc), (2, after_c)])

    def test_a_push_whose_text_follows_itself_or_later_text_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        def after(clock: int, text: str) -> bytes:
            return bytes([0x84]) + encoded_uint(client_id) + encoded_uint(clock) + encoded_string(text)

        in_root = bytes([4, 1]) + encoded_string("default") + encoded_string("b")
        rows = {
            # "a" at clock 0 placed after clock 0, itself
            "itself": bytes([1, 1]) + encoded_uint(client_id) + bytes([0]) + after(0, "a") + bytes([0]),
            # "a" at clock 0 placed after "b" at clock 1, later in the same row
            "later text": bytes([1, 2])
            + encoded_uint(client_id)
            + bytes([0])
            + after(1, "a")
            + in_root
            + bytes([0]),
        }
        for (case, payload), clock in zip(rows.items(), (0, 1), strict=True):
            with self.subTest(case):
                stuck = pycrdt.Doc()
                stuck.apply_update(payload)
                self.assertEqual(stuck.get_state(), pycrdt.Doc().get_state())
                self.assertEqual(
                    self.push(node, sid, client_id, 1, payload),
                    (409, {"collab": "missing_dep", "client": client_id, "clock": clock}),
                )

        self.assertEqual(self.open_document(node)[1], [])
        self.assertEqual(self.push(node, sid, client_id, 1)[0], 200)

    def test_a_delete_may_reach_the_last_committed_clock_and_no_further(self):
        self.set_mode("on")
        node = self.new_document()
        sessions = [self.start_session(node) for _ in range(3)]
        (first_sid, first_client_id), (seen_sid, seen_client_id), (ahead_sid, ahead_client_id) = sessions
        abc, d = typed_updates(first_client_id, ["abc", "d"])
        self.assertEqual(self.push(node, first_sid, first_client_id, 1, abc)[0], 200)

        def deleting(client_id, rows, start, end):
            tab = pycrdt.Doc(client_id=client_id)
            for row in rows:
                tab.apply_update(row)

            before = tab.get_state()
            text = tab.get("default", type=pycrdt.XmlFragment).children[0]
            del text[start:end]

            return tab.get_update(before)

        # Committed clocks end at 3 ("c"); "d" is clock 4
        last = deleting(seen_client_id, [abc], 2, 3)
        past = deleting(ahead_client_id, [abc, d], 3, 4)

        self.assertEqual(self.push(node, seen_sid, seen_client_id, 1, last)[0], 200)
        self.assertEqual(
            self.push(node, ahead_sid, ahead_client_id, 1, past),
            (409, {"collab": "missing_dep", "client": first_client_id, "clock": 4}),
        )
        self.assertEqual(self.push(node, first_sid, first_client_id, 2, d)[0], 200)
        self.assertEqual(self.push(node, ahead_sid, ahead_client_id, 1, past)[0], 200)

    def test_a_copy_is_edited_where_its_start_was_written_and_nowhere_past_it(self):
        self.set_mode("on")
        node = self.new_document()
        original, later = typed_updates(7, ["start", "!"])
        doc_id = routes.content.find(writer_content.ADAPTER, node).id
        routes.content.replace_start(writer_content.ADAPTER, doc_id, original, 1)
        frappe.db.commit()
        (sid, client_id), (ahead_sid, ahead_client_id) = self.start_session(node), self.start_session(node)

        def appending(tab_client_id, rows):
            tab = pycrdt.Doc(client_id=tab_client_id)
            for row in rows:
                tab.apply_update(row)

            before = tab.get_state()
            text = tab.get("default", type=pycrdt.XmlFragment).children[0]
            text.insert(len(str(text)), "?")

            return tab.get_update(before)

        # "start" is clocks 1 to 5 of the writer the copy began from; "!" is clock 6
        appended_to_start = appending(client_id, [original])
        appended_past_start = appending(ahead_client_id, [original, later])
        self.assertEqual(self.push(node, sid, client_id, 1, appended_to_start)[0], 200)
        self.assertEqual(
            self.push(node, ahead_sid, ahead_client_id, 1, appended_past_start),
            (409, {"collab": "missing_dep", "client": 7, "clock": 6}),
        )

    def test_logs_made_before_clocks_were_kept_read_them_from_their_rows(self):
        self.set_mode("on")
        node = self.new_document()
        start, after_start = typed_updates(7, ["start", "!"])
        doc_id = routes.content.find(writer_content.ADAPTER, node).id
        routes.content.replace_start(writer_content.ADAPTER, doc_id, start, 1)
        frappe.db.commit()
        sid, client_id = self.start_session(node)
        a, b, c = typed_updates(client_id, ["a", "b", "c"])
        self.assertEqual(
            [self.push(node, sid, client_id, seq, each)[0] for seq, each in ((1, a), (2, b))], [200, 200]
        )
        frappe.db.sql("UPDATE `__writer_content_session` SET `next_clock` = NULL WHERE `doc_id` = %s", doc_id)
        frappe.db.sql("UPDATE `__writer_content_doc` SET `start_clocks` = NULL WHERE `id` = %s", doc_id)
        frappe.db.commit()

        routes.content.backfill_clocks(writer_content.ADAPTER, routes.node_owner)

        self.assertEqual(self.push(node, sid, client_id, 3, a), (409, {"collab": "clock_gap", "clock": 3}))
        self.assertEqual(self.push(node, sid, client_id, 3, c)[0], 200)
        other_sid, other_client_id = self.start_session(node)
        tab = pycrdt.Doc(client_id=other_client_id)
        tab.apply_update(start)
        before = tab.get_state()
        text = tab.get("default", type=pycrdt.XmlFragment).children[0]
        del text[4:5]
        within_start = tab.get_update(before)
        self.assertEqual(self.push(node, other_sid, other_client_id, 1, within_start)[0], 200)

        tab.apply_update(after_start)
        before = tab.get_state()
        text = tab.get("default", type=pycrdt.XmlFragment).children[0]
        del text[4:5]
        past_start = tab.get_update(before)
        self.assertEqual(
            self.push(node, other_sid, other_client_id, 2, past_start),
            (409, {"collab": "missing_dep", "client": 7, "clock": 6}),
        )

    def test_a_push_that_fails_midway_leaves_no_trace(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        sql = frappe.db.sql

        def failing_sql(query, *args, **kwargs):
            if "`last_push_at`" in query:
                raise RuntimeError("database gone")

            return sql(query, *args, **kwargs)

        with patch.object(frappe.db, "sql", failing_sql), self.assertRaises(RuntimeError):
            a = self.typed_update(client_id, 1, "a")
            self.push(node, sid, client_id, 1, a)

        self.assertEqual(self.open_document(node)[1], [])
        b = self.typed_update(client_id, 1, "b")
        self.assertEqual(self.push(node, sid, client_id, 1, b)[1]["rev"], 1)
        self.assertEqual(self.open_document(node)[1], [(1, b)])
        self.assert_one_order(node, 1)

    def test_a_worker_killed_at_any_step_loses_and_duplicates_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        sql, commit = frappe.db.sql, frappe.db.commit
        calls = []

        def killing_at_step(real, *, after: bool):
            def counted_call(*args, **kwargs):
                calls.append(real)
                if len(calls) == kill_at and not after:
                    raise RuntimeError("worker killed")

                result = real(*args, **kwargs)
                if len(calls) == kill_at and after:
                    raise RuntimeError("worker killed")

                return result

            return counted_call

        def push_counted(seq: int):
            calls.clear()
            with (
                patch.object(frappe.db, "sql", killing_at_step(sql, after=False)),
                patch.object(frappe.db, "commit", killing_at_step(commit, after=True)),
            ):
                return self.push(node, sid, client_id, seq)

        kill_at = 0
        self.assertEqual(push_counted(1)[0], 200)
        steps = len(calls)
        for kill_at in range(1, steps + 1):
            seq = kill_at + 1
            with self.subTest(step=kill_at):
                try:
                    push_counted(seq)
                except RuntimeError:
                    frappe.db.rollback()
                self.assertEqual(self.push(node, sid, client_id, seq)[0], 200)

        self.assert_one_order(node, steps + 1)
        self.assertEqual(
            [payload for _, payload in self.open_document(node)[1]],
            typed_updates(client_id, [str(seq) for seq in range(1, steps + 2)]),
        )

    def test_a_user_without_edit_access_cannot_push(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]

        frappe.set_user(OUTSIDER)
        body = push_body(lineage, sid, client_id, 1, 0, b"x")
        response = call_route(routes.updates_post, node, body=body)

        self.assertIn(response.status_code, (403, 404))
        frappe.set_user(WRITER)
        self.assertEqual(self.open_document(node)[1], [])

    def test_a_reader_follows_but_cannot_write(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        grant(node, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()

        frappe.set_user(READER)
        header, _rows = self.open_document(node)
        session_body = json.dumps({"sid": uuid.uuid4().hex}).encode()
        own_session = call_route(routes.sessions_post, node, body=session_body)
        push_bytes = push_body(header["lineage"], sid, client_id, 1, 0, b"x")
        push = call_route(routes.updates_post, node, body=push_bytes)

        self.assertEqual((header["state"], header["can_write"]), ("live", False))
        self.assertEqual((own_session.status_code, push.status_code), (403, 403))
        frappe.set_user(WRITER)
        self.assertEqual(self.open_document(node)[1], [])

    def test_a_tab_signed_out_or_switched_is_told_why_before_any_access_check(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]
        body = push_body(lineage, sid, client_id, 1, 0, b"x", principal=WRITER)
        session_body = json.dumps({"sid": uuid.uuid4().hex}).encode()
        handlers = (
            (routes.document_get, b""),
            (routes.updates_get, b""),
            (routes.sessions_post, session_body),
            (routes.updates_post, body),
            (routes.suspect_post, b'{"rev": 1}'),
            (
                lambda node: routes.stage_put(node, uuid.uuid4().hex, "0"),
                piece_body(lineage, sid, 1, b"x", b"x", principal=WRITER),
            ),
        )

        for user, expected in (("Guest", (401, "signed_out")), (OUTSIDER, (409, "principal_changed"))):
            frappe.set_user(user)
            for handler, request_body in handlers:
                response = call_route(handler, node, body=request_body, principal=WRITER)
                self.assertEqual((response.status_code, answer(response)["collab"]), expected)

        frappe.set_user(WRITER)
        self.assertEqual(self.open_document(node)[1], [])

    def test_a_guest_reads_but_cannot_write_even_where_drive_would_let_them(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]

        frappe.set_user("Guest")
        with patch.object(routes.drive, "check"):
            header, _rows = self.open_document(node)
            session_body = json.dumps({"sid": uuid.uuid4().hex}).encode()
            session = call_route(routes.sessions_post, node, body=session_body)
            push_bytes = push_body(lineage, sid, client_id, 1, 0, b"x")
            push = call_route(routes.updates_post, node, body=push_bytes)

        self.assertEqual((header["state"], header["can_write"]), ("live", False))
        for response in (session, push):
            self.assertEqual((response.status_code, answer(response)["collab"]), (401, "signed_out"))
        frappe.set_user(WRITER)
        self.assertEqual(self.open_document(node)[1], [])

    def test_a_node_no_app_keeps_here_is_not_found_as_a_missing_one_is(self):
        self.set_mode("on")
        root = drive.ensure_personal_root(WRITER)
        parent = frappe.db.get_value("Drive Root", root, "node")
        presentation = drive.create_document(
            parent, f"Not here {uuid.uuid4().hex[:8]}", content_doctype="Presentation"
        )
        frappe.db.commit()
        session_body = json.dumps({"sid": uuid.uuid4().hex}).encode()
        push_bytes = push_body(uuid.uuid4().hex, uuid.uuid4().hex, 7, 1, 0, b"x")
        handlers = (
            (routes.document_get, b""),
            (routes.updates_get, b""),
            (routes.sessions_post, session_body),
            (routes.updates_post, push_bytes),
            (routes.suspect_post, b'{"rev": 1}'),
            (lambda node: routes.stage_put(node, uuid.uuid4().hex, "0"), b"x"),
        )

        for node in (presentation, "no-such-node"):
            for handler, request_body in handlers:
                response = call_route(handler, node, body=request_body)
                self.assertEqual((response.status_code, answer(response)), (404, {"collab": "not_found"}))
        self.assertIsNone(routes.content.find(writer_content.ADAPTER, presentation))

    def test_an_offline_tab_claims_its_own_client_id_and_then_pushes(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        sid, client_id = uuid.uuid4().hex, 2**30 + 7

        self.assertEqual(self.claim(node, sid, client_id, lineage), (200, {"claim": "ok"}))
        self.assertEqual(self.claim(node, sid, client_id, lineage), (200, {"claim": "ok"}))
        offline = self.typed_update(client_id, 1, "offline")
        self.assertEqual(self.push(node, sid, client_id, 1, offline)[0], 200)
        self.assertEqual([payload for _, payload in self.open_document(node)[1]], [offline])

    def test_a_claim_on_a_taken_id_or_another_lineage_binds_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        client_id = 2**30 + 9
        self.assertEqual(self.claim(node, uuid.uuid4().hex, client_id, lineage)[1], {"claim": "ok"})
        sessions = self.table_count("session")

        clash = self.claim(node, uuid.uuid4().hex, client_id, lineage)
        other_lineage = self.claim(node, uuid.uuid4().hex, client_id + 1, "0" * 32)

        self.assertEqual((clash, other_lineage), ((200, {"claim": "clash"}), (200, {"claim": "lineage"})))
        self.assertEqual(self.table_count("session"), sessions)

    def test_a_tab_never_gets_the_id_of_a_writer_its_copy_started_from(self):
        self.set_mode("on")
        node = self.new_document()
        issued, claimed = 7, 2**30 + 7
        [issued_start] = typed_updates(issued, ["start"])
        [claimed_start] = typed_updates(claimed, ["start"])
        start = pycrdt.merge_updates(issued_start, claimed_start)
        doc_id = routes.content.find(writer_content.ADAPTER, node).id
        routes.content.replace_start(writer_content.ADAPTER, doc_id, start, 1)
        frappe.db.commit()
        lineage = self.open_document(node)[0]["lineage"]

        with patch("secrets.randbelow", side_effect=[issued - 1, 41]):
            self.assertEqual(self.start_session(node)[1], 42)
        self.assertEqual(self.claim(node, uuid.uuid4().hex, claimed, lineage), (200, {"claim": "clash"}))
        self.assertEqual(self.claim(node, uuid.uuid4().hex, claimed + 1, lineage), (200, {"claim": "ok"}))

    def test_a_claim_outside_the_device_range_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]

        for client_id in (5, 2**31, "x"):
            self.assertEqual(
                self.claim(node, uuid.uuid4().hex, client_id, lineage), (400, {"collab": "malformed"})
            )

    def test_many_writers_at_once_get_gap_free_revs(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        writers, pushes = 16, 10
        sessions = [self.start_session(node) for _ in range(writers)]
        site, failures = frappe.local.site, []

        def push_all(sid: str, client_id: int):
            frappe.init(site=site)
            frappe.connect()
            frappe.set_user(WRITER)
            sent = typed_updates(client_id, [str(seq) for seq in range(1, pushes + 1)])

            try:
                seq = 1
                while seq <= pushes:
                    body = push_body(lineage, sid, client_id, seq, 0, sent[seq - 1])
                    response = call_route(routes.updates_post, node, body=body)
                    if response.status_code == 200:
                        seq += 1
                    elif response.status_code == 423:
                        time.sleep(0.005)
                    else:
                        failures.append(answer(response))
                        return
            finally:
                frappe.destroy()

        threads = [threading.Thread(target=push_all, args=session) for session in sessions]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(failures, [])
        self.assert_one_order(node, writers * pushes)

    def test_an_open_on_a_broken_chain_is_refused_and_logged(self):
        self.set_mode("on")
        node = self.new_document()
        self.push(node, *self.start_session(node), 1)
        doc_id = routes.content.find(writer_content.ADAPTER, node).id
        frappe.db.sql(
            "UPDATE `__writer_content_doc` SET `head_chain` = %s WHERE `id` = %s", (b"\x00" * 32, doc_id)
        )
        frappe.db.commit()
        self.addCleanup(frappe.db.commit)
        logged = {
            "method": "Collab open: chain_break",
            "error": f"{writer_content.ADAPTER} document {doc_id}",
        }
        self.addCleanup(frappe.db.delete, "Error Log", logged)

        response = call_route(routes.document_get, node)
        # The request is a GET, so frappe rolls back what it wrote
        frappe.db.rollback()

        self.assertEqual((response.status_code, answer(response)), (503, {"collab": "chain_break"}))
        self.assertEqual(frappe.db.count("Error Log", logged), 1)
