from frappe.model.document import Document


class MeetTranscriptionJob(Document):
    """Internal durable queue state; never a participant-facing pending artifact."""
