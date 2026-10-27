# Public references for a bounded transcription benchmark

Researched 2026-10-21. This is evaluation design, not model acceptance. No additional user transcription is required.

## Recommended source: HiACC adult test

Use the public [Trelis HiACC adult test derivative](https://huggingface.co/datasets/Trelis/hiacc-adult-test-eval), pinned to revision `45782b4752f1e353173cd0b940332a984fc0a249`. Its card declares CC BY 4.0, attributes Shruti Singh’s HiACC corpus, and explicitly reserves this derivative for evaluation rather than training. Preserve attribution. The [original publisher’s Zenodo metadata](https://zenodo.org/api/records/15551669) independently confirms CC BY 4.0 and describes manually transcribed utterances. It provides the complete 531,628,684-byte `Corpus.zip` as a fallback:

- Original: <https://zenodo.org/api/records/15551669/files/Corpus.zip/content>
- Small metadata/reference CSV: <https://huggingface.co/datasets/Trelis/hiacc-adult-test-eval/resolve/45782b4752f1e353173cd0b940332a984fc0a249/manifest.csv>
- Complete derivative with embedded audio, only 75,427,780 bytes: <https://huggingface.co/datasets/Trelis/hiacc-adult-test-eval/resolve/45782b4752f1e353173cd0b940332a984fc0a249/data/adult_test-00000-of-00001.parquet>
- Row API, no parquet dependency: <https://datasets-server.huggingface.co/rows?dataset=Trelis%2Fhiacc-adult-test-eval&config=default&split=adult_test&offset=0&length=100>

Verified API split is `adult_test`, not `eval`. There are 664 rows. Each row includes `id`, `pid` (speaker), `transcription`, `duration_sec`, and `audio[0].src`, a signed WAV download URL. A ranged download returned HTTP 206 and a RIFF/WAVE header. Signed URLs expire; fetch fresh rows when downloading, and save content hashes. The row response exposes its audio revision in the URL; assert that it matches the frozen revision. The pinned parquet is the fallback if viewer revision changes.

A reference-only CSV inspection found 203 rows containing both ASCII letters and Devanagari, with duration 2–20 seconds, distributed over 23 speakers. All 664 rows are at most 16.002 seconds. Select a deterministic, speaker-balanced 50 from those 203 before inference, freeze exact reference strings and hashes, and use whole utterances. No slicing/alignment guess or large archive download is necessary. The mixed-script filter is an operational selection rule, not an independent linguistic annotation.

The [original HiACC paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC12329218/) describes adult/child questionnaire responses, reading and picture prompts, 16 kHz WAV audio and corresponding annotations. This is a conversational diagnostic rather than a recording of a workplace meeting. Public references may contain annotation or spelling errors; retain them unchanged instead of correcting them from model predictions.

## Independence and scoring limits

[Trelis’s model card](https://huggingface.co/Trelis/whisper-hinglish-preview/blob/main/README.md) already reports results on HiACC adult and child evaluation cohorts. Its training disclosure identifies the Whisper-Vaani starting checkpoint but does not provide an exhaustive training manifest or a proof that these public references were never encountered during development. Therefore call this a reproducible public benchmark, not a pristine unseen-model test. Whether the original HiACC train/test split shares speakers also prevents assuming unseen-speaker evaluation; sampling distinct speakers within our subset does not resolve original training overlap.

Freeze NFC plus case-folding and Unicode punctuation removal as the mixed-script normalization before inference. Preserve Devanagari marks/matras/nukta. Do not apply Whisper’s English normalizer, transliterate one side, or rewrite numbers to improve matches. Report strict and normalized corpus WER (total edit distance divided by total reference words), substitutions/deletions/insertions, empty outputs and generation truncation separately. Keep the provisional English 10% gate separate from this mixed-script cohort, whose acceptance ceiling has not been agreed. These scores do not certify speaker attribution, critical-fact fidelity or performance on the private stand-up.

## Fallback: OpenSLR 104

The [official OpenSLR 104 page](https://www.openslr.org/104/) offers Hindi-English spoken-tutorial test audio and reference text, 5.18 hours and a 443 MB archive. Its stated license is **CC BY-SA 4.0**, not CC BY 4.0. This corrects the conflicting simplification in the Srota model documentation. The official page explains that the recipe’s segments supply sentence boundaries aligned to its text. No primary individual-clip endpoint was established in this investigation, so it is less convenient than the 75 MB HiACC derivative for this bounded trial. Use the official test split rather than the 7.3 GB training archive if additional technical-domain testing becomes necessary:

<https://openslr.trmal.net/resources/104/Hindi-English_test.tar.gz>

CoSHE-Eval is not selected because its CC BY-NC 4.0 restriction introduces an avoidable ambiguity for product-directed evaluation. No new model research or translation trial is needed for this benchmark.
