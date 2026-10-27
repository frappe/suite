# Qwen and Granite transcription challenger results

2026-10-19. Measured follow-up to the [leaderboard shortlist](asr-leaderboard-candidates.md) and [Whisper comparison](whisper-comparison.md). This is an isolated self-hosted pilot, not a production deployment or a claim that all Meet acceptance gates have passed.

The subsequent [Indian English comparison](indian-english-pilot-results.md) finds Whisper turbo competitive with Cohere on a separately frozen Svarah sample; quality rankings should not be generalized from AMI alone.

## Protocol

Use the same frozen 60 AMI IHM clips (267.8499375 seconds, 785 words, seven speaker IDs, three meetings), the same eight-word LibriSpeech smoke and five-second synthetic silence, and the same two longer ES2004a utterances (46.096 seconds, 132 words). Source selection, licensing, and manifest hashes are recorded in the [initial pilot](transcription-pilot-results.md). Repeat counts are two for the primary corpus and one for smoke/long checks; repetitions are not new accuracy samples.

The GPU remains the shared Tesla T4. A separate restricted container uses the original production image, one CPU, 6 GiB host RAM, batch size one, a 7 GiB Torch allocator cap, and native Transformers 5.19.0 with Torch 2.8.0a0+5228986c39.nv25.6. Only the isolated container adds accelerate 1.13.0 and CPU-wheel torchaudio 2.8.0; no dependency resolution or production package replacement occurs. TorchAudio import and its delta-feature operation passed before model testing. These vendor/prerelease Torch and released TorchAudio builds are not an upstream-supported exact version pairing; successful pilot execution does not establish general binary compatibility. [TorchAudio installation and compatibility](https://docs.pytorch.org/audio/stable/installation.html)

Weights use the newly authorized instance-store cache at `/mnt/asr-cache/models`, explicitly mounted into the pilot as `/cache`. Credentials and all frozen audio/references/results remain on persistent storage under `/opt/asr-eval/transcription-pilot-20261019`. Only public benchmark audio was used, and inference ran locally without a third-party transcription API.

- Qwen: `Qwen/Qwen3-ASR-1.7B-hf`, revision `bcd2b5b7f32b480ab5790554cfa8347f246a14f3`; weight file 4,076,193,080 bytes, SHA-256 `2db53c7d81bd9b8cbc6a074e89be2c968a0d373fb4ee68bb1b1e14f7042dfee1`. Native Qwen3ASR processor/model, FP16, SDPA, forced English prefill, greedy, maximum 256 new tokens. Score only the generated suffix with raw tokenizer decoding; the processor's optional repetition correction is excluded. No vocabulary prompt, history, VAD, timestamps, or forced aligner. Preserve both published EOS token IDs. [Official checkpoint](https://huggingface.co/Qwen/Qwen3-ASR-1.7B-hf)
- Granite: `ibm-granite/granite-speech-5.0-470m-turboctc`, revision `947f59af40db9791170a0628cf0f3f4812d720f1`; weight file 946,180,704 bytes, SHA-256 `8b98a8c34fd5fcb081caef719638eded31bb6d197d62053eefc5c1703aaf1ad4`. Native GraniteSpeech5 processor/model and Parakeet CTC tokenizer, SDPA, FP16 loading while preserving the library's explicitly FP32 convolution normalization parameters. Waveforms/front-end normalization remain FP32. Greedy CTC collapses frames/blanks; EOS and generated-token limits do not apply. Every output's logits must be finite. [Official checkpoint](https://huggingface.co/ibm-granite/granite-speech-5.0-470m-turboctc)

Frozen scoring is casefold, remove punctuation except straight apostrophes, split whitespace, unit-cost word Levenshtein distance; no filler removal or number/contraction expansion. CUDA-synchronized per-clip timing covers processing, transfer, inference, and text decoding. It excludes disk/hash work, parameter validation, queue/process overhead, and Granite's post-inference finite-logit check; model loading is separate. These are short-clip throughput observations, not sustained worker capacity. No same-model FP32 quality parity is claimed.

## Measured results

Cohere remains the quality reference on this sample. Granite is a credible efficiency alternative for the next representative Meet evaluation: its native output conventions inflate strict verbatim WER, while common normalized scoring narrows the gap considerably. Qwen did not improve accuracy, speed, or memory relative to Cohere in this configuration. These are provisional observations without a deployment quality threshold.

| Model | Strict WER / 785 words | Common normalized WER / 809 words | First / warm pass (s) | Warm audio / wall time | Peak allocated / reserved (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cohere Transcribe (earlier reference) | 45 errors, 5.73% | 47 errors, 5.81% | 39.72 / 11.12 | 24.09x | 3,978 / 4,026 |
| Granite 5.0 470M TurboCTC | 162 errors, 20.64% | 57 errors, 7.05% | 9.72 / 1.35 | 198.05x | 983 / 1,010 |
| Qwen3-ASR 1.7B HF | 87 errors, 11.08% | 63 errors, 7.79% | 41.91 / 43.77 | 6.12x | 5,372 / 5,482 |

Granite’s short-clip warm repeat is approximately 8.2 times faster than Cohere’s earlier reference, with approximately one quarter of its peak Torch allocation. This does not establish an 8.2x end-to-end worker capacity improvement: batching, real segmentation, queue/I/O overhead, and sustained speech were not measured. Granite model load took 1.639 seconds; Qwen load took 6.802 seconds, excluding separate parameter checks. Qwen’s warm repeat was slower than its first pass. No same-session Cohere rerun was added here; the earlier reference uses the same GPU/image, scored inputs, CPU/RAM limits, and core runtime.

All primary outputs were identical across repetitions. Qwen completed every generation with a published EOS token, with a maximum of 31 new tokens on the primary corpus. Granite completed every case with finite logits; its native precision retained 470 FP16 and 32 FP32 parameter tensors. Neither model was quantized.

Each challenger transcribed the eight-word speech smoke correctly and emitted one word on synthetic silence. Qwen’s silence text was an actual generated word, not a language/format marker. Granite’s separate longer-utterance check scored 24/132 errors (18.18%); Qwen scored 11/132 (8.33%), matching Cohere’s earlier 11/132. These two utterances do not establish a stable long-form ranking.

### Secondary common normalization

After observing Granite’s contraction and numeral conventions, we added a **post-hoc diagnostic**, applying the identical installed Transformers `EnglishTextNormalizer` to every reference and model hypothesis. It uses the spelling dictionary from the pinned Whisper small.en checkpoint. The original reports and primary strict scores remain unchanged. This normalizer standardizes contractions, number forms, spelling, and filler handling; it measures a different target and changes the reference denominator from 785 to 809 words. It is not a readability or semantic-correctness judgment. A production metric must be agreed before the next acceptance evaluation.

The normalized results also include the previously tested Whisper models: small.en 131/809 (16.19%), medium.en 135/809 (16.69%), large-v3 greedy 112/809 (13.84%), turbo greedy 120/809 (14.83%). Beam-5 results remain separate: large-v3 106/809 (13.10%), turbo 115/809 (14.22%). Granite’s apparent disadvantage relative to Whisper under strict scoring reverses under the common normalizer, so selecting a worker solely from raw verbatim WER would be misleading. Cohere remains lowest under both policies.

Independent strict alignments for the new models: Granite 98 substitutions / 25 deletions / 39 insertions; Qwen 37 / 43 / 7. Conventions explain a substantial part of Granite’s strict score; other recognition errors remain. No model-specific normalization or transcript cleanup was used.

## Audit, operational outcome, and limits

An independent audit recomputed every primary case with a full word-distance matrix, verified frozen source hashes and IDs/references, repeated-output equality, and model-specific completion. It also recomputed all 540 secondary-scoring pairs across nine configurations, matching each case and total. The common spelling dictionary SHA-256 is `bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd`.

Across eight monitor files, including two pre-inference missing-library failures, all 70 sampled production responses were healthy. No safety abort fired. Sampled whole-device usage peaked at 8,685 MiB and free memory stayed at least 6,227 MiB. All six scored stages completed without inference failure; setup failures remain separate from scored cases.

The experimental container is stopped with no OOM flag. Production remains on its original image and `2026-10-14T08:25:17.284802547Z` start time, healthy with GPU usage back at 3,015 MiB and 11,897 MiB free. Root storage has approximately 8.3 GiB free. The ephemeral cache retains both downloaded checkpoints, using approximately 4.7 GiB with 110 GiB available; these are disposable and reproducible from the recorded revisions.

Executed runner SHA-256: `1f1c441e58c81915bf5e3d44e47edf0567e63b2be5348981d5e70556f8a94be1`; orchestrator: `88986ce389cf5e7f5ad928e439b07b6d0246c15cb174b19d713ee7925913312b`; monitor: `dc2904f8ee65fce2b5790807f03f4b7cd123a89543378efa91e49373ed9ed33c`. Private `comparison-summary.json` records report hashes and measurements; `secondary-normalization.json` records the diagnostic scores and source hashes; `monitor-summary.json` records probe/exit totals.

Both models require representative authorized Meet audio, longer recordings, segmentation/chunk stitching, codec degradation, accent/domain-name evaluation, and a numerical quality target before selection. Public AMI is a known benchmark and these references have not been independently listen-checked. Single synthetic silence is not a hallucination robustness benchmark. Healthy production probes do not measure real-user latency under simultaneous production speech load.

Private reports are under `private/challengers`; checkpoint configuration snapshots and weight hashes remain there even if ephemeral weights disappear. Monitoring and setup failures are retained under `logs`. The wrapper was first corrected to admit the new isolated container; two subsequent Granite attempts stopped before model loading because torchaudio was missing. The missing-library logs are retained; these are harness/dependency failures, not scored model failures. The corrected runner is frozen for all scored cases.
