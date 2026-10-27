# Trelis public-reference benchmark

2026-10-21. The owner asked to stop manual transcription work. This bounded run uses existing publisher references, with no additional owner review task. [Aggregate evidence](transcription-public-benchmark-validation.json) and [dataset research](transcription-public-benchmark-research.md) retain the protocol, sources and limits.

Trelis passes the provisional English numerical ceiling on this small Indian-English sample. Keep it as the leading provisional candidate. This does not accept the model for rollout, and no production code or deployment changed.

| Cohort | Whole clips | Reference words | Word edits | Corpus WER |
| --- | ---: | ---: | ---: | ---: |
| Indian English, common English normalization | 20 | 293 | 24 | **8.19%** |
| Indian English, case/punctuation normalization only | 20 | 293 | 40 | 13.65% |
| Indian English, strict | 20 | 291 | 79 | 27.15% |
| Hindi-English, script-safe normalization | 50 | 771 | 139 | **18.03%** |
| Hindi-English, strict | 50 | 774 | 175 | 22.61% |

WER is total substitutions, deletions and insertions divided by total reference words. It is not a percentage of sentences understood or a semantic accuracy score. The 10% ceiling applies to common-normalized English, not to Hindi-English. No mixed-language ceiling was invented for this run.

## Frozen inputs and scoring

Indian-English audio comes from the first20 cases of the earlier frozen [AI4Bharat Svarah](https://huggingface.co/datasets/ai4bharat/Svarah) 120-case manifest, revision `ebbf7777fe771490696a3f7b007097606fa8c924`, CC BY4.0. This repeats a public regression subset; it is not a new unseen-model holdout.

Hindi-English audio comes from [Trelis's evaluation-only HiACC adult-test derivative](https://huggingface.co/datasets/Trelis/hiacc-adult-test-eval), revision `45782b4752f1e353173cd0b940332a984fc0a249`. Credit: Shruti Singh, [HiACC: Hinglish Adult & Children Code-switched corpus](https://zenodo.org/records/15551669), CC BY4.0. All664 metadata rows were considered. Eligibility required whole clips3–20s with both ASCII letters and Devanagari in the reference;155 qualified. Hash-order selection with seed `suite-public-hinglish-v1` and a maximum5 clips per speaker produced50 clips across19 speakers. This is a deterministic operational filter, not independent language annotation. Audio revision and content hashes were checked before scoring.

Exact references, audio selection and normalization were frozen before inference. A preparation bug overwrote20 Svarah reference join IDs with source IDs; those join IDs were corrected during inference without changing reference strings, selected audio, order or scoring, and without inspecting predictions. This correction is recorded in the private protocol.

Script-safe normalization uses Unicode NFC, case-folding, punctuation/symbols to spaces and collapsed whitespace. It preserves Hindi marks and does not transliterate or rewrite numbers. The English cohort additionally uses Whisper's EnglishTextNormalizer and the checkpoint spelling map. Hindi-English never passes through that English normalizer. The edit-distance scorer passed known examples, Hindi-mark preservation checks and961 exhaustive short-string comparisons against an independent full-matrix oracle. No references were corrected from predictions.

## Runtime and observed limits

Model: `Trelis/whisper-hinglish-preview`, revision `eab1188fd2d0e91f2584229b32b3bfe1901c896c`, FP16 onT4. Same automatic language detection and special mixedcode prefix as the prior diagnostic, greedy decoding, batch1, no participant hints, no reference text, fresh context per whole clip. All70 clips,404.10s of audio, completed in133.20s including model loading and monitoring. All outputs were nonempty and ended withEOS. This short isolated run is not a sustained throughput or latency benchmark.

Production ASR remained sampled healthy with its image/start time unchanged. Minimum free GPU memory was7995MiB. The isolated container/runtime was removed; memory returned to3015MiB used/11897MiB free. A copied runner's placeholder fields `wer:null` and `checked_reference_available:false` are not scoring results; the separately frozen public references and completed score report provide the actual quality evidence.

Public text comparison shows remaining proper-name/identifier errors and script choices, alongside harmless spelling, number-formatting and punctuation differences. For example, English number normalization substantially reduces errors from a spoken-out identifier. Conversely, some English product/name words appear in Devanagari. WER alone cannot determine whether an apparent added clause is invented speech or an incomplete publisher reference; no such semantic claim is made without checking the audio.

HiACC was already used by the model author for evaluation; development/training contamination is not ruled out. Public short utterances do not establish quality on the private stand-up, per-speaker capture, speaker attribution, long recordings, overlap, noise or silence. No automated model judge or candidate agreement substitutes for an independent reference.

## Decision

Retain Trelis as the provisional source-recognition candidate: **8.19% passes the small Indian-English numerical check;18.03% describes mixed-script word edits.** Keep rollout disabled until the remaining source-fidelity and capture/runtime gates are satisfied. Continue automated regression and engineering validation; do not turn the owner's availability to transcribe clips into a prerequisite for doing that work.
