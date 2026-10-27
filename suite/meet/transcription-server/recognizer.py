"""Pinned original-language inference behind the worker's text-only interface."""

import copy
import math
from pathlib import Path

from protocol import CONFIGURATION, MODEL, REVISION, WorkError, hint_phrases, make_hints


class TrelisRecognizer:
    def __init__(self, cache: str, *, allocator_gib=7):
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
        for key in ("logprob_threshold", "compression_ratio_threshold", "no_speech_threshold"):
            setattr(generation, key, None)
        with torch.inference_mode():
            output = self.model.generate(
                **inputs,
                generation_config=generation,
                decoder_input_ids=torch.tensor([prefix], device=self.model.device),
                return_timestamps=False,
                return_dict_in_generate=True,
                force_unique_generate_call=True,
                condition_on_prev_tokens=False,
            )
        tokens = output.sequences[0]
        if tokens[: len(prefix)].tolist() != prefix:
            raise WorkError("decoder_prefix_changed")
        generated = tokens[len(prefix) :]
        eos = self.model.generation_config.eos_token_id
        eos = eos if isinstance(eos, list) else [eos]
        if not len(generated) or int(generated[-1]) not in eos:
            # Token exhaustion cannot become a successful source checkpoint.
            raise WorkError("decoder_output_truncated", transient=True)
        result = tokenizer.decode(generated, skip_special_tokens=True)
        if not isinstance(result, str) or "\x00" in result:
            raise WorkError("invalid_model_output")
        return result

    def memory(self) -> dict:
        return {
            "gpu_allocated_bytes": self.torch.cuda.memory_allocated(),
            "gpu_reserved_bytes": self.torch.cuda.memory_reserved(),
        }
