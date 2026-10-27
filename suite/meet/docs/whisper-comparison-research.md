# Whisper comparison research

2026-10-19. Protocol support for a matched comparison against the [completed Cohere pilot](transcription-pilot-results.md). This note contains source findings and proposed controls, not measured Whisper results. No production changes or model inference were performed as part of this research.

## Candidates and download budget

Use OpenAI's `medium.en`, `large-v3`, and `large-v3-turbo` checkpoints. They cover an English-only model, the full large model, and its faster pruned derivative. Optionally add `small.en` if a smaller worker footprint becomes a selection criterion. Turbo has four decoder layers versus large-v3's 32; its quality/speed trade-off must be measured on our inputs rather than inferred from its name. [OpenAI's turbo model card](https://huggingface.co/openai/whisper-large-v3-turbo)

Public Hugging Face model/tree APIs were queried on the date above. Pins and exact single-file safetensors sizes:

| Official repository | Revision | `model.safetensors` bytes |
| --- | --- | ---: |
| `openai/whisper-medium.en` | `2e98eb6279edf5095af0c8dedb36bdec0acd172b` | 3,055,540,208 |
| `openai/whisper-large-v3` | `06f233fe06e710322aca913c1bc4249a0d71fce1` | 3,087,130,976 |
| `openai/whisper-large-v3-turbo` | `41f01f3fe87f28c78e2fbf8b568835947dd65ed9` | 1,617,824,864 |
| `openai/whisper-small.en` (optional) | `e8727524f962ee844a7319d92be39ac1bd25655a` | 966,992,008 |

Sources: official repository APIs for [medium.en](https://huggingface.co/api/models/openai/whisper-medium.en?blobs=true), [large-v3](https://huggingface.co/api/models/openai/whisper-large-v3?blobs=true), [turbo](https://huggingface.co/api/models/openai/whisper-large-v3-turbo?blobs=true), and [small.en](https://huggingface.co/api/models/openai/whisper-small.en?blobs=true). These API main revisions can change; use the recorded pins for downloads.

The three primary weight files total about 7.23 GiB before tokenizer/configuration files and temporary download space. With the pilot's reported 8.3 GiB free root disk, download and run sequentially, preserving results before removing only the new checkpoint cache. Exclude duplicate `.bin`, FP32 shards, other runtime formats, and training files. In particular, large-v3 also publishes approximately 6.17 GB of FP32 safetensors shards; the single `model.safetensors` is sufficient for the proposed FP16 run. [Pinned large-v3 tree](https://huggingface.co/openai/whisper-large-v3/tree/06f233fe06e710322aca913c1bc4249a0d71fce1)

Use an explicit file allowlist: `model.safetensors`, `config.json`, `generation_config.json`, `preprocessor_config.json`, `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json`, `added_tokens.json`, `normalizer.json`, `merges.txt`, and `vocab.json`. Fetch all from the same model revision. [Pinned medium.en tree](https://huggingface.co/openai/whisper-medium.en/tree/2e98eb6279edf5095af0c8dedb36bdec0acd172b)

## Runtime and memory

Prefer native Transformers in the existing isolated pilot image, with explicit FP16 loading and one candidate resident at a time. This keeps Torch/Transformers and the measurement envelope aligned with Cohere. Turing supports FP16 Tensor Core matrix multiplication; actual kernels and memory still require smoke testing on this image. [NVIDIA Turing guide](https://docs.nvidia.com/cuda/turing-tuning-guide/index.html#tensor-core-operations)

OpenAI lists approximate VRAM of 2 GB for small, 5 GB for medium, 10 GB for large, and 6 GB for turbo. These are reference estimates, not bounds for Transformers or this workload. Its relative speed figures were measured on an A100 and should not predict T4 performance. Large-v3 may hit the pilot's safety budget; do not relax production safeguards to force completion. [OpenAI README](https://github.com/openai/whisper#available-models-and-languages)

The English medium checkpoint's configuration declares FP32, whereas large-v3/turbo declare FP16. Explicit FP16 loading avoids inheriting the medium default. Disk bytes do not predict total inference VRAM. [Pinned medium configuration](https://huggingface.co/openai/whisper-medium.en/blob/2e98eb6279edf5095af0c8dedb36bdec0acd172b/config.json), [pinned large configuration](https://huggingface.co/openai/whisper-large-v3/blob/06f233fe06e710322aca913c1bc4249a0d71fce1/config.json)

## Primary comparison controls

Reuse the frozen 60 AMI clips, 785 reference words, source hashes and scoring policy. Batch size one, independent clips, no roster/context prompt, no quantization, and the same 256-new-token cap as Cohere. Measure first pass and warm repeat separately, loading separately, preprocessing/transfer/generation with CUDA synchronization, allocator peaks, sampled whole-device usage, and production health. Verify EOS and disclose capped/failed clips rather than silently scoring incomplete runs as complete.

Use each checkpoint's own processor: medium.en requires 80 mel bins and large-v3/turbo 128, all at 16 kHz. Preserve its published suppression tokens and initial-blank suppression, since token IDs differ. English-only medium.en has `is_multilingual=false`; omit language/task arguments there. For multilingual models explicitly select English transcription. [Medium processor config](https://huggingface.co/openai/whisper-medium.en/blob/2e98eb6279edf5095af0c8dedb36bdec0acd172b/preprocessor_config.json), [large processor config](https://huggingface.co/openai/whisper-large-v3/blob/06f233fe06e710322aca913c1bc4249a0d71fce1/preprocessor_config.json), [medium generation config](https://huggingface.co/openai/whisper-medium.en/blob/2e98eb6279edf5095af0c8dedb36bdec0acd172b/generation_config.json), [Transformers generation source](https://github.com/huggingface/transformers/blob/main/src/transformers/models/whisper/generation_whisper.py)

Set `num_beams=1`, `do_sample=False`, `return_timestamps=False`, and `condition_on_prev_tokens=False`. Disable temperature fallback, compression/logprob retry heuristics and no-speech skipping explicitly for the controlled short-form greedy run. Keep the checkpoint's ordinary token suppression, and export effective generation settings. This is a comparison of defined decoding configurations, not a claim about every model's best achievable accuracy. [Transformers Whisper generation documentation](https://huggingface.co/docs/transformers/model_doc/whisper#transformers.WhisperForConditionalGeneration.generate)

## Quality-oriented follow-up and confounds

OpenAI's `transcribe()` defaults include temperature fallback `(0, .2, .4, .6, .8, 1)`, compression threshold 2.4, average-logprob threshold -1, no-speech threshold .6, and previous-text conditioning. The CLI additionally exposes beam search. These differ from a single greedy decode. If a candidate performs poorly, separately evaluate an explicitly named quality configuration; preserve the original result rather than replacing it. No-speech skipping interacts with logprob, so it cannot be interpreted as a standalone .6 cutoff. [Official transcribe implementation](https://github.com/openai/whisper/blob/main/whisper/transcribe.py), [official decoding options](https://github.com/openai/whisper/blob/main/whisper/decoding.py)

`faster-whisper` uses CTranslate2 and supports FP16/int8 and batching. It is a useful second-stage worker optimization, but changes runtime, decoding defaults, memory behavior and potentially text. Its maintainers specifically warn that speed comparisons need matching beam sizes and WER. Benchmark it separately after the controlled Transformers comparison. [Maintainer implementation and benchmark guidance](https://github.com/SYSTRAN/faster-whisper)

Short publisher-segmented clips do not validate long-form chunk stitching, meeting VAD, subtitle timestamps, robustness to silence/overlap, accents/names, or production traffic coexistence. The existing pilot's limitations remain applicable. Whisper supports segment timestamps and alignment-based word timings, but those are separate features to validate; timing disabled here keeps the primary accuracy/runtime question focused. [Official timing behavior](https://github.com/openai/whisper/blob/main/whisper/timing.py)
