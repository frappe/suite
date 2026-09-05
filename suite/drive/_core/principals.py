"""Identity values consumed by the Drive permission engine."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Principals:
    """The identity principals and explicitly presented open principals of a caller."""

    user: str
    own: tuple[str, ...]
    open: tuple[str, ...]
    is_admin: bool = False

    def all(self) -> tuple[str, ...]:
        """Return principals in their structural own/open order."""
        return self.own + self.open
