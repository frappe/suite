# Indian English transcription comparison

2026-10-19. Accent-specific follow-up to the [AMI comparison](transcription-challenger-results.md), using public Indian English audio. This is an isolated self-hosted pilot, not a production rollout.

## Dataset and frozen sample

The official [AI4Bharat Svarah](https://huggingface.co/datasets/ai4bharat/Svarah) test set, revision `ebbf7777fe771490696a3f7b007097606fa8c924`, provides human transcripts under CC BY 4.0. The host's existing authenticated account already had access to its gated audio; no new conditions were accepted on the user's behalf. Its clean, prompted solo recordings include read and spontaneous speech. They do not establish noisy, overlapping, or codec-degraded Meet performance. See the [dataset research](indian-english-pilot-research.md) and [publisher paper](https://arxiv.org/abs/2305.15760).

Before any inference, we froze 120 unique original WAV clips, 783.3315 seconds (13.06 minutes), and 1,624 strict reference words. Actual lengths range from 3.024 to 19.083 seconds. Selection covers 115 complete demographic profiles, all 19 primary-language categories and 17 state labels present in this release, 66 female-labeled and 54 male-labeled clips, and all four age bands. The released schema exposes neither reliable speaker identity nor speech-style labels. Profiles are not verified people; unique speaker count and balanced read/spontaneous coverage cannot be claimed. The publisher's broader state-count description differs from the pinned release's labels.

Selection: accept publisher duration 3–25 seconds and at least five strict reference words; group by all eight released demographic fields; hash-sort clips within profiles with seed `suite-indian-english-pilot-v1`; order profiles round-robin by primary language, hash order within language; take one per profile before a second pass, stopping at 120 with at most two clips per profile. No model output influenced selection. Original publisher waveform bytes and human text are preserved. An independent audit reconstructed the selection from all 6,656 source rows and verified each chosen waveform hash, duration, reference, metadata, and unique ID.

Manifest SHA-256: `b9e4e58df083adc49815969f862bd0c2b8fede85cb67bd9ad7e4e54accb0bf73`. Selected inputs, references, predictions, and results remain on persistent GPU-host storage under `/opt/asr-eval/transcription-pilot-20261019/private/indian-english`. Full public dataset shards and disposable model weights use `/mnt/asr-cache`; credentials remain outside the container.

## Models and scoring controls

Cohere Transcribe 03-2026, Granite Speech 5.0 470M TurboCTC, Qwen3-ASR 1.7B HF, and Whisper large-v3-turbo use the previously pinned official checkpoints. The [earlier reports](transcription-challenger-results.md) record exact revisions and runtime. All run sequentially in the same isolated one-CPU/6-GiB-RAM container on the shared T4, batch one, native FP16 inference without quantization; Granite retains its native FP32 normalization parameters. Torch allocator cap: 7 GiB. No inference API is used.

English is fixed for multilingual models, with no vocabulary prompt, prior-clip history, VAD, or timestamps. Generative models use greedy decoding and a 256-new-token limit with EOS validation. Granite uses greedy CTC collapse and finite-logit checks; EOS/token limits do not apply. Whisper uses its native 30-second padding, published token suppression, and disabled fallback/no-speech heuristics. Qwen scores raw generated suffixes without its optional repetition correction. Each model runs two passes; repetition does not enlarge the accuracy sample.

Both scoring policies were specified before inference: the original strict casefold/punctuation policy, and the identical Transformers Whisper `EnglishTextNormalizer` for every reference and hypothesis. The latter standardizes contractions, numbers, spelling, and fillers, with the same frozen spelling dictionary as the earlier diagnostic. Neither metric measures semantic correctness or readability. Scores cannot be numerically compared with AMI to isolate a causal accent penalty: the speech content, references, domain, and speakers also differ.

## Measured results

Cohere has the lowest common-normalized WER; Whisper turbo has two fewer strict word errors. These small, scoring-dependent gaps do not establish a clear quality winner. Whisper turbo is competitive on this Indian English subset despite trailing on the earlier AMI cohort. Granite remains the fastest and smallest candidate with somewhat higher error; Qwen does not improve the accuracy/compute trade-off in these measured settings.

| Model | Strict errors / 1,624 words | Common normalized errors / 1,634 words | First / warm pass (s) | Warm audio / wall time | Peak allocated / reserved (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cohere Transcribe | 135 (8.31%) | 123 (7.53%) | 81.55 / 25.73 | 30.44x | 4,009 / 4,190 |
| Granite 5.0 TurboCTC | 185 (11.39%) | 142 (8.69%) | 17.61 / 2.71 | 289.44x | 983 / 1,008 |
| Qwen3-ASR 1.7B HF | 215 (13.24%) | 133 (8.14%) | 96.21 / 94.86 | 8.26x | 5,372 / 5,502 |
| Whisper large-v3-turbo | 133 (8.19%) | 130 (7.96%) | 35.58 / 34.86 | 22.47x | 1,643 / 1,690 |

All four models produced identical text across both passes. Every generative output ended with EOS, and every Granite output had finite CTC logits. No scored clip failed or reached its generative token cap. Model load times, separately: Cohere 26.30 seconds, Granite 2.06, Qwen 10.75, Whisper turbo 1.07. These are new-process loads with uncontrolled disk caches, not cold-storage benchmarks.

For the next representative Meet evaluation, retain Cohere and Whisper turbo as quality candidates and Granite as the efficiency option. Do not rank Indian regional accents from the tiny metadata subgroups, infer that all Whisper variants behave like turbo, or convert this public-subset result into a population-level accent claim. The recorded per-language breakdown is descriptive only.

## Audit and operational outcome

Independent scoring recomputed all 960 scored cases (120 clips × two passes × four models) against the frozen references, verifying IDs, strict word counts/distances, common-normalized distances, repeated text, and model-specific completion. Sampling was independently reconstructed from the pinned source shards. The shared spelling dictionary SHA-256 remains `bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd`.

All four monitored runs exited successfully with no safety abort. All 158 sampled production health responses were healthy, with no recent inference failure. Sampled GPU free memory stayed at least 6,261 MiB; whole-device usage peaked at 8,651 MiB. Healthy HTTP probes do not establish production latency safety under simultaneous speech load.

The experimental container is stopped, with no OOM flag. Production remains healthy on its original image and `2026-10-14T08:25:17.284802547Z` start time. GPU use returned to 3,015 MiB with 11,897 MiB free. Root storage has approximately 8.3 GiB free; the ephemeral cache uses approximately 7.3 GiB with 107 GiB available. Public source shards and model weights are retained as disposable cache; selected evidence remains persistent.

Private `comparison-summary.json` stores both policies, timing, report hashes, and descriptive metadata-group counts. `selection-summary.json` stores sample coverage and original shard hashes. `monitor-summary.json` stores probe/exit totals and executed preparation, orchestration, scoring, runner, and monitor hashes. Whisper's accent runner differs from the earlier runner only in its checkpoint cache path; decoding is unchanged.

Per-clip CUDA-synchronized timing includes preprocessing, device transfer, inference, and decoding, excluding model load, disk/hash work, queue overhead, parameter validation, and Granite's post-inference finite-logit checks. A second pass is a warm repeat, not a promise of faster execution. Throughput on these short clips is not sustained meeting-worker capacity. Peak Torch allocation excludes resident production memory and other CUDA allocations.

This is a small, public benchmark subset with publisher references that we did not independently listen-check. Training overlap is unknown. Metadata coverage does not establish equal performance across Indian accents; individual language/state groups have too few clips for reliable rankings. Representative authorized Meet speech, longer captures, names/domain vocabulary, silence/noise, overlap, segmentation, and production latency under concurrent speech load remain unvalidated.
