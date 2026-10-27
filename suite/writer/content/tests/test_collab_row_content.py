import json
from dataclasses import replace
from unittest.mock import patch

import frappe
from werkzeug.wrappers import Response

from suite.content.http import routes
from suite.content.updates import encoded_string, encoded_uint
from suite.writer import content as writer_content
from suite.writer.content.tests.support import (
    CollabCase,
    answer,
    body_item_update,
    call_route,
    element_update,
    embed_update,
    formatted_update,
    push_body,
    read_frame,
    typed_updates,
)


class TestWriterCollabRowContent(CollabCase):
    def test_a_push_of_bytes_no_tab_of_this_writer_could_send_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        [own] = typed_updates(client_id, ["a"])
        [another_writers] = typed_updates(client_id + 1, ["a"])

        cases = (
            ("not an update", b"\x00\x01"),
            ("empty", b"\x00\x00"),
            ("nested too deep", embed_update(client_id, "[" * 100_000 + "]" * 100_000)),
            ("another writer's", another_writers),
        )
        for case, payload in cases:
            with self.subTest(case):
                body = push_body(lineage, sid, client_id, 1, 0, payload)
                response = call_route(routes.updates_post, node, body=body)
                self.assertEqual((response.status_code, answer(response)), (400, {"collab": "malformed"}))

        _, rows = self.open_document(node)
        self.assertEqual(rows, [])
        status, _ = self.push(node, sid, client_id, 1, own)
        self.assertEqual(status, 200)

    def test_a_push_from_a_build_newer_than_the_server_waits_and_is_stored_with_its_schema(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        newer = writer_content.SCHEMA.version + 1
        [typed] = typed_updates(client_id, ["a"])
        body = push_body(lineage, sid, client_id, 1, 0, typed, schema=newer)

        response = call_route(routes.updates_post, node, body=body)

        refusal = {
            "collab": "upgrading",
            "retry_ms": 30_000,
        }
        self.assertEqual((response.status_code, answer(response)), (423, refusal))
        _, rows = self.open_document(node)
        self.assertEqual(rows, [])

        newer_schema = replace(writer_content.SCHEMA, version=newer)
        newer_spec = replace(writer_content.EDITOR, schema=newer_schema)
        with patch.object(writer_content, "EDITOR", newer_spec):
            self.assertEqual(call_route(routes.updates_post, node, body=body).status_code, 200)

        doc_id = routes.content.find(writer_content.APP, node).id
        self.assertEqual(
            frappe.db.sql("SELECT `schema` FROM `__writer_content_update` WHERE `doc_id` = %s", doc_id),
            ((newer,),),
        )

    def test_a_row_naming_what_its_schema_does_not_declare_is_refused_and_other_tabs_keep_saving(self):
        self.set_mode("on")
        node = self.new_document()
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        sid, client_id = self.start_session(node)
        other_sid, other_client_id = self.start_session(node)
        marquee = push_body(lineage, sid, client_id, 1, 0, element_update(client_id, "marquee"))
        stepped = replace(
            writer_content.SCHEMA,
            version=2,
            features={**writer_content.SCHEMA.features, "marquee": 2},
            nodes=writer_content.SCHEMA.nodes | {"marquee"},
        )
        stepped_spec = replace(writer_content.EDITOR, schema=stepped)
        [other_typing] = typed_updates(other_client_id, ["b"])
        other_body = push_body(lineage, other_sid, other_client_id, 1, 0, other_typing)
        stamped_body = push_body(
            lineage, sid, client_id, 1, 0, element_update(client_id, "marquee"), schema=2
        )

        undeclared = call_route(routes.updates_post, node, body=marquee)
        with patch.object(writer_content, "EDITOR", stepped_spec):
            too_early = call_route(routes.updates_post, node, body=marquee)
            other = call_route(routes.updates_post, node, body=other_body)
            stamped = call_route(routes.updates_post, node, body=stamped_body)

        self.assertEqual(
            [(response.status_code, answer(response)) for response in (undeclared, too_early)],
            [(409, {"collab": "poison"})] * 2,
        )
        self.assertEqual((other.status_code, stamped.status_code), (200, 200))
        _, rows = self.open_document(node)
        self.assertEqual(len(rows), 2)

    def test_a_row_putting_a_type_the_editor_cannot_show_in_the_body_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        sid, client_id = self.start_session(node)

        refused: list[Response] = []
        # A Map, then a Text
        for shared in (1, 2):
            row = body_item_update(client_id, 7, encoded_uint(shared))
            body = push_body(lineage, sid, client_id, 1, 0, row)
            refused.append(call_route(routes.updates_post, node, body=body))

        self.assertEqual(
            [(response.status_code, answer(response)) for response in refused],
            [(409, {"collab": "poison"})] * 2,
        )
        _, rows = self.open_document(node)
        self.assertEqual(rows, [])
        [typed] = typed_updates(client_id, ["a"])
        status, _ = self.push(node, sid, client_id, 1, typed)
        self.assertEqual(status, 200)

    def test_a_row_using_a_name_in_the_wrong_role_or_an_embed_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        header, _ = self.open_document(node)
        lineage = header["lineage"]
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

        _, stored_rows = self.open_document(node)
        self.assertEqual(stored_rows, [])
        status, _ = self.push(node, sid, client_id, 1, formatted_update(client_id, "bold"))
        self.assertEqual(status, 200)

    def test_the_highest_schema_steps_up_only_when_a_stored_row_raises_it_and_older_tabs_stop_past_it(self):
        self.set_mode("on")
        node = self.new_document()
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        sid, client_id = self.start_session(node)
        newer_sid, newer_client_id = self.start_session(node)
        later_sid, later_client_id = self.start_session(node)
        stepped = replace(
            writer_content.SCHEMA,
            version=2,
            features={**writer_content.SCHEMA.features, "marquee": 2},
            nodes=writer_content.SCHEMA.nodes | {"marquee"},
        )
        stepped_spec = replace(writer_content.EDITOR, schema=stepped)

        def schema_steps():
            [(value,)] = frappe.db.sql(
                "SELECT `schema_steps` FROM `__writer_content_doc` WHERE `node` = %s", node
            )

            return json.loads(value)

        def push_with_schema(tab_sid, tab_client_id, seq, payload, schema):
            body = push_body(lineage, tab_sid, tab_client_id, seq, 0, payload, schema=schema)

            return call_route(routes.updates_post, node, body=body).status_code

        self.assertEqual(schema_steps(), [[0, 1]])
        header, _ = self.open_document(node)
        self.assertEqual(header["schema"], 1)
        with patch.object(writer_content, "EDITOR", stepped_spec):
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
            [first_typed] = typed_updates(client_id, ["a"])
            self.assertEqual(push_with_schema(sid, client_id, 1, first_typed, 1), 200)
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
            _, second_typed = typed_updates(client_id, ["a", "b"])
            self.assertEqual(push_with_schema(sid, client_id, 2, second_typed, 1), 200)

        self.assertEqual(schema_steps(), [[0, 1], [2, 2]])
        pull = call_route(routes.updates_get, node)
        pulled, _ = read_frame(pull.get_data())
        header, _ = self.open_document(node)
        self.assertEqual((header["schema"], pulled["schema"]), (2, 2))
        *_typed, third = typed_updates(client_id, ["a", "b", "c"])
        body = push_body(lineage, sid, client_id, 3, 2, third, schema=1)
        response = call_route(routes.updates_post, node, body=body)
        self.assertEqual((response.status_code, answer(response)), (409, {"collab": "schema"}))
        self.assertEqual(push_with_schema(sid, client_id, 3, third, 1), 200)
