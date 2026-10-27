# ASR leaderboard candidates for Meet

Research date: 2026-10-19. Research only; no model downloaded, installed, or run for this note.

The [subsequent measured comparison](transcription-challenger-results.md) tests Qwen and Granite on the frozen pilot inputs and adds a common-normalization diagnostic.

## Recommendation

Test **Qwen3-ASR-1.7B-HF** as the next quality challenger and **Granite Speech 5.0 470M TurboCTC** as the next efficiency challenger. Keep Cohere as the measured reference. Neither leaderboard establishes a replacement for Cohere on Meet audio. Parakeet TDT v2 is a sensible fallback if Granite's new runtime proves troublesome.

The deployment constraints remain self-hosted inference, commercial use, English initially, FP16 on a shared Tesla T4, and central queued workers. Published BF16 results are not FP16 validation. Checkpoint byte size is disk storage, not measured VRAM consumption.

## Comparable leaderboard evidence

Use the [Open ASR Space](https://huggingface.co/spaces/hf-audio/open_asr_leaderboard) version dated 17 October 2026, with its pinned [English CSV](https://huggingface.co/datasets/hf-audio/open-asr-leaderboard-results/blob/e85ed601d17ab0e008721a19fc9cba36b4ee9c9c/english_short_latest.csv). These are specific columns from that revision, not historical model-card averages. Lower WER is better.

| Candidate | AMI cleaned WER | Earnings22 cleaned, AA chunked WER | Commercial license |
| --- | ---: | ---: | --- |
| Cohere Transcribe 03-2026 | 7.02 | 7.88 | Apache 2.0 |
| Qwen3-ASR-1.7B-HF | 8.31 | 5.84 | Apache 2.0 |
| Granite Speech 4.1 2B AR | 7.06 | 6.69 | Apache 2.0 |
| Granite Speech 4.1 2B NAR | 6.96 | 6.67 | Apache 2.0 |
| Granite Speech 5.0 470M TurboCTC | 7.71 | 6.75 | Apache 2.0 |
| Parakeet TDT 0.6B v2 | 9.09 | 6.76 | CC BY 4.0 |
| Parakeet TDT 0.6B v3 | 9.42 | 5.85 | CC BY 4.0 |
| Canary-Qwen 2.5B | 7.91 | 6.41 | CC BY 4.0 |
| Canary 1B v2 | 13.03 | 7.28 | CC BY 4.0 |

Our 60-clip AMI pilot's 5.73% strict WER uses different references, selection, and normalization; it cannot be compared numerically with this table. Cleaned/chunked Earnings22 is a conversational business-speech proxy, not full meeting evaluation. Overall averages have unequal dataset coverage, so ranking all rows by their published `avg` is misleading.

The [pinned long-form CSV](https://huggingface.co/datasets/hf-audio/leaderboard_longform/blob/4f164c2c904b630d9777323b5d2e7f1f549d0143/longform_latest.csv) has Earnings22 WER 12.66 for Cohere, 13.25 for Parakeet v2, and 13.59 for Canary-Qwen. It lacks the proposed Qwen and Granite challengers. Missing results provide no evidence of poor long-form quality. This file also retains historical TED-LIUM data; the Space notes its removal from active rankings after a data-license change. Compare named datasets rather than inconsistent aggregate fields.

## Candidate fit and reproducible checkpoints

1. **Qwen3-ASR-1.7B-HF — quality challenger.** Its stronger cleaned Earnings22 result complements Cohere's stronger AMI result. The official [native Transformers checkpoint card](https://huggingface.co/Qwen/Qwen3-ASR-1.7B-hf) documents support starting in Transformers 5.13.0, with language selection and optional vocabulary prompts. The [original model card](https://huggingface.co/Qwen/Qwen3-ASR-1.7B) also documents local backends; FlashAttention is optional in its Transformers example. Prefer a small-batch FP16 supported-attention pilot on T4, without a forced-aligner model in v1. The benchmark row is the `-hf` checkpoint, so reproduce that exact artifact: revision `bcd2b5b7f32b480ab5790554cfa8347f246a14f3`, 4,076,193,080 weight bytes. Do not silently substitute the original checkpoint at `7278e1e70fe206f11671096ffdd38061171dd6e5`. Apache 2.0; public, ungated original model.
2. **[Granite Speech 5.0 470M TurboCTC](https://huggingface.co/ibm-granite/granite-speech-5.0-470m-turboctc) — efficiency challenger.** Released August 25, 2026; 470M English CTC model with greedy non-autoregressive decoding. Native support requires Transformers >=5.16.0, compatible in version with the pilot's 5.19.0. Revision `947f59af40db9791170a0628cf0f3f4812d720f1`; 946,180,704 weight bytes. Public, ungated, Apache 2.0. Published speed is on H200, not T4. Validate FP16 finite outputs, punctuation behavior, segmentation, silence, and total device memory before claiming operational savings. Exclude the similarly named `-nc` model: CC BY-NC-SA does not fit commercial deployment.
3. **[Granite Speech 4.1 2B AR](https://huggingface.co/ibm-granite/granite-speech-4.1-2b) — additional quality option.** Nearly matches Cohere on cleaned AMI and improves Earnings22. Public, ungated, Apache 2.0; revision `de575db64086f84fdc79da4932d1076e965bc546`; 4,832,251,586 weight bytes including auxiliary weights. Native Transformers supports the architecture. BF16 examples still require FP16/T4 verification. The `plus` speaker/timing variant is unnecessary for the initial per-speaker capture design.
4. **[Parakeet TDT v2](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2) — conservative efficiency fallback.** 600M English model, NeMo runtime, punctuation and timestamps, explicit T4 testing in NVIDIA's card. Public, ungated CC BY 4.0; revision `ae9ad07059c7c739ffaf932226a8fe64ae2620b0`. Attribution obligations apply. Its full-attention long-audio claims do not establish shared-T4 memory capacity. [v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), revision `541d1f99c6b0c3cd0b11a95167540bb8edefd82b`, adds multilingual support but is weaker on this AMI column.

Defer **[Granite 4.1 2B NAR](https://huggingface.co/ibm-granite/granite-speech-4.1-2b-nar)** despite its attractive results: its current instructions require FlashAttention 2 and Torch >=2.9.1, beyond the pilot's Torch 2.8. Standard [FlashAttention 2 CUDA support](https://github.com/Dao-AILab/flash-attention#nvidia-cuda-support) targets Ampere/Ada/Hopper. A separate Turing subset exists, but that does not establish compatibility with this model's packing/noncausal requirements. Do not change production to force it onto T4.

[Canary-Qwen](https://huggingface.co/nvidia/canary-qwen-2.5b), revision `b1469e1bba1cfe140205529c79c434ca47180960`, is commercially usable under CC BY 4.0, but adds a 2.5B NeMo speech-LM runtime and trained on inputs up to 40 seconds. It does not currently offer a clearer fit than the two recommended challengers.

## Other new entries and a second benchmark

Use the dated Space release and exact checkpoint identifiers when selecting models. Model-card tables can describe older evaluations, and embedded dataset views can differ from the CSV that the Space actually renders.

Also use the new [FFASR benchmark](https://huggingface.co/blog/ffasr-leaderboard), launched June 2026, for noise/reverberation robustness. It evaluates held-out speech in simulated rooms, checks simulation against physical measurements, and reports L4 throughput. It complements close-microphone AMI; it does not replace codec, accent, overlap, silence, and long-call tests using representative Meet captures. No new GPU pilot or production change was performed for this research.
