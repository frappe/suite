# Voxtral transcription candidates

Research date: 2026-10-21. Primary-source screening only; no weights downloaded, meeting audio uploaded, inference run, or GPU changes made.

## Recommendation

Voxtral is worth adding to the shortlist, but distinguish yesterday's Voxtral 3 release from the older publicly downloadable models. For the latest models, first establish access to a self-deployed artifact, its commercial terms, and its supported hardware. The official announcement offers on-premises/private-cloud deployment through Mistral's team; this is not evidence of public Apache weights. The hosted API is outside this pilot's self-hosted-only requirement. [Voxtral 3 announcement](https://mistral.ai/news/voxtral-3/).

No Voxtral variant is accepted for Meet yet. Multilingual scores do not establish within-sentence Hindi-English accuracy, original-language preservation, faithful English rendering, or Indian-accent meeting performance.

## Latest release: Voxtral 3

The official lifecycle records October 20, 2026 for Small Transcribe 3, Mini Transcribe 3, and Mini Transcribe Realtime 3. Small and Mini target recorded files; Realtime targets live streams. The launch describes Mini as 4B parameters and Small as the higher-quality transcription option. [Lifecycle](https://legal.mistral.ai/ai-governance/models/voxtral-3/), [model selection](https://docs.mistral.ai/studio/audio/speech-to-text/overview), [announcement](https://mistral.ai/news/voxtral-3/).

Mistral reports broad multilingual gains over competing systems. Its realtime FLEURS comparison explicitly includes Hindi and English among 35 evaluated languages. This is vendor-reported evidence on separate benchmark languages, not a Hinglish result. No explicit within-sentence code-switching guarantee, original Hindi-script/English-script policy, or Indian-accent meeting cohort was found in the checked sources. [Announcement and benchmark description](https://mistral.ai/news/voxtral-3/).

Voxtral 3 supports context biasing; offline mode allows phrases and free-form context. This could fit the accepted built-in Frappe vocabulary plus automatic room/participant hints, without a manual site glossary. It remains an experiment: hints must not invent speech. Segment timestamps are supported offline, but word timestamps have been removed. These features may differ in a contracted self-hosted deployment and must be confirmed there. [Migration guide](https://docs.mistral.ai/studio/audio/migrate-from-voxtral-2).

Publicly checked model pages are marked Public Preview/Premier. The announcement directs full on-premises/private-cloud users to Mistral's team. The checked official Hugging Face collection lists older models, not a Voxtral 3 transcription checkpoint. Consequently, public weights, exact self-host license, Small parameter count, deployment image, quantization support, and minimum GPU memory remain unverified; do not call Voxtral 3 API-only or assume it inherits Apache-2.0 from older Voxtral releases. [Small model page](https://docs.mistral.ai/models/voxtral-small-transcribe-3-0), [Mini model page](https://docs.mistral.ai/models/voxtral-mini-transcribe-3-0), [official collection](https://huggingface.co/collections/mistralai/voxtral), [deployment offer](https://mistral.ai/news/voxtral-3/).

### Translation is unresolved at launch

The Small Transcribe 3 model description claims translation, speech Q&A, summarization and function calling. However, the current audio overview says Small is transcription-only at launch, and the speech-to-text chooser sends translation to `voxtral-small-latest`, explicitly labeled Voxtral 2. Treat this documentation conflict as unresolved rather than promising that Transcribe 3 produces both Meet artifacts. [Small description](https://docs.mistral.ai/models/voxtral-small-transcribe-3-0), [audio overview](https://docs.mistral.ai/studio/audio/overview), [STT chooser](https://docs.mistral.ai/studio/audio/speech-to-text/overview).

The chat documentation describes requesting original and translated sections, without timestamps, and warns that chat answers can rephrase instead of quoting verbatim. That is a possible research interface, not evidence that our two-artifact fidelity contract is met. [Audio in chat](https://docs.mistral.ai/studio/audio/audio-in-chat).

## Public-weight alternative: Voxtral Mini 4B Realtime 2602

The official checkpoint is Apache-2.0 and BF16. It supports Hindi and English among 13 languages. It is a causal streaming recognizer rather than a documented general translation/chat replacement. The official table reports Hindi FLEURS WER of 12.88% at 480 ms delay and 10.73% at 2,400 ms; neither number is a Hindi-English meeting score or comparable to our provisional English normalized-WER gate. [Official model card](https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602).

The card recommends vLLM, also documents native Transformers from 5.2.0, and states at least 16 GB GPU memory for the BF16 deployment. It contains an older contradictory sentence saying only vLLM supports the model; the later explicit Transformers section is the current actionable claim. Temperature 0.0 is recommended. [Deployment and settings](https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602).

Our last measured production-sharing T4 budget was 11,897 MiB free, with a required 3,072 MiB reserve, leaving 8,825 MiB incremental consumption for an isolated experiment. This is below the official recommended deployment envelope. Turing's Tensor Cores support FP16; native BF16 Tensor Core support arrives with Ampere. An FP16 or quantized Transformers path would therefore need a bounded compatibility/headroom check; weight size alone cannot establish fit or production coexistence. No such Voxtral check has run. [NVIDIA architecture comparison](https://docs.nvidia.com/cuda/archive/12.6.0/ampere-tuning-guide/index.html), [local budget evidence](stronger-multilingual-pilot-research.md).

## Older public-weight alternative: Voxtral Mini 3B 2507

This Apache-2.0 audio-language model explicitly supports Hindi and English, automatic source-language detection, transcription and translation. The official card states approximately 9.5 GB GPU RAM in BF16 or FP16, 32k context, and up to 30 minutes of transcription or 40 minutes of audio understanding. It is a distinct July 2025 model, not the latest Mini Transcribe 3. Its default transcription mode is a plausible Original Transcript experiment, and its instruction interface a separate English-rendering experiment; neither is validated on our speech. Its stated memory use also exceeds the current experiment budget before allowing margin. [Official model card](https://huggingface.co/mistralai/Voxtral-Mini-3B-2507).

## Next evidence needed

For Voxtral 3, resolve the exact self-hosted distribution, commercial license, supported GPU/dtype, and launch-time translation interface before scheduling inference. For a public-weight pilot, select either 2602 for recognition or 2507 for recognition plus an independent translation experiment only after identifying a safe runtime configuration. Use the checked short sample as a regression case, then independently checked longer Hindi-English passages. Judge source-language preservation and English meaning separately, including questions, dates, negation, uncertainty, technical terms, omitted speech and silence. The uncertain opening word in the current human reference must remain excluded from factual error claims. Keep existing production ASR unchanged.
