from suite.mail.storage import destroy_data_store


def execute() -> None:
	"""Destroy the on-disk data store so it is rebuilt lazily from JMAP on next access."""

	destroy_data_store()
