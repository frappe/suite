# English batch transcription pilot results

2026-10-19. Preliminary pilot complete, including the matched streaming baseline and independent scoring audit. This is a feasibility investigation, not a production rollout or an acceptance claim for every [batch-transcription gate](../../../specs/meet/002-batch-transcription.md).

The subsequent [matched Whisper comparison](whisper-comparison.md) adds small.en, medium.en, large-v3, turbo, and a repeated Cohere reference run.

## Outcome

Self-hosted Cohere Transcribe runs in FP16 on the available T4 alongside the loaded production ASR model. It completed all candidate cases without generation truncation, CUDA failure, or out-of-memory failure. All sampled production health responses were healthy. Real-user production latency and coexistence under controlled production speech load were not measured.

On the broader 60-clip cohort, Cohere had 45 word errors out of 785 reference words (5.73%), versus 109 (13.89%) for the isolated production recognizer, with fewer errors in each of the three meeting samples. The evidence supports continuing with Cohere as a provisional implementation candidate. Model selection for deployment still needs representative Meet speech, explicit quality criteria, longer-running measurements, and capture/queue integration validation.

## Runtime and controls

- Candidate: `CohereLabs/cohere-transcribe-03-2026`, revision `d552dadc2922ba6f6c1f994f8db904d52dcaf942`; native Transformers model class, FP16, English, greedy decoding, batch size one, 256 generated-token bound.
- GPU: Tesla T4, reported 15,360 MiB VRAM, NVIDIA driver `580.178.04`. Before inference, production used approximately 3,015 MiB and reported free memory was 11,897 MiB.
- Runtime: Torch `2.8.0a0+5228986c39.nv25.6`, Transformers `5.19.0`, accelerate `1.13.0`, safetensors `0.8.0`. The Torch wheel reports T4 architecture `sm_75` support. This differs from the author's Torch 2.10.0 test environment.
- Isolated container: one CPU, 6 GiB host RAM limit, restricted capabilities, no published candidate service. Candidate Torch allocator limit: 7 GiB. The allocator limit is not a reservation or a limit on all CUDA allocations.
- Monitoring: production health, GPU memory/free space/utilization, and container memory. Abort on an unhealthy production response, monitoring failure, free GPU memory below 3,072 MiB, or run timeout. No abort condition fired in completed runs.
- Baseline: exact production image `sha256:bdd314ae9b2b30a00b8dd5ad13011193d71ab4011a95ce1eba86edca6f3d827d`, cached Nemotron model snapshot `ea30d66debe3740a08b573244286791d423d6b3e`, isolated service and key, read-only production model mount. English prompt, existing built-in glossary, no supplied roster hints. Candidate inference and baseline inference run separately.

## Sources and frozen expectations

