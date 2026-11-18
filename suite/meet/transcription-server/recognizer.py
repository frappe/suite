"""Pinned original-language inference behind the worker's text-only interface."""

import copy
import gzip
import math
from pathlib import Path

from protocol import CONFIGURATION, MODEL, REVISION, WorkError, hint_phrases, make_hints


def repetition_fraction(text):
    """Share of words covered by a short phrase repeated at least three times."""
    words = text.casefold().split()
    covered = set()
    for width in range(1, 5):
        for start in range(len(words) - width * 3 + 1):
            phrase = words[start : start + width]
            end = start + width
            while words[end : end + width] == phrase:
                end += width
            if end - start >= max(4, 3 * width):
                covered.update(range(start, end))
    return len(covered) / len(words) if words else 0.0


def segment_decision(no_speech_probability, average_logprob, compression_ratio, repeated_fraction=0.0):
    """Conservative, model-independent rejection; never rewrite uncertain speech."""
    if not all(
        math.isfinite(value)
        for value in (no_speech_probability, average_logprob, compression_ratio, repeated_fraction)
    ):
        return False, "invalid_signals"
    if (
        compression_ratio > CONFIGURATION["compression_ratio_threshold"]
        or repeated_fraction >= CONFIGURATION["repetition_fraction_threshold"]
    ):
        return False, "repetition"
    if (
        no_speech_probability > CONFIGURATION["no_speech_threshold"]
        and average_logprob < CONFIGURATION["logprob_threshold"]
    ):
        return False, "no_speech"
    if average_logprob < CONFIGURATION["hallucination_logprob_threshold"]:
        return False, "low_probability"
    return True, "keep"


