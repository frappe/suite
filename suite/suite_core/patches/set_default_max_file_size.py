from suite.suite_core.file_size import set_default_max_file_size


def execute() -> None:
    """Existing sites get the 1 GB limit a new install sets, unless they chose their own."""
    set_default_max_file_size()
