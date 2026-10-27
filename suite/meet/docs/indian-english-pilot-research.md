# Indian English transcription pilot: dataset research

2026-10-19. Use AI4Bharat's **Svarah** for the next controlled comparison of Cohere, Granite, Qwen, and Whisper turbo. This note establishes dataset provenance and sampling constraints; measured results belong in a separate report.

The [completed measured comparison](indian-english-pilot-results.md) records results and operational checks.

## Dataset and access

The [publisher's dataset card](https://huggingface.co/datasets/ai4bharat/Svarah) describes 9.6 hours of English from 117 Indian speakers, spanning 65 districts, 19 states, and 19 native languages. The published test split has 6,656 rows. Audio, duration, transcript, gender, age group, primary language, state/district, education, and occupation metadata are listed in the [publisher's schema](https://huggingface.co/datasets/ai4bharat/Svarah/blob/ebbf7777fe771490696a3f7b007097606fa8c924/README.md). An explicit speaker ID or speech-style field is absent from that schema.

The publisher specifies **CC BY 4.0** and gates files behind agreement to contact-information sharing and access conditions. The existing GPU-host account already had file access when checked; this pilot did not accept new terms. Preserve attribution, the pinned revision `ebbf7777fe771490696a3f7b007097606fa8c924`, source paths, checksums, and any resampling details with the private manifest. Use the official repository, not a mirror to bypass access conditions. [Dataset license and gate](https://huggingface.co/datasets/ai4bharat/Svarah)

## What it measures

The [authors' paper, section 3](https://arxiv.org/html/2305.15760), describes consensual Karya smartphone collection from fluent English speakers with regional Indian native languages. Participants supplied read sentences, extempore answers, and everyday-service prompts. They replayed recordings to check audibility and background noise. English-fluent students checked quality, segmented sentences, and supplied human transcripts using Switchboard guidelines. Approximately 1.4 hours are read, 6.4 hours extempore, and 1.7 hours everyday-use-case speech; these rounded figures should not be treated as exact totals.

This makes Svarah useful for accent diversity and Indian names/entities, but it is prompted solo speech selected for clean audio. It does not establish quality for overlapping meeting voices, distant microphones, packet loss, long recordings, or code switching. The paper itself inconsistently reports 19 versus 17 states; use the current dataset card's 19-state description and report the actual sampled metadata separately. Public benchmark exposure or training contamination cannot be ruled out.

## Recommended frozen sample

Before inference, select 120 unique utterances lasting 3–25 seconds with at least five reference words. Use deterministic hash ordering with a recorded seed and canonical source-row IDs. Prefer a language-stratified round robin over verified speaker IDs, with at most two clips per speaker if enough speakers qualify. Record exclusions and actual language, state, gender, duration, and speaker counts. A metadata tuple is not proof of speaker identity: inspect and validate the publisher's audio-path convention before claiming speaker coverage. If identity cannot be established, state that limitation and sample across metadata strata instead.

Use one frozen manifest and identical references across all models. Predeclare both the earlier strict scoring and the same common English normalization for every model; normalization conventions can change rankings. Preserve raw predictions privately. Do not infer read/extempore/use-case balance unless the released files expose a validated style label. Keep speech preparation and scoring fixed, with no model-specific transcript cleanup or prompts. This sample is an accent screening exercise, not an Indian population estimate or Meet acceptance test.

## Frozen sample audit

The executed selection uses eight-field demographic profiles, **not speaker IDs**. It takes one eligible hash-ordered clip from each profile in language-round-robin order, then a second clip from the earliest eligible profiles until reaching 120. Audio filenames do not establish unique speakers. The result covers all 115 eligible metadata profiles, 19 native-language labels, and 17 state labels, with 66 female-labelled and 54 male-labelled clips. These are clip counts, not counts of unique people.

Independent reconstruction from the three original parquet shards matched the exact selected row order, references, metadata, source WAV bytes, SHA-256 hashes, and decoded durations. All 120 IDs and audio hashes are distinct. The frozen sample contains 783.3315 seconds, 1,624 strict reference words, and clips lasting 3.024–19.0829375 seconds. The original 16 kHz mono WAV bytes are preserved without resampling. Manifest SHA-256: `b9e4e58df083adc49815969f862bd0c2b8fede85cb67bd9ad7e4e54accb0bf73`. Files and detailed coverage remain privately under `/opt/asr-eval/transcription-pilot-20261019/private/indian-english` on the GPU host.
