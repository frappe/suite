# Stronger multilingual pilot candidates

Research date: 2026-10-20. This note records primary-source facts and a bounded experiment recommendation. It contains no private meeting speech and reports no new inference results.

## Recommendation

Run two sequential experiments: Qwen3-8B as a text renderer using native Transformers with NF4 weights and FP16 computation, and Whisper large-v3 using its upstream beam-search/fallback decoding rather than the earlier diagnostic greedy configuration. Keep source recognition and English rendering results separate. Neither larger parameter count nor a multilingual model card establishes fidelity on Hindi-English meeting speech.

The supplied operational budget is 11,897 MiB free with a required 3,072 MiB reserve: at most 8,825 MiB incremental device consumption. This is an experimental ceiling, not an allocation promise. Run one candidate at a time, batch size one, bounded inputs/outputs, with the existing external health/headroom supervisor. Do not co-load ASR and renderer or alter production to make a candidate fit. Approximate raw 4-bit weight arithmetic excludes unquantized layers, quantization metadata, activations, cache, CUDA context and temporary loading buffers.

## Qwen3-8B rendering experiment

The official model is Apache-2.0, has 8.2B parameters and supports multilingual instruction-following/translation. It exposes a hard nonthinking switch through `enable_thinking=False` in the chat template. The card recommends temperature 0.7, top-p 0.8, top-k 20 and min-p 0 for that mode; using deterministic greedy decoding would be a separate configuration. This is a text model, so it cannot recover speech absent from its input. The card does not establish preservation of meeting questions, corrections or dates. [Official model card](https://huggingface.co/Qwen/Qwen3-8B).

Pin revision `b968826d9c46dd6066d109eabc6255188de91218`, observed through the first-party Hub API. Its configuration identifies native `Qwen3ForCausalLM`/`qwen3`, 36 layers, eight KV heads and BF16 source weights. Its shipped generation defaults describe thinking-mode sampling, so override them explicitly when testing nonthinking mode. [Hub metadata](https://huggingface.co/api/models/Qwen/Qwen3-8B), [pinned model configuration](https://huggingface.co/Qwen/Qwen3-8B/blob/b968826d9c46dd6066d109eabc6255188de91218/config.json), [pinned generation configuration](https://huggingface.co/Qwen/Qwen3-8B/blob/b968826d9c46dd6066d109eabc6255188de91218/generation_config.json).

Suggested isolated configuration:

```python
quantization_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_use_double_quant=True,
    bnb_4bit_compute_dtype=torch.float16,
)
model = AutoModelForCausalLM.from_pretrained(
    pinned_local_model_path,
    local_files_only=True,
    trust_remote_code=False,
    quantization_config=quantization_config,
    dtype=torch.float16,
    device_map={"": 0},
    attn_implementation="sdpa",
)
```

NF4, configurable compute dtype and double quantization are supported Transformers/bitsandbytes integration options. Explicit FP16 computation and nonquantized-module dtype avoid silently selecting the checkpoint's BF16 dtype. Double quantization reduces quantization metadata; it does not guarantee fidelity or a particular total memory footprint. [Transformers bitsandbytes integration](https://huggingface.co/docs/transformers/quantization/bitsandbytes).

Pin bitsandbytes 0.48.1 rather than an unversioned latest release. Its official requirements include Python 3.9+ and PyTorch 2.3+; Linux x86-64 CUDA 12.8–12.9 wheels include `sm75`, and NF4 supports compute capability 6.0+. Thus the supplied Python 3.11/Torch 2.8 CUDA 12.8/T4 stack is plausible for an isolated smoke test. These component requirements do **not** certify the exact Transformers 5.19/runtime combination. Test library import, one small quantized forward/generation, EOS handling and measured headroom before the meeting cases. Do not replace production libraries. [Versioned bitsandbytes installation matrix](https://huggingface.co/docs/bitsandbytes/v0.48.1/installation).

Freeze prompt, model revision, dependency versions, quantization settings and seeds before looking at outputs. Suggested bounded run: prompt at most 1,536 tokens, at most 384 generated tokens, seeds 4171/4172/4173, and the card's nonthinking sampling settings. A capped or unfinished output fails completeness; never silently truncate it into a finished transcript. Repeated seeds expose instability but do not create independent human references. Test on both checked ASR text and synthetic controls, distinguishing inherited recognition errors from rendering changes.

## Whisper decoding comparison

Upstream CLI defaults use beam size five at temperature zero and best-of five when sampling. Temperature fallback increments by 0.2 from zero through one. The transcribe function defaults to compression-ratio threshold 2.4, average-log-probability threshold −1.0, no-speech threshold 0.6, and conditioning on previous text. Fallback removes beam search at positive temperatures; at zero it removes best-of. Language auto-detection uses the first available 30 seconds. `translate` targets English; `transcribe` preserves source-language speech. These defaults differ materially from a greedy run with disabled fallback/thresholds. Compare both tasks on identical frozen audio and save segment probabilities, fallback temperatures, completeness and semantic errors. More search cannot be assumed to repair the previously missing date. Translated word timestamps receive an upstream reliability warning. [Official transcribe implementation and CLI](https://github.com/openai/whisper/blob/main/whisper/transcribe.py).

A library-level `decode` call and the CLI's `transcribe` orchestration are different entry points; do not label arbitrary `generate` beam settings as an exact reproduction of upstream fallback. Pin the source revision/package actually run and report any deviations, including token caps and independent clip boundaries. [Official decoding implementation](https://github.com/openai/whisper/blob/main/whisper/decoding.py).

### Native runtime pin and checkpoint

For an exact upstream implementation, pin source commit `86098128c0b4f24f0e2aa2994de830614b474227` (observed `main`; package version field `20250625`) rather than resolving `main` at execution time. Its manifest requires Python 3.8+, more-itertools, numba, numpy, tiktoken, torch, tqdm, and Triton 2+ on Linux x86-64. The upstream manifest does not fully pin these dependencies: record the resolved isolated-runtime versions. FFmpeg is needed for filename-based decoding; supplying already frozen waveform arrays avoids a separate decoding change. Tiktoken uses packaged tokenizer assets, so package those for offline execution. [Pinned dependency manifest](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/pyproject.toml), [version field](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/version.py), [audio loader](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/audio.py), [tokenizer assets loader](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/tokenizer.py).

The official checkpoint URL is [large-v3.pt](https://openaipublic.azureedge.net/main/whisper/models/e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb/large-v3.pt). Expected SHA256: `e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb`. The official loader takes this hash from the URL and verifies the downloaded bytes. An existing Hugging Face safetensors cache is a different file representation and cannot be passed to this loader as that checkpoint. [Pinned checkpoint registry and hash verification](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/__init__.py).

## Alternatives considered

### HY-MT1.5-7B

Revision `397085d46158ad0b437ffd74228499e8c2a35c76` is ungated in the Hub metadata. Its native architecture is `HunYuanDenseV1ForCausalLM`, model type `hunyuan_v1_dense`; source config uses BF16 and dynamic RoPE fields. NF4/FP16 remains an integration experiment, not a verified T4 result. [Hub metadata](https://huggingface.co/api/models/tencent/HY-MT1.5-7B), [pinned configuration](https://huggingface.co/tencent/HY-MT1.5-7B/blob/397085d46158ad0b437ffd74228499e8c2a35c76/config.json).

The model card lists Hindi and English, documents a plain translation instruction without a default system prompt, and recommends temperature 0.7, top-k 20, top-p 0.6 and repetition penalty 1.05. Note the shipped generation configuration has top-p 0.8; record the chosen value explicitly. [Official model card](https://huggingface.co/tencent/HY-MT1.5-7B), [pinned generation configuration](https://huggingface.co/tencent/HY-MT1.5-7B/blob/397085d46158ad0b437ffd74228499e8c2a35c76/generation_config.json).

The Tencent HY Community License excludes the EU, UK and South Korea from its territory, restricts using outputs/results to improve other AI models, and imposes distribution/service obligations. These explicit terms make it a poor default for an unrestricted global Suite deployment; technical fit would not remove them. This is a factual license screen, not legal clearance. Do not expand the bounded pilot to another large download unless there is a concrete reason to prefer this path. [Official license](https://huggingface.co/tencent/HY-MT1.5-7B/blob/397085d46158ad0b437ffd74228499e8c2a35c76/License.txt).

### IndicTrans2 Indic→English

The 1.1B Indic-English model is MIT-tagged but gated: downloading requires accepting conditions and sharing Hugging Face account information. Its example uses `hin_Deva`→`eng_Latn`, custom model/tokenizer code, IndicProcessor preprocessing/postprocessing, FP16 and beam size five. This provides a focused Hindi translation alternative with lower raw weight requirements. It does not establish correctness for interleaved Hindi-English or phonetic English in Devanagari. Preserve embedded English and numbers in independent tests rather than assuming Hindi-only preprocessing handles them. [Official model card and usage](https://huggingface.co/ai4bharat/indictrans2-indic-en-1B).

Observed revision: `ac3daf0ecd37be3b6957764a9179ab2b07fa9d6a`. No gated weight/config access was attempted. The repository describes translation across India's 22 scheduled languages; this scope is distinct from speech recognition and from a code-switch guarantee. It adds toolkit/custom-code integration work, so keep it a later diagnostic candidate rather than blocking the current Qwen/Whisper experiment. [Hub metadata](https://huggingface.co/api/models/ai4bharat/indictrans2-indic-en-1B), [official repository](https://github.com/AI4Bharat/IndicTrans2).

### Direct speech→English specialist

SeamlessM4T v2 large is 2.3B and supports speech-to-text translation; Hindi speech input and English text output are listed. However, its official license is CC-BY-NC-4.0. It is therefore not a straightforward commercial product candidate despite attractive architecture/size. No new weights or inference were requested for it. [Official model card](https://huggingface.co/facebook/seamless-m4t-v2-large).

## Acceptance interpretation

Passing the checked short examples is a regression prerequisite, not a release gate by itself. Compare question versus assertion, uncertainty, correction order, dates/amounts, conditions/negation, technical terms and omitted speech against the independent listening reference. Do not score a faithful translation with English-only WER against its Hindi source. A fluent renderer that reverses meaning fails even when literal keyword checks pass. Human review of longer Hindi-English passages remains necessary before selecting a production pipeline.

## Follow-up: Qwen2.5-Omni-7B direct audio candidate

Decision: exclude from this bounded pilot. Its architecture offers a legitimate direct audio→text path, but the official material checked does not establish Hindi speech recognition/translation support. Reported ASR evaluations include English, Chinese, Cantonese and French; reported speech-translation directions are English↔German and English↔Chinese. This is insufficient evidence to prioritize it for the Hindi-English failure under investigation; absence of a documented Hindi claim does not prove Hindi is impossible. [Official model card](https://huggingface.co/Qwen/Qwen2.5-Omni-7B), [technical report](https://arxiv.org/html/2503.20215v1).

Observed model revision `ae9e1690543ffd5c0221dc27f79834d0294cba00` is ungated. Hub metadata labels the license `other` with name `apache-2.0`; the pinned LICENSE contains Apache-2.0. [Hub metadata](https://huggingface.co/api/models/Qwen/Qwen2.5-Omni-7B), [pinned license](https://huggingface.co/Qwen/Qwen2.5-Omni-7B/blob/ae9e1690543ffd5c0221dc27f79834d0294cba00/LICENSE).

Transformers explicitly supports loading `Qwen2_5OmniThinkerForConditionalGeneration` directly for text output without loading the Talker/audio-generation model. This is preferable to loading the entire model and disabling speech afterward when transient memory matters. [Official Transformers usage](https://huggingface.co/docs/transformers/model_doc/qwen2_5_omni).

Version 5.19 source confirms the native Thinker class and `base_model_prefix="thinker"`. Its constructor still creates `audio_tower`, `visual`, the text decoder and `lm_head`: audio-only input does **not** avoid vision weights. SDPA support is declared by the model and audio encoder, with eager attention implementations available; this makes T4 SDPA/FP16 technically plausible without FlashAttention2. Native NF4 integration on this exact multimodal stack would still need an isolated smoke test. Neither source support nor the smaller text-only output path promises a fit inside the 8,825 MiB incremental budget. [Pinned Transformers model implementation](https://github.com/huggingface/transformers/blob/v5.19.0/src/transformers/models/qwen2_5_omni/modeling_qwen2_5_omni.py).

The full checkpoint index records approximately 22.37 billion bytes of tensor storage across Thinker, Talker and token2wav; that is not the quantized Thinker runtime footprint. Thinker configuration includes a 28-layer, 3,584-wide text decoder, a 32-layer, 1,280-wide audio encoder and a separate 32-layer vision encoder. A dense FP16 Thinker is unsuitable for the available budget; estimating NF4 using only the “7B” name would omit important components and unquantized embedding/output layers. [Pinned checkpoint index](https://huggingface.co/Qwen/Qwen2.5-Omni-7B/blob/ae9e1690543ffd5c0221dc27f79834d0294cba00/model.safetensors.index.json), [pinned model configuration](https://huggingface.co/Qwen/Qwen2.5-Omni-7B/blob/ae9e1690543ffd5c0221dc27f79834d0294cba00/config.json).

For a future isolated probe, raw frozen 16 kHz mono arrays can be passed with `audio=` directly to the processor; audio/video URL utilities and decord are unnecessary for that path. The processor forces maximum-length audio padding. Its checkpoint preprocessor defaults to 300 seconds/4,800,000 samples and 128 mel features, so explicitly bound the feature extractor's maximum length and verify masks rather than assuming short audio implies short padding. Native Whisper feature extraction uses NumPy/Torch STFT; separate audio-file loading dependencies depend on the chosen decoder. [Processor implementation](https://github.com/huggingface/transformers/blob/v5.19.0/src/transformers/models/qwen2_5_omni/processing_qwen2_5_omni.py), [pinned preprocessor configuration](https://huggingface.co/Qwen/Qwen2.5-Omni-7B/blob/ae9e1690543ffd5c0221dc27f79834d0294cba00/preprocessor_config.json), [feature extraction implementation](https://github.com/huggingface/transformers/blob/v5.19.0/src/transformers/models/whisper/feature_extraction_whisper.py).

No Omni weights were downloaded and no Omni inference was performed for this research.
