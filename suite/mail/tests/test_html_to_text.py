# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""The text/plain rendering contract: an HTML body keeps its shape on the way to a plain-text
reader. Line breaks survive, paragraphs stay apart, lists keep their markers, quotes keep their
``>``, links keep their destinations, and nothing a browser hides leaks into view. Under
``flowed`` the lines that were only broken to fit say so, and the ones whose breaks mean
something do not."""

import unittest

from suite.mail.utils.html_to_text import DEFAULT_WIDTH, html_to_text, to_flowed


class Empty(unittest.TestCase):
    """Nothing in, nothing out, and never a crash on the way."""

    def test_none(self):
        self.assertEqual(html_to_text(None), "")

    def test_empty_string(self):
        self.assertEqual(html_to_text(""), "")

    def test_whitespace_only(self):
        self.assertEqual(html_to_text("   \n\t "), "")

    def test_markup_with_no_text(self):
        self.assertEqual(html_to_text("<div><span></span></div>"), "")

    def test_unclosed_tags_keep_their_text(self):
        # Where the parser closes an unclosed block is its own business; losing the text is not.
        self.assertEqual(html_to_text("<div><p>Hello<div>World"), "Hello\nWorld")


class LineBreaks(unittest.TestCase):
    """The defect this module exists for: a body must not arrive as one line."""

    def test_br_breaks_the_line(self):
        self.assertEqual(html_to_text("Hello<br>World"), "Hello\nWorld")

    def test_divs_are_consecutive_lines(self):
        # What the composer writes: one <div> per line, no blank line between them.
        self.assertEqual(html_to_text("<div>One</div><div>Two</div>"), "One\nTwo")

    def test_paragraphs_are_separated_by_a_blank_line(self):
        self.assertEqual(html_to_text("<p>One</p><p>Two</p>"), "One\n\nTwo")

    def test_empty_div_with_a_break_is_a_blank_line(self):
        # The composer's spelling of "the sender pressed Return".
        self.assertEqual(
            html_to_text("<div>Hi,</div><div><br></div><div>Bye</div>"),
            "Hi,\n\nBye",
        )

    def test_trailing_break_does_not_add_a_line(self):
        self.assertEqual(html_to_text("<div>One<br></div><div>Two</div>"), "One\nTwo")

    def test_consecutive_breaks_are_blank_lines(self):
        self.assertEqual(html_to_text("<div>One<br><br>Two</div>"), "One\n\nTwo")

    def test_empty_div_without_a_break_is_not_a_line(self):
        self.assertEqual(html_to_text("<div>One</div><div></div><div>Two</div>"), "One\nTwo")

    def test_heading_stands_apart(self):
        self.assertEqual(html_to_text("<h1>Title</h1><p>Body</p>"), "Title\n\nBody")

    def test_blank_runs_are_capped(self):
        html = "<div>One</div>" + "<div><br></div>" * 6 + "<div>Two</div>"
        self.assertEqual(html_to_text(html), "One\n\n\nTwo")

    def test_leading_and_trailing_blank_lines_are_dropped(self):
        self.assertEqual(html_to_text("<div><br></div><p>Body</p><div><br></div>"), "Body")


class Whitespace(unittest.TestCase):
    """Source formatting is not content, and content is not source formatting."""

    def test_source_newlines_collapse_to_a_space(self):
        self.assertEqual(html_to_text("<p>Hello\n   there</p>"), "Hello there")

    def test_space_between_tags_does_not_double(self):
        self.assertEqual(html_to_text("<p><b>Hello</b> <i>there</i></p>"), "Hello there")

    def test_whitespace_between_blocks_is_not_a_paragraph(self):
        self.assertEqual(html_to_text("<div>One</div>\n  \n<div>Two</div>"), "One\nTwo")

    def test_no_break_space_becomes_a_space(self):
        self.assertEqual(html_to_text("<p>Hello\xa0there</p>"), "Hello there")

    def test_zero_width_characters_are_removed(self):
        self.assertEqual(html_to_text("<p>He​llo﻿</p>"), "Hello")

    def test_soft_hyphen_is_removed(self):
        self.assertEqual(html_to_text("<p>man­uscript</p>"), "manuscript")


class Links(unittest.TestCase):
    """A plain-text reader has no href to fall back on, so the destination is spelled inline."""

    def test_url_follows_the_label(self):
        self.assertEqual(
            html_to_text('<p>Read <a href="https://example.com/spec">the spec</a>.</p>'),
            "Read the spec <https://example.com/spec>.",
        )

    def test_label_that_is_already_the_url_is_not_repeated(self):
        self.assertEqual(
            html_to_text('<p><a href="https://example.com">https://example.com</a></p>'),
            "https://example.com",
        )

    def test_label_matching_the_url_but_for_scheme_is_not_repeated(self):
        self.assertEqual(
            html_to_text('<p><a href="https://www.example.com/">example.com</a></p>'),
            "example.com",
        )

    def test_mailto_is_shown_as_the_address(self):
        self.assertEqual(
            html_to_text('<p>Write to <a href="mailto:someone@example.com">Alex</a>.</p>'),
            "Write to Alex <someone@example.com>.",
        )

    def test_mailto_matching_its_label_is_not_repeated(self):
        self.assertEqual(
            html_to_text('<p><a href="mailto:someone@example.com">someone@example.com</a></p>'),
            "someone@example.com",
        )

    def test_mailto_query_is_dropped(self):
        self.assertEqual(
            html_to_text('<p><a href="mailto:s@example.com?subject=Hi">Ping</a></p>'),
            "Ping <s@example.com>",
        )

    def test_opaque_hrefs_contribute_nothing(self):
        for href in ("#", "#anchor", "javascript:void(0)", "data:text/plain,x", "cid:logo"):
            with self.subTest(href=href):
                self.assertEqual(html_to_text('<p><a href="' + href + '">Label</a></p>'), "Label")

    def test_anchor_without_href_is_just_its_label(self):
        self.assertEqual(html_to_text("<p><a>Label</a></p>"), "Label")

    def test_unlabelled_link_still_carries_its_url(self):
        self.assertEqual(
            html_to_text('<p><a href="https://example.com/x"><img src="l.png"></a></p>'),
            "<https://example.com/x>",
        )

    def test_nested_markup_in_the_label_is_kept(self):
        self.assertEqual(
            html_to_text('<p><a href="https://example.com"><b>Bold</b> link</a></p>'),
            "Bold link <https://example.com>",
        )

    def test_url_is_never_broken_across_lines(self):
        url = "https://example.com/a/very/long/path/that/keeps/going/and/going/forever"
        text = html_to_text('<p>See <a href="' + url + '">here</a> now.</p>')
        self.assertIn("<" + url + ">", text)


class Lists(unittest.TestCase):
    """Markers are what makes a list a list once the bullets are gone."""

    def test_unordered_items_get_a_dash(self):
        self.assertEqual(
            html_to_text("<ul><li>First</li><li>Second</li></ul>"),
            "- First\n- Second",
        )

    def test_ordered_items_are_numbered(self):
        self.assertEqual(
            html_to_text("<ol><li>First</li><li>Second</li></ol>"),
            "1. First\n2. Second",
        )

    def test_ordered_list_honours_start(self):
        self.assertEqual(
            html_to_text('<ol start="3"><li>Third</li><li>Fourth</li></ol>'),
            "3. Third\n4. Fourth",
        )

    def test_list_is_separated_from_surrounding_text(self):
        self.assertEqual(
            html_to_text("<p>Agenda:</p><ul><li>One</li></ul><p>Thanks</p>"),
            "Agenda:\n\n- One\n\nThanks",
        )

    def test_nested_list_is_indented_under_its_parent(self):
        self.assertEqual(
            html_to_text("<ul><li>Outer<ul><li>Inner</li></ul></li></ul>"),
            "- Outer\n  - Inner",
        )

    def test_wrapped_item_aligns_under_its_marker(self):
        text = html_to_text("<ul><li>" + "word " * 30 + "</li></ul>", width=40)
        lines = text.split("\n")
        self.assertTrue(lines[0].startswith("- "))
        self.assertTrue(all(line.startswith("  ") and not line.startswith("- ") for line in lines[1:]))

    def test_second_paragraph_in_an_item_keeps_the_indent(self):
        self.assertEqual(
            html_to_text("<ul><li><p>One</p><p>Two</p></li></ul>"),
            "- One\n\n  Two",
        )


class Quotes(unittest.TestCase):
    """A blockquote is the reply trail, and `>` is how a plain-text reader sees it."""

    def test_blockquote_is_prefixed(self):
        self.assertEqual(html_to_text("<blockquote><p>Quoted</p></blockquote>"), "> Quoted")

    def test_nested_blockquotes_stack(self):
        self.assertEqual(
            html_to_text("<blockquote><blockquote><p>Deep</p></blockquote></blockquote>"),
            ">> Deep",
        )

    def test_blank_line_inside_a_quote_keeps_the_marker(self):
        self.assertEqual(
            html_to_text("<blockquote><p>One</p><p>Two</p></blockquote>"),
            "> One\n>\n> Two",
        )

    def test_quote_after_body_text(self):
        self.assertEqual(
            html_to_text("<p>Agreed.</p><blockquote><p>Original</p></blockquote>"),
            "Agreed.\n\n> Original",
        )

    def test_wrapped_quote_keeps_the_marker_on_every_line(self):
        text = html_to_text("<blockquote><p>" + "word " * 40 + "</p></blockquote>", width=40)
        self.assertTrue(all(line.startswith("> ") for line in text.split("\n")))


class Preformatted(unittest.TestCase):
    """<pre> means the whitespace is the content."""

    def test_internal_newlines_and_spacing_survive(self):
        self.assertEqual(
            html_to_text("<pre>def f():\n    return 1</pre>"),
            "def f():\n    return 1",
        )

    def test_surrounding_newlines_are_trimmed(self):
        self.assertEqual(html_to_text("<pre>\ncode\n</pre>"), "code")

    def test_long_lines_are_not_wrapped(self):
        line = "x" * 200
        self.assertEqual(html_to_text("<pre>" + line + "</pre>", width=40), line)


class Tables(unittest.TestCase):
    """A row is a line; cells are separated, not broken."""

    def test_row_becomes_one_line(self):
        self.assertEqual(
            html_to_text("<table><tr><td><b>From:</b></td><td>a@example.com</td></tr></table>"),
            "From: a@example.com",
        )

    def test_rows_are_consecutive_lines(self):
        html = "<table><tr><td>From:</td><td>a</td></tr><tr><td>To:</td><td>b</td></tr></table>"
        self.assertEqual(html_to_text(html), "From: a\nTo: b")


class Dropped(unittest.TestCase):
    """What a browser never shows must not be the first thing a terminal does."""

    def test_style_and_script_contribute_nothing(self):
        html = "<style>p{color:red}</style><script>alert(1)</script><p>Body</p>"
        self.assertEqual(html_to_text(html), "Body")

    def test_head_is_skipped(self):
        html = "<html><head><title>Subject</title></head><body><p>Body</p></body></html>"
        self.assertEqual(html_to_text(html), "Body")

    def test_display_none_preheader_is_skipped(self):
        html = '<div style="display:none">Preheader teaser</div><p>Body</p>'
        self.assertEqual(html_to_text(html), "Body")

    def test_mso_hide_is_skipped(self):
        self.assertEqual(html_to_text('<div style="mso-hide:all">Hidden</div><p>B</p>'), "B")

    def test_hidden_attribute_is_skipped(self):
        self.assertEqual(html_to_text("<div hidden>Hidden</div><p>B</p>"), "B")

    def test_button_label_is_dropped(self):
        self.assertEqual(html_to_text("<p>Body</p><button>Click</button>"), "Body")

    def test_comments_are_not_content(self):
        self.assertEqual(html_to_text("<p>Body<!-- note --></p>"), "Body")

    def test_image_alt_is_kept(self):
        self.assertEqual(html_to_text('<p><img alt="Logo" src="l.png"> Corp</p>'), "[Logo] Corp")

    def test_image_without_alt_contributes_nothing(self):
        self.assertEqual(html_to_text('<p>Body <img src="pixel.gif"></p>'), "Body")


class Wrapping(unittest.TestCase):
    """Long prose is folded to a width a terminal can read without folding it twice."""

    def test_prose_is_wrapped_to_the_width(self):
        text = html_to_text("<p>" + "word " * 60 + "</p>", width=40)
        self.assertTrue(all(len(line) <= 40 for line in text.split("\n")))
        self.assertGreater(len(text.split("\n")), 1)

    def test_default_width_is_used(self):
        text = html_to_text("<p>" + "word " * 100 + "</p>")
        self.assertTrue(all(len(line) <= DEFAULT_WIDTH for line in text.split("\n")))

    def test_quote_prefix_counts_towards_the_width(self):
        text = html_to_text("<blockquote><p>" + "word " * 60 + "</p></blockquote>", width=40)
        self.assertTrue(all(len(line) <= 40 for line in text.split("\n")))

    def test_hard_breaks_are_not_joined_by_wrapping(self):
        self.assertEqual(html_to_text("<p>Short<br>Also short</p>", width=72), "Short\nAlso short")


class Flowed(unittest.TestCase):
    """RFC 3676: a soft break says "I wrapped this, feel free to unwrap it"; a fixed line says
    "this break is mine"."""

    def test_soft_breaks_end_with_a_space(self):
        lines = html_to_text("<p>" + "word " * 40 + "</p>", width=40, flowed=True).split("\n")
        self.assertTrue(all(line.endswith(" ") for line in lines[:-1]))
        self.assertFalse(lines[-1].endswith(" "))

    def test_hard_breaks_stay_fixed(self):
        text = html_to_text("<p>One<br>Two</p>", width=40, flowed=True)
        self.assertEqual(text, "One\nTwo")

    def test_paragraph_end_is_fixed(self):
        text = html_to_text("<p>One</p><p>Two</p>", width=40, flowed=True)
        self.assertEqual(text, "One\n\nTwo")

    def test_list_items_are_never_flowed(self):
        text = html_to_text("<ul><li>" + "word " * 30 + "</li></ul>", width=40, flowed=True)
        self.assertTrue(all(not line.endswith(" ") for line in text.split("\n")))

    def test_preformatted_lines_are_never_flowed(self):
        text = html_to_text("<pre>code   \nmore</pre>", width=40, flowed=True)
        self.assertTrue(all(not line.endswith(" ") for line in text.split("\n")))

    def test_quoted_prose_is_flowed(self):
        lines = html_to_text(
            "<blockquote><p>" + "word " * 40 + "</p></blockquote>", width=40, flowed=True
        ).split("\n")
        self.assertTrue(all(line.startswith("> ") for line in lines))
        self.assertTrue(all(line.endswith(" ") for line in lines[:-1]))

    def test_line_starting_with_a_space_is_stuffed(self):
        # <pre> is the only way to open a line with a space; unstuffed, the reader eats it.
        self.assertEqual(html_to_text("<pre>  indented</pre>", flowed=True), "   indented")

    def test_line_starting_with_a_quote_character_is_stuffed(self):
        self.assertEqual(html_to_text("<pre>&gt; not a quote</pre>", flowed=True), " > not a quote")

    def test_from_line_is_stuffed(self):
        self.assertEqual(html_to_text("<p>From here on</p>", flowed=True), " From here on")

    def test_stuffing_is_only_for_flowed(self):
        self.assertEqual(html_to_text("<p>From here on</p>", flowed=False), "From here on")

    def test_blank_line_is_never_a_soft_break(self):
        text = html_to_text("<p>One</p><p>Two</p>", flowed=True)
        self.assertEqual(text.split("\n")[1], "")

    def test_signature_separator_keeps_its_trailing_space(self):
        # RFC 3676 4.3, the one fixed line that ends in a space on purpose.
        text = html_to_text("<div>Bye</div><div>-- </div><div>Alex</div>", flowed=True)
        self.assertEqual(text, "Bye\n-- \nAlex")


class RoundTrip(unittest.TestCase):
    """The receiving half of format=flowed, run against our own output: unwrapping a flowed body
    the way RFC 3676 §4.2 says to must give back the paragraph that went in."""

    @staticmethod
    def unflow(text: str) -> list[str]:
        paragraphs: list[str] = []
        pending = ""

        for line in text.split("\n"):
            depth = len(line) - len(line.lstrip(">"))
            content = line[depth:]
            if content.startswith(" "):
                content = content[1:]

            pending += content
            if not content.endswith(" "):
                paragraphs.append(">" * depth + pending)
                pending = ""

        if pending:
            paragraphs.append(pending)

        return paragraphs

    def test_wrapped_prose_reassembles(self):
        sentence = "The quick brown fox jumps over the lazy dog and keeps on running."
        flowed = html_to_text("<p>" + sentence + "</p>", width=30, flowed=True)
        self.assertGreater(len(flowed.split("\n")), 1)
        self.assertEqual(self.unflow(flowed), [sentence])

    def test_quoted_prose_reassembles_with_its_depth(self):
        sentence = "The quick brown fox jumps over the lazy dog and keeps on running."
        flowed = html_to_text("<blockquote><p>" + sentence + "</p></blockquote>", width=30, flowed=True)
        self.assertEqual(self.unflow(flowed), [">" + sentence])

    def test_stuffed_leading_space_survives(self):
        flowed = html_to_text("<pre>  indented</pre>", flowed=True)
        self.assertEqual(self.unflow(flowed), ["  indented"])


class ComposedBody(unittest.TestCase):
    """The whole point, end to end: what the composer actually writes, as aerc would show it."""

    HTML = (
        "<div>Hi Team,</div>"
        "<div><br></div>"
        '<div>Please review <a href="https://example.com/docs/spec">the spec page</a> '
        "and mail me at support@example.com.</div>"
        "<div><br></div>"
        "<ul><li>First item</li><li>Second item</li></ul>"
        "<div><br></div>"
        "<div>Regards,</div>"
        "<div>Alex</div>"
    )

    def test_reads_as_written(self):
        self.assertEqual(
            html_to_text(self.HTML),
            "Hi Team,\n"
            "\n"
            "Please review the spec page <https://example.com/docs/spec> and mail me\n"
            "at support@example.com.\n"
            "\n"
            "- First item\n"
            "- Second item\n"
            "\n"
            "Regards,\n"
            "Alex",
        )

    def test_address_is_not_split_by_punctuation(self):
        # The bug in convert_html_to_text: the "." before a word gained a space, so every
        # address and URL path in the body was broken.
        self.assertIn("support@example.com", html_to_text(self.HTML))

    def test_link_destination_survives(self):
        self.assertIn("<https://example.com/docs/spec>", html_to_text(self.HTML))


if __name__ == "__main__":
    unittest.main()


class ToFlowed(unittest.TestCase):
    """Ready-made text re-encoded as format=flowed. Every line comes out fixed, so the breaks
    the sender chose are the breaks the reader sees."""

    def test_empty(self):
        self.assertEqual(to_flowed(None), "")
        self.assertEqual(to_flowed(""), "")

    def test_plain_lines_are_unchanged(self):
        self.assertEqual(to_flowed("One\nTwo"), "One\nTwo")

    def test_no_line_ends_with_a_space(self):
        # A trailing space would be read as a soft break and join the two lines.
        self.assertEqual(to_flowed("One   \nTwo"), "One\nTwo")

    def test_leading_space_is_stuffed(self):
        self.assertEqual(to_flowed("  indented"), "   indented")

    def test_from_line_is_stuffed(self):
        self.assertEqual(to_flowed("From here on"), " From here on")

    def test_quote_marker_is_left_alone(self):
        # In text written as text a leading `>` is a real quote, not content to protect.
        self.assertEqual(to_flowed("> quoted"), "> quoted")

    def test_signature_separator_keeps_its_trailing_space(self):
        self.assertEqual(to_flowed("Bye\n-- \nAlex"), "Bye\n-- \nAlex")

    def test_blank_lines_survive(self):
        self.assertEqual(to_flowed("One\n\nTwo"), "One\n\nTwo")

    def test_output_is_valid_flowed(self):
        # The property that matters: nothing the caller wrote can be mistaken for a soft break.
        text = to_flowed("Para one   \n\n  indented\nFrom X\n-- \nSig")
        soft = [line for line in text.split("\n") if line.endswith(" ")]
        self.assertEqual(soft, ["-- "])


class Signature(unittest.TestCase):
    """The composer marks the signature it inserts, so the text part can carry the separator a
    reader looks for. RFC 3676 4.3: exactly "-- ", trailing space included."""

    SIG = (
        "<div>Regards,</div><div>Alex</div><div><br></div>"
        '<div class="frappe_mail_signature"><div>Alex Smith</div>'
        '<div><a href="mailto:alex@example.com">alex@example.com</a></div></div>'
    )

    def test_separator_precedes_the_signature(self):
        self.assertEqual(
            html_to_text(self.SIG),
            "Regards,\nAlex\n\n-- \nAlex Smith\nalex@example.com",
        )

    def test_separator_keeps_its_trailing_space(self):
        self.assertIn("\n-- \n", html_to_text(self.SIG))

    def test_separator_survives_flowed(self):
        # It is the one fixed line allowed to end in a space, so it must not be trimmed.
        self.assertIn("\n-- \n", html_to_text(self.SIG, flowed=True))

    def test_signature_is_never_a_soft_break(self):
        lines = html_to_text(self.SIG, flowed=True).splitlines()
        self.assertEqual([line for line in lines if line.endswith(" ")], ["-- "])

    def test_unmarked_body_gets_no_separator(self):
        self.assertNotIn("--", html_to_text("<div>Regards,</div><div>Alex</div>"))

    def test_empty_signature_block_is_skipped(self):
        # Nothing to introduce, so the separator would only mislead.
        self.assertEqual(html_to_text('<div>Body</div><div class="frappe_mail_signature"></div>'), "Body")

    def test_class_is_matched_among_others(self):
        html = '<div>Body</div><div class="foo frappe_mail_signature"><div>Alex</div></div>'
        self.assertEqual(html_to_text(html), "Body\n\n-- \nAlex")

    def test_signature_sits_on_the_line_below_the_separator(self):
        self.assertNotIn("-- \n\n", html_to_text(self.SIG))
