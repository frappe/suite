"""Meet response shapes used by the generated API references."""

from typing import Literal, NotRequired, TypedDict


class Preview(TypedDict):
    title: str


class Access(TypedDict):
    allow_guest: bool
    host_only_chat: NotRequired[bool]


class PresenceToken(TypedDict, total=False):
    restricted_preview: bool
    auth_token: str
    sfu_url: str
    sfu_port: int | None
    expires_in: int


RecordingStatus = Literal[
    "Pending",
    "Starting",
    "Recording",
    "Interrupted",
    "Stopping",
    "Processing",
    "Ready",
    "Partial",
    "Failed",
    "Cancelled",
]


class RecordingState(TypedDict):
    name: str
    status: RecordingStatus
    state_revision: int
    started_at: NotRequired[str | None]
    capture_started_at: NotRequired[str | None]
    interruption_id: NotRequired[str | None]
    interrupted_at: NotRequired[str | None]
    interruption_deadline: NotRequired[str | None]


class RecordingCommand(TypedDict):
    name: str
    status: RecordingStatus
    grant_delivered: NotRequired[bool]


class RecordingSummary(TypedDict):
    name: str
    meet_room: str
    room_title: str | None
    started_at: str | None
    artifact: str
    artifact_duration: float | None
    status: Literal["Ready", "Partial"]


class RecentRoom(TypedDict):
    id: str
    title: str | None
    last_joined: str
    recording: str | None


class RejectedRecording(TypedDict):
    status: Literal["Rejected"]


class RecordingPreflight(TypedDict):
    eligible: bool
    global_enabled: bool
    e2ee_conflict: bool
    storage_available: bool
    recorder_available: bool
    estimated_seconds: int
    estimated_bytes: int
    free_bytes: int
    budget_bytes: int
    budget_seconds: int
    maximum_seconds: int


Flag = bool | Literal[0, 1]


class RoomUser(TypedDict):
    user: str


class RoomDocument(TypedDict):
    name: str
    owner: str
    title: str | None
    co_hosts: list[RoomUser]
    allow_guest: Flag
    meeting_type: Literal["open", "restricted"]
    host_only_chat: Flag
    e2ee_enabled: Flag


class UserCommand(TypedDict):
    user_id: str


class GuestCommand(TypedDict):
    guest_id: str


class SettingsCommand(TypedDict, total=False):
    allow_guest: Flag
    meeting_type: Literal["open", "restricted"]
    host_only_chat: Flag


class SettingsResult(TypedDict, total=False):
    allow_guest: bool
    meeting_type: Literal["open", "restricted"]
    host_only_chat: bool


class CommandResult(TypedDict):
    meeting_id: str
    message: str
    user_id: NotRequired[str]


class BanResult(TypedDict):
    meeting_id: str
    guest_id: str
    status: Literal["banned"]


class WaitingUser(TypedDict):
    user_id: str
    full_name: str
    user_name: str
    user_image: str | None
    is_guest: bool


class WaitingRoom(TypedDict):
    meeting_id: str
    waiting_users: list[WaitingUser]
