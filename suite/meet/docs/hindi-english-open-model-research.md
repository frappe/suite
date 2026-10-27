# Downloadable Hindi-English ASR candidates

Research date: 2026-10-21. Research only: no weights downloaded, meeting audio uploaded, inference run, or production configuration changed. Existing failed base Qwen/Whisper configurations remain rejected; a trained derivative is a distinct candidate, not evidence that those configurations work.

## Recommendation

Prioritize **Srota union (`moorlee/qwen3-asr-0.6b-hinglish`)** for one bounded source-recognition trial. Its published training targets address our actual failure: preserving Hindi in Devanagari and English in Latin. This is a trial recommendation, not model acceptance. English rendering remains a separate, unaccepted stage.

### Srota

The publisher describes a full-model fine-tune of `Qwen/Qwen3-ASR-0.6B`, approximately 780M parameters including audio encoder, targeting mixed scripts. Both derivative and base are Apache-2.0. Public ungated safetensors are listed; checkpoint `188ae2b61f932feb998e3b3c7a868e927a467031`, one 1,564,926,456-byte weight file. This is a complete checkpoint, not an API-only offering. [Model card](https://huggingface.co/moorlee/qwen3-asr-0.6b-hinglish), [base](https://huggingface.co/Qwen/Qwen3-ASR-0.6B), [metadata](https://huggingface.co/api/models/moorlee/qwen3-asr-0.6b-hinglish?blobs=true)

Publisher WER is 15.85% conversational HiACC and 35.06% tutorial OpenSLR-104. HiACC splits share speakers; these are not unseen-speaker meeting results. Dense technical vocabulary remains difficult. Training combines conversational and tutorial corpora; pure-English/pure-Hindi production use is explicitly outside recommendation. Use the original `qwen_asr==0.0.6` wrapper, automatic `language=None`, and preserve its trained language-agnostic prefix. Do not substitute forced Hindi or assume native Transformers checkpoint compatibility. No translation capability is established. [Training, evaluation and limitations](https://huggingface.co/moorlee/qwen3-asr-0.6b-hinglish#-evaluation)

## Alternatives screened

### Trelis Whisper Hinglish Preview — backup with routing caveat

`Trelis/whisper-hinglish-preview` is an ungated Apache-2.0 Whisper-large-v3 derivative starting from ARTPARK's Vaani Hindi checkpoint. Its public two-shard weights total 6,174,117,192 bytes, F32, at `eab1188fd2d0e91f2584229b32b3bfe1901c896c`. Card ancestry metadata inconsistently mentions Whisper-small; the narrative and actual config should be reconciled before loading. [Card](https://huggingface.co/Trelis/whisper-hinglish-preview), [files metadata](https://huggingface.co/api/models/Trelis/whisper-hinglish-preview?blobs=true), [Vaani starting checkpoint](https://huggingface.co/ARTPARK-IISc/whisper-large-v3-vaani-hindi)

It explicitly trains mixed-script output and documents a `<|mixedcode|>` decoder marker. Publisher internal WER: CoSHE-500 conversational code-switching 13.67%, accented adult HiACC 12.73%, read code-switched FLEURS 10.19%; these differ from Srota's splits/protocols and cannot rank them directly. Preview weights/results may change. Published inference requires dominant-language selection, so automatic meeting use remains unverified. BF16 example needs conversion to FP16 for T4. ASR fine-tuning does not establish preserved English-translation quality. [Evaluation and inference](https://huggingface.co/Trelis/whisper-hinglish-preview#evaluation)

### Orato Hindi v1 — exclude as production default

`tryorato/orato-asr-hindi-v1` is a gated approximately 0.8B Qwen derivative, trained on approximately 1,000 hours of Hindi/Hinglish calling audio; decoder/projector updated, audio encoder frozen. Despite Apache-2.0 metadata, the card explicitly limits release to internal/beta evaluation while commercial dataset rights and proprietary consent/PII review are unfinished. That blocks recommending it for production. Its cross-vendor benchmark combines different published protocols; the card does not establish mixed-script code-switch meeting fidelity. It requires `qwen_asr`, not plain `AutoModel`. [Publisher model card and data-rights limitation](https://huggingface.co/tryorato/orato-asr-hindi-v1)

### Shunya Zero STT Hinglish — promising script target, unresolved license

`shunyalabs/zero-stt-hinglish` is an ungated Whisper-medium derivative with mixed-script examples and meeting-transcription intended use. Its FP16 checkpoint is 1,527,827,760 bytes at `93b882ac4f1d470d910ef8e1e48d44d51a439cc6`. Card metadata says `openrail`, but the listed repository files contain no standalone license text: exact use restrictions remain unverified. The sample code names a different repository, requiring correction. No quantitative held-out code-switch benchmark is supplied. The underlying Whisper-medium base has MIT terms; this does not replace the derivative's unspecified OpenRAIL terms. Do not treat generic OpenRAIL metadata as Apache/MIT permission. [Card](https://huggingface.co/shunyalabs/zero-stt-hinglish), [files metadata](https://huggingface.co/api/models/shunyalabs/zero-stt-hinglish?blobs=true), [base](https://huggingface.co/openai/whisper-medium)

### IndicConformer, IndicWhisper and Vaani — Hindi support alone is insufficient

`ai4bharat/indic-conformer-600m-multilingual` is MIT, gated, custom-code CTC/RNNT, and supports 22 Indian languages with explicit language selection; English is absent from its supported-language list. Its card does not establish English-Latin/Hindi-Devanagari code-switch output and recommends a newer Indic-Transcribe model. Do not infer a mixed-script capability from multilingual coverage. [Official card](https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual)

AI4Bharat's IndicWhisper/Vistaar work covers broad language/domain benchmarks. Those Hindi WERs do not by themselves establish our mixed-script meeting requirement. [Official research repository](https://github.com/AI4Bharat/vistaar)

`ARTPARK-IISc/whisper-large-v3-vaani-hindi` is public Apache-2.0, approximately 718 hours Hindi fine-tuning, standard Transformers inference with forced Hindi. Its reported Hindi/MUCS scores do not identify a mixed-script code-switch evaluation protocol. `ARTPARK-IISc/Vaani-FastConformer-Hindi` is gated MIT/NeMo RNNT; the accessible card likewise lacks a mixed-script benchmark. These are weaker next-trial justifications than explicitly code-switch-trained Srota. [Whisper Vaani](https://huggingface.co/ARTPARK-IISc/whisper-large-v3-vaani-hindi), [FastConformer](https://huggingface.co/ARTPARK-IISc/Vaani-FastConformer-Hindi)

Sorika Labs' separate `sorika-labs/vaani2-flash` is Apache-2.0 Whisper-turbo, approximately 809M parameters/1.62GB FP16. Its published table covers English and Hindi separately; native Hinglish normalization is listed as a future revision goal. Do not conflate this publisher's Vaani brand with IISc's Vaani models/corpus or treat generic Hindi averages as code-switch evidence. [Publisher card](https://huggingface.co/sorika-labs/vaani2-flash)

## Bounded trial protocol

The existing operational ceiling is 8,825 MiB incremental GPU memory on the shared T4, subject to a fresh baseline. Approximately 1.5GB checkpoint size suggests Srota/Whisper-medium-class candidates are plausible; this is a weight-storage calculation, **not** measured peak VRAM or proof of safe coexistence. Test FP16, SDPA, batch one, short frozen clips, bounded generation; do not use BF16/FlashAttention-2 examples unchanged on T4. Srota metadata identifies BF16 `qwen3_asr` / `Qwen3ASRForConditionalGeneration`, no repository Python files, and no `auto_map`; its original-wrapper format still needs explicit compatibility preflight against our installed runtime. Pin and review model/wrapper code and dependencies before loading; use offline isolated inference and existing health/memory supervisor. No production package changes or live traffic experiments.

Evaluate Srota source recognition first against already frozen clips: English controls plus checked Hindi-English windows. Keep unintelligible spans unscored, uncertain opening words excluded, duplicate references deduplicated, exposure status retained. Check question form, negation, dates, Atlas/signup responsibility, pricing/model-choice vocabulary and script fidelity independently. Do not convert Romanized human references into guessed Devanagari to manufacture WER; establish script-safe normalization/reference adjudication before mixed-language scoring. Published scores above are not the provisional 10% English gate and do not imply meeting acceptance.

Only if recognition improves should the unchanged English renderer be assessed against the corrected source, separately distinguishing recognition loss from translation loss. No evaluated candidate has yet passed either the full transcript contract or production readiness.
