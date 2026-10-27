# Cohere transcription pilot research

Checked 2026-10-19. Research only; no GPU-host changes or benchmark results are implied.

## Access and reproducibility

The public Hub API reports revision `d552dadc2922ba6f6c1f994f8db904d52dcaf942` (modified 2026-10-07), automatic gating, 2,065,804,048 BF16 parameters, and repository storage of 4,132,801,897 bytes. Pin this revision in the pilot manifest. Public metadata access does **not** prove weight-download access. [Official API](https://huggingface.co/api/models/CohereLabs/cohere-transcribe-03-2026)

The repository requires accepting contact-sharing conditions. An individual Hugging Face account must request access through its browser; authenticated scripts then download using that account's token. Use an existing authorized credential if available; do not log tokens or bypass the gate. [Model repository](https://huggingface.co/CohereLabs/cohere-transcribe-03-2026), [Hub access documentation](https://huggingface.co/docs/hub/models-gated)

## Offline runtime

The model card recommends native Transformers >=5.4.0 for offline inference and reports testing with Torch 2.10.0. Dependencies listed are torch, huggingface_hub, soundfile, librosa, sentencepiece, protobuf, and accelerate. Its native quickstart uses `CohereAsrForConditionalGeneration` and `AutoProcessor` without `trust_remote_code`. Prefer that path over the generic page widget's custom-code example. English is selected explicitly with `language="en"`. The model is Apache 2.0 licensed. [Official model card](https://huggingface.co/CohereLabs/cohere-transcribe-03-2026)

Native implementation exists in the pinned Transformers v5.4.0 release. Install the pilot in a separate environment, record resolved dependency versions, and avoid installing/upgrading anything inside the production ASR environment. PyTorch publishes a Torch 2.10.0 CUDA 12.6 wheel option; validate the host driver and the installed wheel's CUDA architecture support before inference. [Native model source](https://github.com/huggingface/transformers/blob/v5.4.0/src/transformers/models/cohere_asr/modeling_cohere_asr.py), [Official PyTorch installation matrix](https://pytorch.org/get-started/previous-versions/)

## Shared T4: a feasibility test, not an established fit

NVIDIA identifies T4 as compute capability 7.5. Turing Tensor Cores support FP16; BF16 Tensor Core support starts at compute capability 8.0. Explicit FP16 loading is the initial experiment, rather than inheriting checkpoint BF16. This establishes a hardware-appropriate test configuration, **not** verified numerical correctness or Cohere compatibility on T4. [GPU capabilities](https://developer.nvidia.com/cuda/gpus), [Turing FP16 documentation](https://docs.nvidia.com/cuda/turing-tuning-guide/index.html), [Precision support table](https://docs.nvidia.com/cuda/cuda-programming-guide/05-appendices/compute-capabilities.html)

Calculated from the API parameter count, 16-bit weights alone occupy about 3.85 GiB. Activations, attention, decoder cache, CUDA libraries, allocator reservations, and loading transients add to this; 11.6 GiB free at one inspection cannot establish safe coexistence. PyTorch distinguishes allocated tensor memory from allocator-reserved memory and documents peak counters. Measure both and sample total device memory plus production health. [Model metadata](https://huggingface.co/api/models/CohereLabs/cohere-transcribe-03-2026), [PyTorch CUDA memory documentation](https://docs.pytorch.org/docs/main/notes/cuda.html#memory-management)

Pilot recommendation: one process, one short clip at a time, inference mode, explicit FP16, bounded output tokens (the official example uses 256), no serving daemon, no GPU saturation experiment. Begin with a short known-reference clip; stop on invalid output, CUDA incompatibility, OOM, or degraded production health. Increase duration only after measuring headroom. Memory caps are an additional guard, not a GPU-compute isolation guarantee. Disk must cover dependencies, checkpoint, download cache, and retained results without exhausting the root filesystem.

## Long audio and timing

The v5.4.0 feature extractor defaults to 35-second maximum chunks and a five-second search window for quiet split points. That window is **not** audio overlap. It returns source-sample/chunk ordinals, not audio offsets, and assembles all chunks as a batch. Therefore a whole-meeting call does not provide bounded batch-one GPU memory. The pilot should explicitly process bounded clips sequentially and preserve its own source offsets. [Pinned extractor source](https://github.com/huggingface/transformers/blob/v5.4.0/src/transformers/models/cohere_asr/feature_extraction_cohere_asr.py)

Cohere provides neither timestamps nor speaker diarization. Separate participant channels and externally retained clip offsets can provide speaker identity and coarse segment timing; word alignment is additional work. Silence can induce hallucinations; include silence/noise checks and evaluate VAD. Single prespecified languages are the intended use; mixed-language behavior is inconsistent. [Official limitations](https://huggingface.co/CohereLabs/cohere-transcribe-03-2026#limitations)

## Independent expectations and pilot data

Use a small AMI meeting subset with **manual**, not automatic, annotations as the reference. AMI provides synchronized close-talk/far-field audio and orthographic transcripts. The download page offers individual headset channels, a headset mix, and manual annotations v1.6.2; signals and transcription are CC BY 4.0. Preserve attribution, meeting IDs, channels, timestamps, and reference extraction/normalization rules in the manifest. [Corpus overview](https://groups.inf.ed.ac.uk/ami/corpus/), [Official downloads and license](https://groups.inf.ed.ac.uk/ami/download/)

LibriSpeech is CC BY 4.0 read English speech, useful for an installation/recognition smoke check but insufficient evidence for meeting quality. AMI is also a published evaluation dataset for Cohere, so it is an independent human reference, **not** evidence of unseen training data. Final acceptance needs representative authorized Meet recordings with independently checked transcripts. [LibriSpeech source](https://www.openslr.org/12/), [Cohere evaluation table](https://huggingface.co/CohereLabs/cohere-transcribe-03-2026#results)

Record WER with frozen normalization, raw hypotheses, substitutions/deletions/insertions, names, overlapping speech, silence hallucinations, generation truncation, wall time, audio duration, cold-load time, peak memory, and before/after production health. Report audio-seconds processed per wall-second separately from meeting throughput: separate speaker channels can multiply audio volume. Smoke success alone does not settle model selection, hardware sizing, or quality thresholds.

## Small reproducible AMI input

Verified direct downloads: [ES2004a headset channel 0](https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus/ES2004a/audio/ES2004a.Headset-0.wav) (33,579,394 bytes) and [manual annotation archive v1.6.2](https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/ami_public_manual_1.6.2.zip) (22,887,865 bytes). Archive SHA-256: `b56e5babb2496b8795deeeda7e71178d7fbc9963f94276cf2a3f4b56ebbc9f9d`. Keep downloaded media and reference text outside git. The [Kaldi AMI evaluation split](https://github.com/kaldi-asr/kaldi/blob/master/egs/ami/s5/local/split_eval.orig) includes ES2004a; this tiny subset is not the full benchmark.

Inspected archive metadata `corpusResources/meetings.xml` maps ES2004a channels 0/1/2/3 to agents A/B/C/D. For channel 0 use `words/ES2004a.A.words.xml` and `segments/ES2004a.A.segments.xml`. Resolve each segment's NITE child `href` inclusive word-ID range against the words file. Use segment `transcriber_start`/`transcriber_end` as audio boundaries, without padding. Select segments lasting 2–15 seconds inclusive with at least five nonempty `w` nodes whose `punc` attribute is not `true`, in chronological order, taking at most 12. **Only nine segments qualify**, so this recipe freezes nine rather than silently relaxing criteria. Selection was performed before model inference, without listening verification.

| Segment suffix | Start (s) | End (s) | Word nodes | Inclusive node suffixes |
| --- | ---: | ---: | ---: | --- |
| sync.31 | 284.816 | 287.360 | 5 | words43–48 |
| sync.33 | 289.072 | 296.176 | 14 | words49–67 |
| sync.37 | 312.984 | 322.112 | 19 | words70–94 |
| sync.45 | 364.336 | 368.077 | 7 | words174–182 |
| sync.53 | 576.454 | 581.547 | 19 | words190–210 |
| sync.65 | 708.486 | 711.040 | 8 | words228–237 |
| sync.69 | 754.938 | 758.268 | 8 | words240–248 |
| sync.79 | 815.216 | 819.161 | 7 | words332–340 |
| sync.91 | 950.694 | 959.392 | 27 | words352–382 |

Reference extraction retains lexical fillers and truncated `w` tokens, excludes punctuation nodes and non-word events such as `vocalsound` and `gap`, and joins words with spaces. The executed pilot froze a different normalization policy from the initial research suggestion: Unicode casefold, remove characters other than regex word characters, whitespace, and straight apostrophes, then split whitespace. It does not apply NFKC or remove lexical fillers. Use that same frozen policy for both models in the comparison; do not tune it after seeing hypotheses. Preserve raw reference and hypothesis privately alongside normalized forms. Close-talk channels can contain crosstalk absent from that speaker's reference; inspect errors rather than treating this tiny WER as meeting-wide quality.

For the broader sample, the [publisher's AMI dataset mirror](https://huggingface.co/datasets/edinburghcstr/ami) provides English IHM speech and reference text under CC BY 4.0. The executed pilot froze the first 20 qualifying rows from test-set pages at offsets 0, 5000, and 10000, requiring 2–15 seconds and at least five reference words. This produced 60 clips from EN2002a, EN2002d, and TS3003a, covering seven speaker IDs. Raw publisher API pages, selection, media hashes, and references remain in private pilot storage. Publisher references were not independently listen-checked in this pilot.

An optional [HF-published LibriSpeech smoke parquet](https://huggingface.co/datasets/hf-internal-testing/librispeech_asr_dummy/resolve/5be91486e11a2d616f4ec5db8d3fd248585ac07a/clean/validation-00000-of-00001.parquet) is ungated, 9,192,059 bytes, with 73 audio/text rows. `pyarrow.parquet.read_table(path).to_pylist()[0]` exposes embedded `audio.bytes` and `text`; decode bytes with SoundFile to avoid dataset decoder dependencies. The fixture card omits licensing/provenance detail; retain original LibriSpeech attribution and treat it as a library smoke fixture, not a primary meeting benchmark. [Fixture metadata](https://huggingface.co/api/datasets/hf-internal-testing/librispeech_asr_dummy), [Original corpus license](https://www.openslr.org/12/)
