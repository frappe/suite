"""What other Suite modules may ask of Writer."""

__version__ = "0.0.1"


def create_document(parent: str, title: str, html: str) -> str:
    """Create a Writer document in the Drive folder `parent`, start it from `html`, and return its node.

    `html` holds only what the editor declares (`suite.writer.content.seed`).
    The session user must be able to add to `parent`. Writer collaboration must
    be on; without it this raises RuntimeError.
    """
    # Local: Writer's own DocTypes import this package, so it loads nothing from Drive up front.
    from suite import drive
    from suite.writer.content.seed import fill

    node = drive.create_document(parent, title, content_doctype="Writer Document")
    fill(node, html)
    return node
