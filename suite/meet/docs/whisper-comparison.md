# Matched Whisper comparison

2026-10-19. Follow-up to the [Cohere pilot](transcription-pilot-results.md), comparing official self-hosted Whisper checkpoints on the same frozen inputs. No third-party inference API or production deployment is involved.

The [subsequent Qwen/Granite comparison](transcription-challenger-results.md) includes common-normalized scores for these Whisper runs as a secondary diagnostic.

## Scope and controls

The primary cohort is 60 publisher-segmented AMI IHM test clips: 267.850 seconds, 785 reference words, seven speakers across three meeting recordings. Selection, publisher revision, licensing, and scoring are documented in the earlier pilot. Manifest SHA-256: `ba9c01519a0ef9d2b1eb1a2c610653d19a60192e0e57dab602c193cd13cd759d`. Repetitions do not increase the accuracy sample size. This public benchmark is not unseen, representative Meet acceptance data.

All candidates use the same T4, isolated one-CPU/6-GiB-RAM container, Torch/Transformers versions, FP16 inference without quantization, batch size one, English, and a 256-new-token limit. Each model uses its own processor and published token suppression configuration. Whisper small.en/medium.en use 80 mel bins; large-v3/turbo use 128. English-only models omit multilingual language/task arguments. Models run sequentially, preserving the existing production ASR instance.

Primary decoding is greedy, without prompts, prior-clip conditioning, timestamps, temperature fallback, compression/log-probability retries, or no-speech skipping. Whisper uses its ordinary 30-second input padding. Separate beam-5 runs change only beam width for large-v3 and turbo; they do not replace the primary result. This tests defined native Transformers configurations, not the fastest or most accurate possible Whisper deployment. A faster-whisper/CTranslate2 comparison would be a separate experiment. See [source research and pinned revisions](whisper-comparison-research.md).

Scoring uses the original frozen policy: Unicode casefold, remove punctuation except straight apostrophes, split whitespace, then unit-cost word Levenshtein distance. No filler removal, contraction expansion, or number normalization. This measures fidelity to the verbatim reference, not transcript readability.

## Results

Cohere remains the provisional candidate: it has the fewest errors on this cohort, and its warm repeat is faster than these native Whisper configurations. Whisper turbo is the strongest measured alternative when candidate memory is the main constraint. These results support the next evaluation step, not a final production model decision.