class TrelisRecognizer:
    def __init__(self, cache: str, *, allocator_gib=7, metrics=None):
        self.metrics = metrics
        import torch
        from huggingface_hub import snapshot_download
        from transformers import WhisperForConditionalGeneration, WhisperProcessor

        if not torch.cuda.is_available():
            raise WorkError("gpu_unavailable")
        total = torch.cuda.get_device_properties(0).total_memory
        if not math.isfinite(allocator_gib) or not 0 < allocator_gib * 1024**3 < total:
            raise WorkError("invalid_allocator_limit")
        torch.set_num_threads(1)
        torch.cuda.set_per_process_memory_fraction(allocator_gib * 1024**3 / total)
        self.path = snapshot_download(
            MODEL,
            revision=REVISION,
            cache_dir=str(Path(cache)),
            allow_patterns=["*.safetensors", "*.json", "*.txt"],
            max_workers=2,
            token=False,
        )
        self.processor = WhisperProcessor.from_pretrained(
            self.path, local_files_only=True, trust_remote_code=False
        )
        self.model = WhisperForConditionalGeneration.from_pretrained(
            self.path,
            local_files_only=True,
            trust_remote_code=False,
            dtype=torch.float16,
            device_map={"": "cuda:0"},
            attn_implementation="sdpa",
        ).eval()
        tokenizer = self.processor.tokenizer
        marker = tokenizer("<|mixedcode|>", add_special_tokens=False).input_ids
        if (
            marker != [CONFIGURATION["mixedcode_token_id"]]
            or marker[0] not in tokenizer.all_special_ids
            or tokenizer.decode(marker) != "<|mixedcode|>"
            or self.model.config.max_target_positions < 445
        ):
            raise WorkError("processor_configuration_invalid")
        if not all(torch.isfinite(p).all().item() for p in self.model.parameters()):
            raise WorkError("nonfinite_model_weights")
        self.torch = torch

    def transcribe(self, pcm: bytes, sample_rate: int, *, hints=None, speaker_name="") -> str:
        # Whisper's feature extractor otherwise silently truncates long input.
        if sample_rate != 24000 or not pcm or len(pcm) % 2 or len(pcm) > 30 * 24000 * 2:
            raise WorkError("unsupported_source_format")
        if not any(pcm):
            return ""
        import numpy as np
        import torchaudio.functional

        torch = self.torch
        waveform = torch.from_numpy(np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768)
        waveform = torchaudio.functional.resample(waveform, sample_rate, 16000)
        inputs = self.processor(
            waveform.numpy(), sampling_rate=16000, return_tensors="pt", return_attention_mask=True
        ).to(self.model.device, dtype=self.model.dtype)
        generation = copy.deepcopy(self.model.generation_config)
        generation.language = None
        generation.task = "transcribe"
        generation.forced_decoder_ids = None
        generation.condition_on_prev_tokens = False
        with torch.inference_mode():
            language = int(
                self.model.detect_language(
                    input_features=inputs.input_features, generation_config=generation
                )[0]
            )
        tokenizer = self.processor.tokenizer
        language_token = tokenizer.convert_ids_to_tokens(language)
        if language_token not in generation.lang_to_id:
            raise WorkError("invalid_language_output")
        prefix = [
            tokenizer.convert_tokens_to_ids("<|startoftranscript|>"),
            language,
            CONFIGURATION["mixedcode_token_id"],
            tokenizer.convert_tokens_to_ids("<|transcribe|>"),
            tokenizer.convert_tokens_to_ids("<|notimestamps|>"),
        ]
        selected = []
        prompt_ids = []
        for phrase in hint_phrases(hints if hints is not None else make_hints("", []), speaker_name):
            proposed = tokenizer.get_prompt_ids(", ".join([*selected, phrase])).tolist()
            if len(proposed) <= CONFIGURATION["max_hint_tokens"]:
                selected.append(phrase)
                prompt_ids = proposed
        prefix = [*prompt_ids, *prefix]
        generation.language = language_token
        generation.num_beams = CONFIGURATION["num_beams"]
        generation.do_sample = CONFIGURATION["do_sample"]
        generation.temperature = 0.0
        generation.max_new_tokens = min(
            CONFIGURATION["max_new_tokens"], self.model.config.max_target_positions - len(prefix)
        )
        # Decide once below: Transformers' threshold handling can retry decoding
        # with temperature fallback and uses a different prefix position.
        for key in ("logprob_threshold", "compression_ratio_threshold", "no_speech_threshold"):
            setattr(generation, key, None)
        with torch.inference_mode():
            # <|nospeech|> is predicted after SOT, before language/mixedcode/task.
            # Prompt hints precede SOT. Generation scores suppress this token, so
            # read the unsuppressed first-step output scores explicitly.
            first = self.model(
                input_features=inputs.input_features,
                decoder_input_ids=torch.tensor([prefix[: len(prompt_ids) + 1]], device=self.model.device),
            )
            no_speech = float(
                first.logits[0, -1].float().softmax(-1)[tokenizer.convert_tokens_to_ids("<|nospeech|>")]
            )
            del first
            output = self.model.generate(
                **inputs,
                generation_config=generation,
                decoder_input_ids=torch.tensor([prefix], device=self.model.device),
                return_timestamps=False,
                return_dict_in_generate=True,
                output_scores=True,
                force_unique_generate_call=True,
                condition_on_prev_tokens=False,
            )
        tokens = output.sequences[0]
        if tokens[: len(prefix)].tolist() != prefix:
            raise WorkError("decoder_prefix_changed")
        generated = tokens[len(prefix) :]
        eos = self.model.generation_config.eos_token_id
        eos = eos if isinstance(eos, list) else [eos]
        if not len(generated):
            raise WorkError("decoder_output_truncated", transient=True)
        result = tokenizer.decode(generated, skip_special_tokens=True)
        if not isinstance(result, str) or "\x00" in result:
            raise WorkError("invalid_model_output")
        scores = torch.stack(output.scores, dim=1).float().log_softmax(-1)
        average_logprob = float(scores[0].gather(1, generated[:, None]).mean())
        encoded = result.encode("utf-8")
        ratio = len(encoded) / len(gzip.compress(encoded))
        keep, reason = segment_decision(no_speech, average_logprob, ratio, repetition_fraction(result))
        if keep and int(generated[-1]) not in eos:
            # Repetition may exhaust the token budget. Filter it, but never
            # checkpoint a truncated result that otherwise looks like speech.
            raise WorkError("decoder_output_truncated", transient=True)
        if not keep and self.metrics is not None:
            self.metrics.add("segments_dropped_total", 1)
            self.metrics.add(f"segments_dropped_{reason}_total", 1)
        return result if keep else ""

    def memory(self) -> dict:
        return {
            "gpu_allocated_bytes": self.torch.cuda.memory_allocated(),
            "gpu_reserved_bytes": self.torch.cuda.memory_reserved(),
        }
