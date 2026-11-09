"""What other Suite modules may ask of Writer."""

__version__ = "0.0.1"


def fill_new_document(node: str, html: str) -> None:
    """Start a Writer document that was just created from `html`.

    `html` holds only what the editor declares (`suite.writer.content.seed`).
    The session user must be able to edit `node`. Writer collaboration must be
    on; without it this raises RuntimeError.
    """
    from suite import drive
    from suite.writer.content.seed import fill

    drive.check(node, drive.EDIT)
    fill(node, html)