| Model, greedy FP16 | Errors / 785 | WER ↓ | First / warm pass (s) | Warm audio / wall time ↑ | Peak allocated / reserved (MiB) | Load (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cohere Transcribe | 45 | 5.73% | 39.72 / 11.12 | 24.09x | 3978 / 4026 | 26.19 |
| Whisper small.en | 153 | 19.49% | 16.47 / 15.71 | 17.05x | 634 / 652 | 1.09 |
| Whisper medium.en | 153 | 19.49% | 32.39 / 38.86 | 6.89x | 1896 / 1972 | 2.03 |
| Whisper large-v3 | 135 | 17.20% | 48.16 / 47.65 | 5.62x | 3669 / 3762 | 2.13 |
| Whisper large-v3-turbo | 141 | 17.96% | 17.41 / 16.57 | 16.16x | 1642 / 1688 | 1.15 |

Cohere’s new reference run reproduced all earlier text and the 45-error score; its warm timing was 11.118 seconds versus the earlier 11.193. New-process loading took 26.191 seconds versus the earlier 6.762, illustrating load/cache variability. Loading is excluded from pass timing. Small and medium share an aggregate score but differ on 37 of 60 hypotheses. All primary repetitions produced identical text within each model, and every generation ended with EOS.

Quality-oriented supplementary runs, one pass each:

| Model, beam 5 FP16 | Errors / 785 | WER ↓ | Pass time (s) | Audio / wall time ↑ | Peak allocated / reserved (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Whisper large-v3 | 132 | 16.82% | 75.41 | 3.55x | 4428 / 4668 |
| Whisper large-v3-turbo | 139 | 17.71% | 21.65 | 12.37x | 1785 / 1876 |

Beam search reduces large-v3 by three errors and turbo by two; neither has a warm-repeat measurement. The existing isolated streaming Nemotron baseline scored 109/785 (13.89%) on the same references, with resampled/paced input; its timing is not an offline throughput comparison.

On the separate two-utterance check: Cohere 11/132 errors (8.33%), small.en 11/132 (8.33%), medium.en 10/132 (7.58%), large-v3 13/132 (9.85%), turbo 12/132 (9.09%). This tiny set does not preserve the primary ranking. All four Whisper models transcribed the eight-word speech smoke correctly and emitted one normalized word on the five-second synthetic silence; Cohere emitted no text in its earlier smoke test.

## Interpretation and limits

Omitting spoken fillers contributes to Whisper's score, but does not explain the full gap. The cohort contains 20 filler words under the audit's explicit set (`uh`, `um`, `uhm`, `erm`, `er`, `ah`, `hmm`, `mm`, `mhm`, `mmhmm`). Large-v3 and medium.en delete 18 and substitute two; small.en deletes 16 and substitutes four. Cohere deletes one and substitutes one. Large-v3 still has 68 non-filler deletions versus Cohere's 12 under the audit's deterministic alignment. These are descriptive diagnostics, not a revised scoring policy.

The single synthetic silence test deliberately has no no-speech filter. Its result tests these raw decoding settings; it does not rank each model's best silence-handling configuration. The speech smoke test has only eight words. The two longer utterances total 132 words and last 28.464 and 17.632 seconds; they do not establish hour-long meeting performance, chunk stitching, or timestamp quality.

Per-clip times include preprocessing, device transfer, and synchronized generation, excluding disk reads/hashes, process startup, scheduling gaps, and queue overhead. Model loading is separate. A second pass can be slower; “warm” names the repeat, not an assured improvement. Peak Torch allocation is measured for the candidate, not total device memory or a deployment reservation. The production model remains resident throughout. Healthy production probes do not establish real-user latency safety under concurrent speech load.

## Evidence and cleanup

Private evidence remains on the GPU host under `/opt/asr-eval/transcription-pilot-20261019`: `private/whisper/*-greedy.json`, `*-beam5.json`, `*-long.json`, `cohere-reference.json`, checkpoint metadata/configuration snapshots, `comparison-summary.json`, smoke reports under `private/smoke`, and monitoring/exit records under `logs`. Raw audio, references, predictions, and credentials stay outside git. `generated_tokens` in Whisper reports counts the full decoder sequence including its prefix; it is not a new-token count. EOS checks use the preserved raw sequence.

An independent read-only audit recomputed word distances with a full matrix, checked exact IDs/references/source hashes, verified repeated outputs, and inspected the installed generation helper's EOS behavior. It found no scoring or protocol mismatch. Across the 14 Whisper monitor files and the Cohere reference monitor, all 197 sampled production responses were healthy, with no recent inference failure. Sampled whole-device use peaked at 7,817 MiB; sampled free memory stayed at least 7,095 MiB. No safety abort fired.

All four temporary Whisper weight directories were removed after their results and checkpoint metadata were saved. The Cohere checkpoint remains. The experimental container is stopped with no OOM flag. Production remains on its original image and `2026-10-14T08:25:17.284802547Z` start time; its health is good. GPU use returned to 3,015 MiB with 11,897 MiB free, and root storage has approximately 8.3 GiB available. The instance-store device remains untouched.

Executed Whisper runner SHA-256: `9d471bcf5c474328769858381a7b3a9a7b1054684a5a139199f6071a5a0701a9`. Orchestrator SHA-256: `d9ff36bd2cc86873ab92facf4fc641f5308575b5433601b932c07038d50bf07b`. Individual report hashes are retained in the private comparison summary. The unchanged Cohere runner hash is recorded in the original pilot report.
