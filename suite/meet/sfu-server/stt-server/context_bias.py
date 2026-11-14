"""Bounded per-utterance phrase hints for Meet's shared multilingual decoder."""

import unicodedata

try:
    from speech_context import (
        LEGACY_VERSION,
        MAX_NAME_LENGTH,
        MAX_NAMES,
        make_hints,
        validate_names,
        vocabulary,
    )
except ModuleNotFoundError:
    from suite.meet.speech_context import (
        LEGACY_VERSION,
        MAX_NAME_LENGTH,
        MAX_NAMES,
        make_hints,
        validate_names,
        vocabulary,
    )

FRAPPE_TERMS = vocabulary(LEGACY_VERSION)


def name_hint_phrases(names):
    """Hint each name part independently, without encouraging surname completion."""
    phrases = []
    seen = set()
    for name in names:
        for part in name.split():
            key = part.casefold()
            if key not in seen:
                seen.add(key)
                phrases.append(part)
    return phrases


class UtteranceBias:
    """One hypothesis and GPU model id per utterance; never reconfigure the shared decoder."""

    def __init__(self, model, names, alpha=0.35, *, context=None):
        self.model = model
        self.names = tuple(validate_names(names))
        self.context = context or {"vocabulary_version": LEGACY_VERSION, "title": ""}
        self.phrases = (
            *vocabulary(self.context["vocabulary_version"]),
            *name_hint_phrases(self.names),
            *([self.context["title"]] if self.context["title"] else []),
        )
        self.alpha = alpha
        self.request = None

    def initial_hypotheses(self):
        from nemo.collections.asr.parts.context_biasing import BoostingTreeModelConfig
        from nemo.collections.asr.parts.context_biasing.biasing_multi_model import BiasingRequestItemConfig
        from nemo.collections.asr.parts.utils.rnnt_utils import Hypothesis

        request = BiasingRequestItemConfig(
            boosting_model_cfg=BoostingTreeModelConfig(key_phrases_list=list(self.phrases)),
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
