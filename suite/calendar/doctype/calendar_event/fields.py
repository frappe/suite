"""The fields a caller can set on a calendar event, validated before they reach the JMAP server.

Enumerations take any case, as the app's forms send "Busy" where JSCalendar says "busy", and
come out the way the service layer expects them. Participants, locations and links are passed
through as they are: their shapes differ between the form and the stored event.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, Field

from suite.utils.validation import loads_if_str


def _title(value: Any) -> Any:
    return value.title() if isinstance(value, str) else value


def _lower(value: Any) -> Any:
    return value.lower() if isinstance(value, str) else value


def _upper(value: Any) -> Any:
    return value.upper() if isinstance(value, str) else value


def _blank_as_none(value: Any) -> Any:
    # A stored event reports an unset privacy or free/busy status as "".
    return value or None


def _rule(value: Any) -> Any:
    # The stored event carries its rule as the JSON string the formatter emits.
    return loads_if_str(value) or None


Title = BeforeValidator(_title)
Lower = BeforeValidator(_lower)


class OffsetAlert(BaseModel):
    type: Literal["OffsetTrigger"]
    uid: str | None = None
    action: Annotated[Literal["display", "email", "audio"], Lower]
    offset: Annotated[str, BeforeValidator(_upper)]
    relative_to: Annotated[Literal["start", "end"], Lower] = "start"


class AbsoluteAlert(BaseModel):
    type: Literal["AbsoluteTrigger"]
    uid: str | None = None
    action: Annotated[Literal["display", "email", "audio"], Lower]
    when: str


Alert = Annotated[OffsetAlert | AbsoluteAlert, Field(discriminator="type")]
KNOWN_TRIGGERS = ("OffsetTrigger", "AbsoluteTrigger")


class EventFields(BaseModel):
    """An event's settable fields. Parse a partial edit and read it back with `exclude_unset`."""

    organizer: str | None = None
    calendar_ids: list[str] | None = None
    status: Annotated[Literal["Tentative", "Confirmed", "Cancelled"], Title] = "Confirmed"
    draft: bool = False
    title: str | None = None
    start: str | None = None
    duration: str | None = None
    time_zone: str | None = None
    recurrence_rule: Annotated[dict | None, BeforeValidator(_rule)] = None
    show_without_time: bool = False
    privacy: Annotated[
        Literal["Public", "Private", "Secret"] | None, BeforeValidator(_blank_as_none), Title
    ] = None
    free_busy_status: Annotated[Literal["Free", "Busy"] | None, BeforeValidator(_blank_as_none), Title] = None
    description: str | None = None
    locations: list[dict] | None = None
    links: list[dict] | None = None
    participants: list[dict] | None = None
    alerts: list[Alert] | None = None
    use_default_alerts: bool = False

    def for_service(self) -> dict:
        """The fields as CalendarEventService.create/update read them."""

        event = self.model_dump(exclude={"draft"})
        event.update(
            is_draft=self.draft,
            status=self.status.lower(),
            privacy=_lower(self.privacy),
            free_busy_status=_lower(self.free_busy_status),
        )
        return event