The smoke fixture is [LibriSpeech test-clean](https://www.openslr.org/12/), utterance `6930-75918-0000`: 3.505 seconds and eight publisher-reference words. A separately generated five-second silent waveform has an empty expected transcript. Both passed; the speech fixture had zero word errors and silence produced no text. This is one read-speech example and one synthetic silence example, not a hallucination robustness benchmark.

The first meeting sample uses the [AMI manual annotation archive](https://groups.inf.ed.ac.uk/ami/download/) v1.6.2 and ES2004a headset channel 0. The annotation mapping, deterministic selection, and nine exact spans are in [the research note](cohere-transcription-pilot-research.md). Nine clips contain 46.137 seconds of speech-source audio and 114 reference words. The selection retained lexical fillers/truncations and excluded punctuation/non-word annotation nodes.

Attempts to download the remaining original headset channels encountered HTTP 403 responses. A proposed four-speaker expansion was frozen but never evaluated. The broader evaluated sample instead uses the [publisher's AMI mirror](https://huggingface.co/datasets/edinburghcstr/ami), IHM test split: first 20 qualifying rows on each page beginning at offsets 0, 5000, and 10000. Qualifying duration is 2–15 seconds inclusive with at least five reference words. Selection was frozen before candidate inference, without choosing clips by model performance.

That broader sample contains 60 unique clips, seven speaker IDs, 267.8499375 seconds, and 785 reference words from EN2002a, EN2002d, and TS3003a. Actual clip durations range from 2.05 to 9.36 seconds. Downloaded waveforms are mono 16 kHz IEEE float32. The publisher dataset and cached audio revision is `46f28f2503e2ec48f8867a84eef356c70476beab`. Original publisher rows, references, selection, audio hashes, predictions, and monitoring remain outside git. AMI and LibriSpeech attribution/license: CC BY 4.0.

Publisher references were not independently listen-checked for this pilot. An independent audit verified extraction against source XML/API rows, sample boundaries, actual waveform duration, media hashes, unique IDs, and report/manifest consistency. AMI is a published model benchmark; it does not establish unseen-training-data performance.

## Scoring and comparisons

The executed frozen normalization applies Unicode casefold, removes characters other than regex word characters, whitespace, and straight apostrophes, then splits whitespace. It does not apply NFKC, remove lexical fillers, expand contractions, or normalize numbers. Use the same policy on references and both models' hypotheses. Word errors are unit-cost word substitutions, deletions, and insertions. Report each unique reference set once; repetitions do not increase accuracy sample size.

Candidate inference receives the frozen 16 kHz sources. The streaming API requires mono 24 kHz PCM16, so baseline inputs use `scipy.signal.resample_poly(up=3, down=2)` and PCM16 encoding of those same source clips. They are matched speech and references, not byte-identical payloads. The broader cohort had zero resampled samples outside PCM16 range. Separate source and converted-input hashes are retained. Streaming requests are paced; their elapsed time is not an offline throughput comparison.

- Initial nine clips: Cohere 5/114 errors, **4.39% WER**, versus isolated Nemotron 13/114, **11.40%**. Independent alignment confirmed Cohere's 3 substitutions and 2 deletions, and baseline's 6 substitutions, 6 deletions, and 1 insertion. Neither run failed.
- Broader 60 clips: Cohere 45/785 errors, **5.73% WER**: 27 substitutions, 13 deletions, and 5 insertions. Isolated Nemotron had 109/785 errors, **13.89%**: 53 substitutions, 40 deletions, and 16 insertions. Independent same-policy alignment confirmed both counts. All baseline clips completed; candidate text is identical across both repetitions and all generations ended with EOS.
- Broader per-meeting scores, candidate versus baseline: EN2002a 15/263 (**5.70%**) versus 31/263 (**11.79%**); EN2002d 17/269 (**6.32%**) versus 39/269 (**14.50%**); TS3003a 13/253 (**5.14%**) versus 39/253 (**15.42%**). These are descriptive results on this selected cohort, not a statistical significance or unseen-Meet-data claim.
- Two additional complete ES2004a utterances lasting 28.464 and 17.632 seconds: 11/132 errors (**8.33%**), with identical results across three repetitions and normal EOS. These are a separate bounded long-utterance check; no matched streaming comparison is claimed for them.

## Timing and memory

On the broader 60-clip candidate sample, summed preprocessing/transfer/generation time was **39.837 seconds on the first pass (6.72 audio-seconds per wall-second)** and **11.193 seconds on its warm repeat (23.93x)**. Model/process loading took an additional **6.762 seconds**. Disk reads/hashes, interpreter startup, scheduling gaps, and queue overhead are not included in those summed per-clip times. New-process loading is not a measurement of an empty OS disk cache.

The nine-clip sample measured 6.38x on its first pass and 28.15–28.32x on warm repeats, with 6.953 seconds of model loading. The two longer utterances measured 14.52x first-pass and 39.13–40.36x warm, plus 10.851 seconds of loading. Do not combine these into a sustained-meeting throughput claim or treat repeated audio as additional diverse data.

Maximum recorded candidate Torch allocation was **4,038 MiB**, with **4,108 MiB reserved**, on the longer-utterance check. Maximum sampled whole-device usage in that run was **7,257 MiB**, including production; sampled free device memory stayed at least **7,655 MiB**. Sampling can miss transient peaks outside Torch's counters. No controlled production traffic or real-user latency measurement accompanied these runs.

The broader baseline replay took 277.294 seconds including paced delivery of 267.850 seconds of source audio. Maximum sender lag was 42.8 ms; all 91 sampled production health responses were healthy. Its elapsed replay time is not comparable to unpaced offline inference throughput.

After measurements, both experimental containers were stopped. Production remained healthy on the same image and original `2026-10-14T08:25:17.284802547Z` start time. GPU usage returned to 3,015 MiB with 11,897 MiB free; root storage had approximately 8.3 GiB available. The checkpoint, private inputs/results, and stopped experiment containers remain available for subsequent work. The unmounted instance-store device remains untouched.

## Evidence locations

Private GPU-host working directory: `/opt/asr-eval/transcription-pilot-20261019`. Reports are under `private/smoke`, `private/ami`, and `private/ami-publisher`; monitoring and exit status are under `logs`. `private/pilot-summary.json` aggregates non-transcript metrics, and `export_summary.py` independently recomputes distances from saved outputs. Source scripts and all raw speech/references remain outside git.

Frozen manifest SHA-256 values:

- Smoke: `3bf095de8af2f46b034ed9448523aca155752cb58fa4766d0860d239ef48f12e`.
- Original nine clips: `0cb5688517e917796af94dba7b0cacc9d34a59513197ebcffe5766f628478b31`.
- Broader 60 clips: `ba9c01519a0ef9d2b1eb1a2c610653d19a60192e0e57dab602c193cd13cd759d`.
- Two longer utterances: `705f445ac63d40f1c78e23fa02d164302b728407f95d560739e6d9ff390781b0`.

Candidate runner SHA-256: `942db05dda82b1b0c36b4b7e300bb920448e3eb1232bfadea62ac5f3e3dd1b68`. Full executed-wrapper and baseline-client hashes are retained in the private summary.

## Remaining gates

- Independently listen-checked, representative authorized Meet speech, including accents and domain/participant names. No dedicated name-recall or accent-quality claim follows from these samples.
- End-to-end audio ingestion and VAD boundaries, interrupted captures, speaker/source identity, and source-clock timing. Oracle/publisher utterance boundaries used here do not validate production segmentation.
- Long recordings, sequential chunk boundaries, silence/noise robustness, sustained backlog, worker restart/retry cleanup, fair multi-site scheduling, and isolation. The longest measured utterance is 28.464 seconds.
- Production coexistence under controlled simultaneous speech load and an explicit latency/error budget. Healthy HTTP samples alone do not establish it.
- Numerical quality criteria, worker sizing, site quotas, and a validated capacity model before deployment. No one-hour delivery guarantee or site limit is established here.

## Local tooling incident

During independent scoring, an audit command ran project-aware `uv` and inadvertently recreated the ignored local `.venv`. It was stopped before project dependencies were installed. The known original interpreter symlink was restored and the newly generated `uv.lock` removed, but prior environment metadata/package contents were not captured and cannot be claimed fully restored. This affected the local workspace, not the GPU host, production ASR, or the benchmark evidence. Further scoring used isolated/standard-library checks without changing that environment.
