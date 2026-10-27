# Script control and short-segment translation

Checked 2026-10-21. This note supports one bounded configuration experiment; it does not establish model quality or production readiness.

## Qwen3-ASR source-script experiment

The official `Qwen/Qwen3-ASR-1.7B-hf` card documents Hindi and English recognition and an optional `prompt` containing free-form context. Its examples use vocabulary biasing. It does not promise that instructions can enforce Hindi Devanagari alongside English Latin in a code-switched utterance. A generic script-preservation prompt is therefore an experiment, not a documented correction mechanism. [Official model card](https://huggingface.co/Qwen/Qwen3-ASR-1.7B-hf/blob/main/README.md)

The Transformers processor puts `prompt` into a system message. With `language=None`, it leaves language prediction to the model; a forced language instead prefills the assistant output with a single language marker. There is no separately documented per-word script selector in this API. Keep automatic language selection for this test. Forcing English would change the requested source-language behavior and cannot demonstrate faithful Hindi-English preservation. The processor's parsed output also applies repetition correction, so preserve raw output alongside parsed text when inspecting omissions. [Processor implementation](https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen3_asr/processing_qwen3_asr.py)

Use the same audio and decoding settings for baseline and generic-prompt output. Do not insert checked words, expected names, translations, or clip-specific corrections into the prompt. Judge English words written in Latin and Hindi words written in Devanagari separately from recognition fidelity: visually correct scripts do not establish correct words or meaning. These are experiment controls, not claims about supported model behavior.

## Native Whisper translation experiment

Whisper supports speech-to-English translation as a distinct task and normally processes audio in sliding 30-second windows. Short independent calls are a different context configuration, not a new checkpoint. [Official repository](https://github.com/openai/whisper)

The native `transcribe` implementation detects one language from up to the first 30 seconds when no language is supplied. Fresh calls therefore repeat detection on each short input. Disabling `condition_on_previous_text` stops previous-window text conditioning; upstream warns this can reduce repetition loops while making adjacent-window output less consistent. Translation word timestamps are explicitly warned to be unreliable. [Native implementation](https://github.com/openai/whisper/blob/main/whisper/transcribe.py)

Inference: independent 5- or 10-second windows could reduce inherited decoding errors but can also cut a word, question, negation, condition, or correction across a boundary and remove useful context. Do not silently repair missing clauses, deduplicate substantive repetitions, or treat model timestamps as checked subtitle alignment. Compare each configuration with the same full checked audio span and inspect concatenated chronological output for boundary loss. Unclear human spans stay unscored; no mixed-language WER should be inferred from an English meaning reference or an unstandardized Romanized Hindi reference.

## Decision boundary

Continue only if the bounded test preserves checked substantive content and source languages without critical inventions. A successful formatting change alone cannot accept the pipeline. Failed short-window translation does not prove all segmentation is unsuitable, and failed prompt control does not prove all Qwen configurations fail; both would justify stopping this particular tuning attempt rather than claiming an untested fix.
