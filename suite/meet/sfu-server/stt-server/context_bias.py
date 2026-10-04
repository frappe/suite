"""Bounded per-utterance phrase hints for Meet's shared multilingual decoder."""

import unicodedata

# Product vocabulary, not transcript corrections. Keep short common words out.
FRAPPE_TERMS = (
    "Frappe",
    "ERPNext",
    "DocType",
    "Frappe Cloud",
    "Frappe Framework",
    "Frappe HR",
    "Frappe CRM",
    "Frappe Helpdesk",
    "Frappe Books",
    "Frappe Drive",
    "Frappe Insights",
    "Frappe Builder",
    "Frappe Learning",
    "Frappe Wiki",
    "Frappe Mail",
    "Frappe Meet",
    "Frappe Studio",
    "Frappe Payments",
    "Frappe Gameplan",
    "Frappe Bench",
    "Frappe UI",
    "Frappe Desk",
    "Frappe Sheets",
    "Frappe Press",
    "Frappe LMS",
    "Frappe Education",
    "frappe-ui",
    "Frappe Workflow",
    "Frappe DocType",
    "Child Table",
    "Client Script",
    "Server Script",
    "Print Format",
    "Web Form",
    "Frappe Workspace",
)
MAX_NAMES = 20
MAX_NAME_LENGTH = 80


def validate_names(names):
    if not isinstance(names, list) or len(names) > MAX_NAMES:
        raise ValueError("transcription.names must be an array of at most 20 names")
    result = []
    seen = set()
    for name in names:
        if not isinstance(name, str):
            raise ValueError("transcription.names must contain strings")
        name = unicodedata.normalize("NFKC", name).strip()
        if not name or len(name) > MAX_NAME_LENGTH or any(unicodedata.category(c)[0] == "C" for c in name):
            raise ValueError("transcription.names contains an invalid name")
        key = name.casefold()
        if key not in seen:
            seen.add(key)
            result.append(name)
    return result


class UtteranceBias:
    """One hypothesis and GPU model id per utterance; never reconfigure the shared decoder."""

    def __init__(self, model, names, alpha=1.5):
        self.model = model
        self.names = tuple(validate_names(names))
        self.alpha = alpha
        self.request = None

    def initial_hypotheses(self):
        if not self.names:
            return None
        from nemo.collections.asr.parts.context_biasing import BoostingTreeModelConfig
        from nemo.collections.asr.parts.context_biasing.biasing_multi_model import BiasingRequestItemConfig
        from nemo.collections.asr.parts.utils.rnnt_utils import Hypothesis

        # Speakers often address a participant by given name rather than the
        # full display name shown in the Meet Room.
        spoken_names = [part for name in self.names for part in (name, name.split()[0])]
        phrases = list(dict.fromkeys(spoken_names))
        request = BiasingRequestItemConfig(
            boosting_model_cfg=BoostingTreeModelConfig(key_phrases_list=phrases),
            boosting_model_alpha=self.alpha,
            auto_manage_multi_model=False,
        )
        self.request = request
        request.add_to_multi_model(
            self.model.tokenizer,
            self.model.decoding.decoding.decoding_computer.biasing_multi_model,
        )
        return [Hypothesis.empty_with_biasing_cfg(request)]

    def release(self):
        if self.request is not None:
            try:
                self.request.remove_from_multi_model(
                    self.model.decoding.decoding.decoding_computer.biasing_multi_model
                )
            finally:
                self.request = None
