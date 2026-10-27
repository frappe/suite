# English batch transcription pilot

Status: preliminary pilot complete. Gated access is resolved, and isolated FP16 smoke, matched meeting-speech comparisons, and bounded timing measurements have completed. No production rollout or final model-selection decision has been made.

This pilot evaluates the unresolved model and capacity gates in [the batch spec](../../../specs/meet/002-batch-transcription.md). It does not implement the capture feature or assume that offline inference improves recognition accuracy.

## Recorded environment

Read-only checks on 2026-10-19 found a Tesla T4 with 15,360 MiB VRAM, approximately 11,897 MiB free, and an existing healthy production Nemotron service using approximately 3,015 MiB. The host has approximately 15 GiB system RAM and, after authorized cleanup, 13 GiB free on its root volume. These are snapshots, not reservations or sustained-load measurements.

The separate 116.4 GiB EC2 instance-store device is unmounted and has no detected filesystem. It has not been formatted or adopted as pilot storage. Keep pilot artifacts within the existing available persistent space for now.

The candidate is `CohereLabs/cohere-transcribe-03-2026`, pinned to revision `d552dadc2922ba6f6c1f994f8db904d52dcaf942`. The safetensors weight file is 4,131,862,976 bytes. Config and weight access initially returned `GatedRepoError`; after the account owner accepted the conditions and authenticated the host, access was verified and the pinned checkpoint downloaded. Credentials are not copied into repository files or reports.

Source-backed runtime and dataset findings are recorded in [the pilot research](cohere-transcription-pilot-research.md).

## Isolation and resource controls

- Use a separate pilot environment and private working directory. Do not install dependencies into the running production container, replace its model, or restart it to run the experiment.
- Pin model revision and record exact runtime versions, dtype, audio preprocessing, decode settings, and commands with each result.
- Start with batch size one, short bounded clips, and FP16; verify T4 compatibility instead of inheriting the checkpoint's BF16 dtype.
- Bound generated tokens and run duration. Begin sequentially; do not submit an entire long recording as an unbounded batch of chunks.
- Limit pilot CPU/RAM and PyTorch allocator memory, leaving production headroom. A PyTorch allocator limit does not reserve VRAM or constrain every CUDA allocation; monitor total usage as well.
- Record production health, GPU memory/utilization, host memory, and disk headroom before, during, and after inference. Stop the pilot on production health failure, resource exhaustion, or a pilot timeout; do not recover by restarting production.
- Do not send benchmark speech to the live ASR endpoint. A baseline comparison must use an isolated replica with the production configuration, run separately from candidate inference to conserve VRAM.

## Stages and independent expectations

1. **Access and runtime:** verify gated-file access, download only the pinned candidate files needed for inference, and verify native model import and explicit FP16 load. Loading the model is not an accuracy result.
2. **Smoke:** use a small public English speech fixture with a fixed source reference and separate synthetic silence. Record source/license, sample rate, audio hash, duration, and the expected text before inference. Success means the bounded inference path works; read-speech success is not evidence of meeting quality.
3. **Meeting evaluation:** select licensed or consented English meeting speech with speaker-specific sources. Freeze the manifest, source references, and segmentation before inference. Independently listen-check the reference subset used for quality claims; publisher transcripts alone must be labeled as such. Include natural pauses, participant names, accents, overlapping speech, and difficult/noisy conditions where available. Keep raw audio, references, and predictions outside git.
4. **Matched comparison:** run the candidate and isolated Nemotron baseline on the same fixed source audio and references. Report differences in preprocessing, chunking, prompting, and hints. Do not infer relative accuracy from unrelated published scores.
5. **Bounded capacity:** after single-clip success, evaluate sequential chunks from longer speech and repeated jobs, recording first/cold and warm timings separately. Increase batch/concurrency only while production headroom remains. Performance alongside idle production is not proof of coexistence under production speech load.

## Measurements and decision limits

- Report word errors against independent references with a documented normalization policy, plus per-scenario breakdowns, missing/extra names, silence hallucinations, failures, truncations, and recoverable partial results.
- Distinguish recognizer quality from speaker identity and timing: a text-only model does not establish accurate timestamps. Verify segment offsets against the source audio timeline, including gaps, rather than recognition-response times.
- Record total audio processed, wall time, audio-seconds processed per wall second, cold load time, peak GPU memory, and host resource measurements. Include input loading/preprocessing overhead separately from model-only timing.
- Count actual speaker-source audio work, not only conversation wall time, when estimating queue capacity. Extrapolations must identify their assumptions and do not establish a one-hour delivery guarantee.
- The owner adopted an aggregate common-normalized WER ceiling of 10% as the provisional pilot gate on 2026-10-20. Report Indian English separately and independently review names/numbers, missing speech, speaker attribution, and silence. This does not establish final production acceptance, a GPU requirement, site limits, or a service-level percentile.

## Current result

Environment and model-access probes completed. A separate `suite-transcription-pilot` container was created from the existing production image with a private mount at `/opt/asr-eval/transcription-pilot-20261019`, one CPU, a 6 GiB host-memory limit, no published service port, and restricted container privileges. It has no production model-volume mount. Native `CohereAsrForConditionalGeneration` and `AutoProcessor` imports and FP16 inference succeeded.

The isolated runtime inherits Torch `2.8.0a0+5228986c39.nv25.6`, Transformers `5.19.0`, safetensors `0.8.0`, and huggingface-hub `2.2.0`. Accelerate `1.13.0` was installed only in the isolated container. This is not the model author's tested Torch 2.10.0 runtime. The installed Torch wheel includes `sm_75`, and bounded FP16 inference on the T4 was measured rather than inferred from import success.

Production's health endpoint remained healthy during preparation and sampled pilot runs. An isolated production-image replica supplied the streaming baseline with its production model volume mounted read-only and a separate API key. Its benchmark traffic never targeted the live service. Baseline and candidate inference ran separately. Both experimental containers were stopped after measurements; production retained its original image and start time, and device usage returned to its pre-pilot level.

See [pilot results](transcription-pilot-results.md) for the measurements, source hashes, normalization, limitations, and remaining gates. Representative Meet recordings with independently checked references remain a prerequisite for a product-quality decision.

## Disposable GPU-host cache

On 2026-10-19, the owner authorized use of the EC2 instance-store device for disposable weights and caches. After rechecking its instance-store model, absence of filesystem signatures/partitions/mounts/holders, and empty mount directory, `/dev/nvme1n1` was formatted as ext4 and mounted with `noatime` at `/mnt/asr-cache` (approximately 115 GiB available). Subdirectories `models`, `huggingface`, and `tmp` are owned by pilot UID/GID 10001. No automatic boot mount or formatting service was added.

Use this location for subsequent model downloads and explicitly mount it into isolated pilot containers. Existing pilot checkpoints were not relocated, and production paths were not changed. Keep Hugging Face credentials, source audio, frozen manifests, reports, and irreplaceable results on persistent storage. Check that this path is actually mounted before downloading; if instance storage is replaced or lost, recreate the disposable cache and download pinned weights again. Production health remained good after setup.

## Capture follow-up (2026-10-20)

[Follow-up evidence](transcription-followup-validation.json) records the longer browser run, expanded Indian English comparison, local SMTP delivery, media diagnostics, review fixes, bounded inference and concurrent-caption measurements. The browser path scored 14/181 normalized word errors (7.73%); the separate 120-clip continuous Indian English cohort scored 164/1634 clean (10.04%) and 165/1634 after Opus (10.10%) with pause-aware segmentation. These are separate cohorts and paths, not a combined acceptance score. Publisher references were frozen but not independently listen-checked.

A longer authorized recording is useful even without a full transcript: processing and recovery can be tested immediately, then selected sections can receive human-checked references. Production acceptance remains pending representative speech, critical-error review, container/browser media checks and sustained queue/coexistence measurements. The isolated GPU runtime was removed; production retained its image and start time and returned to baseline GPU memory.

## Authorized natural recording (2026-10-20)

The owner subsequently supplied a 2h30m47s stand-up recording. [Long-recording evidence](transcription-standup-validation.json) records the private download, full audio decode, native VAD segmentation and pinned Granite processing. All1,563 segments completed after a forced container kill and restart, reusing21 durable results without re-fetching those sources. This used an offline filesystem gateway around the actual processing/lease code, so it does not establish sustained Frappe queue capacity. The recording has mixed stereo audio; speaker identities were not inferred.

A draft Transcript and five independently selected30-second review clips are retained privately. No checked reference exists yet, so WER, critical-error review, VAD omissions and subtitle alignment remain unscored. Production retained its image and start time and returned to baseline GPU memory after the isolated runtime was removed.

## Language-scope correction and matched review (2026-10-20)

After reporting that the draft was not useful, the owner confirmed substantial Hindi in the recording. Granite TurboCTC is English-only, and Cohere's supported-language list excludes Hindi. The full-recording run establishes processing and checkpoint recovery, not mixed-language accuracy. [Matched diagnostic evidence](transcription-quality-diagnosis.json) records seven windows, VAD/context controls, Cohere, Whisper English/automatic/Hindi modes, two FP32 controls and native Qwen3-ASR automatic/Hindi modes. Qwen is the next listening-review candidate; no model is accepted or changed in the product.

Checked bilingual references are still absent. Do not reuse the English-only normalizer to claim mixed-languageWER. Reference script, normalization and whether Hindi-English belongs in v1 remain product decisions. Private audio/draft comparison and blank review fields are prepared; production retained its image and start time and returned to baseline after all experiments were stopped.

## Revised output contract after grilling

The owner confirmed Original and English Transcripts, automatic English/Hindi handling, faithful readable English and explicit partial outcomes. Built-in vocabulary is shared with live captions, supplemented only by automatic participant/title hints. Site-specific and host-entered manual glossaries are excluded. The [capture](../../../specs/meet/001-recording-and-transcription-capture.md), [processing](../../../specs/meet/002-batch-transcription.md) and [delivery](../../../specs/meet/003-capture-artifact-delivery.md) specs now describe this revision; the single-stage implementation still needs to be updated after model validation.

## English-rendering comparison (2026-10-20)

[Bounded rendering evidence](transcription-english-rendering-validation.json) compares Qwen3-4B text rendering, HY-MT1.5-1.8B translation and Whisper large-v3 direct speech-to-English translation. Qwen reversed a Friday-to-Monday correction in an independent written control and that configuration is rejected. HY preserved that correction; later review identified the count control as linguistically ambiguous, so its count wording is not a conclusive failure by itself. Its technical acronym expansion and meeting-source fidelity still need review. Direct Whisper outputs were much shorter on several windows, raising an unverified coverage concern. No pipeline is accepted.

The seven source-recognition drafts are not checked references. Written-control inspection was agent-assisted, and matching keywords initially missed the critical reversal; keyword coverage is not a semantic quality gate. No mixed-language or translation WER is reported. Private audio-linked comparisons and blank listening-review fields are retained outside git. All isolated inference/runtime processes were removed, production health remained good, its image/start time stayed unchanged and GPU memory returned to baseline. The revised two-artifact pipeline remains implementation work after model validation.

The next reference packet freezes four new 20-second windows at 10/35/65/85% of the recording, before generating candidate predictions for them. The private audio-linked form contains no model drafts and accepts source wording or faithful English meaning, plus audibility and critical facts. A bilingual listener must supply these references: this agent's tools cannot directly hear the audio. English meaning permits semantic evaluation, not source-recognition WER; unclear/no-speech windows must remain marked. Reference collection is pending and does not change the quality decision.

## First independently supplied listening reference (2026-10-20)

The owner supplied the first frozen 20-second window's wording without model drafts, marking the audio partly unclear and English. [Checked-reference evidence](transcription-checked-reference-validation.json) records Qwen recognition at 5/68 normalized edits (7.35%) and Whisper at 11/68 (16.18%). The common normalizer left a standalone period from the reference's trailing ellipsis; postprocessing removed punctuation-only tokens identically from both sides. The initially reported raw-normalizer counts (5/69 and 11/69) remain recorded. Strict scores are 5/60 and 10/60. This post-hoc normalization correction and the incomplete/unclear reference prevent an accuracy-gate decision.

HY rendering changed a singular technical-looking term into a plural ordinary noun. Tentative wording and negation remained, but term fidelity and unclear boundaries need listener adjudication. Whisper's recognition and direct-English outputs were identical on this English clip. No Hindi-English quality claim follows from it. Inference prompts never included the user reference, no model was accepted, all isolated processes were removed, and production health/image/start time and baseline GPU memory were preserved.

## User-supplied meaning reference for the opening diagnostic (2026-10-20)

The owner supplied the English wording/meaning for the requested 00:30–00:50 interval. [Meaning-reference evidence](transcription-checked-mixed-reference-validation.json) records a rerun on the first 20 seconds of the already-frozen opening diagnostic, without putting the reference in inference prompts. This is not a blind held-out sample because earlier overlapping 30-second drafts existed. The exact source language and a verbatim source transcript remain unconfirmed, so no recognition or translation WER is reported.

Qwen followed by HY turned a tentative unfinished date line into an unsupported definite advertising claim and lost the destination question. Whisper direct translation preserved the question but omitted the explicit date. Both tested configurations fail the semantic checks for this diagnostic. Whisper's transcribe output retained the tentative date and question better, but its opening differs and English output does not establish the Original Transcript language/script contract. No pipeline is accepted. The standalone English-window WER result cannot override these fidelity failures. All isolated processes were removed, production retained its healthy state/image/start time, and GPU memory returned to baseline.

## Stronger configurations and longer-context regressions (2026-10-20)

[Primary-source research](stronger-multilingual-pilot-research.md) narrowed the next comparison to Qwen3-8B NF4 rendering and native OpenAI Whisper large-v3 decoding. [Stronger-candidate evidence](transcription-stronger-candidates-validation.json) records pins, prompts, quantization, dependency hashes, written controls, both checked clips, longer diagnostics and cleanup. No candidate is accepted.

Qwen8B nonthinking completed 48 generations: 14 written controls and two recognized real texts across three seeds. Actor negation changed in all three outputs for one control; all three real opening renderings lost the destination question and added unsupported definite date wording. Reasoning mode corrected the actor contrast in the completed controls, but one checked-English seed truncated within the frozen768token budget. It was stopped after15 recorded generations across five completed case batches; remaining cases were not evaluated. This rejects the bounded configuration, not unrestricted reasoning or quantization generally.

Native Whisper with upstream beam/fallback orchestration scored 5/68 provisional normalized edits (7.35%) on the partly unclear English reference and retained the date, tentative qualifier and question on the checked20s opening. Its initial upstream loader exceeded only the experimental7GiB allocator limit; a retry constructed the same checkpoint onCPU in FP16, restored LayerNorm toFP32 and moved the model toCUDA. That memory-efficient loader is an explicit deviation. Engine, file representation and decoding settings changed together, so the gains cannot be attributed to beam search alone.

Both selected90s passages were then processed without complete checked references. The opening's detected language changed toHindi and its English draft omitted the known tentative-date line. A final development comparison used fixed20s nonoverlapping windows and fresh automatic language detection. It recovered the date value but still omitted the tentative qualifier; unexpected language labels appeared on short tails. Native estimated segment timestamps overran some inputs. No stitching, deduplication, speaker attribution or subtitle alignment was accepted. These are continuous mixed-video audio diagnostics, not validation of the actual per-speaker VAD capture path.

Further source-recognition diagnosis needs verbatim original Hindi-English wording alongside the supplied English meaning, with unclear spans preserved. English meaning references expose rendering failures but do not establish source-language recognition accuracy. Private longer drafts and audio-linked review controls are prepared. All isolated runtime processes were removed; production remained sampled healthy, kept its image/start time and returned to baseline GPU memory.

### Source-language confirmation

The owner subsequently confirmed that the00:30–00:50 reference was their English translation of Hindi-English speech. The immutable private meaning reference is retained with a separate language-confirmation annotation. No verbatim original-language reference exists yet. The native20s transcribe output was entirely English, so that configuration does not satisfy the Original Transcript requirement on this confirmed mixed-language case. Recognition WER remains unreported for it; the earlier7.35% diagnostic belongs to the separate English-only window.


### Partial spoken-word reference (2026-10-21)

The owner supplied Romanized Hindi-English source wording for the same20s clip, including an explicit unclear span. It is frozen separately from the immutable earlier English meaning reference; private hashes and aggregate findings are in the checked-mixed-reference evidence. No new inference was run. Qwen captures much of the Hindi opening, but adds/garbles wording and renders the English question phonetically in Devanagari. HY then compounds those recognition problems into unsupported advertising assertions and loses the question. Native Whisper retains the date/question but fails source-language preservation by returning English for transcribe. No pipeline is accepted.

The later spoken wording does not include the earlier meaning reference's tentative date qualifier. This supersedes the earlier conclusive “probably omitted” finding: qualifier omission or invention is unresolved, not an established critical error. The date omission in the earlier direct-translation output and the question/advertising failures remain supported. The unclear opening is not adjudicated by guessing its missing words. Mixed-language WER remains unreported because the reference is partial and common-script normalization is unsettled.

The listener also marked the opening action word uncertain. That word and the adjacent unclear span are excluded from lexical and semantic error judgments; no action or tense is inferred there. A separate private clarification preserves the original submitted reference unchanged. Date and destination-question findings are unaffected.


## Bilingual reference collection batch (2026-10-21)

[Reference-set protocol](transcription-bilingual-reference-set.json) reuses the three remaining frozen20s percentage-selected clips, with separate blank source-wording and English-meaning fields. Audio hashes were verified and copies retained privately. The form shows no model drafts and accepts uncertainty, no speech, language labels and prior-exposure disclosure. Earlier checked clips remain development regressions; the whole recording was previously processed with Granite, so the new references are not described as a wholly untouched held-out corpus.

Human references are pending. Language balance and audibility must be checked before selecting mixed-language evaluation cases;60s alone cannot establish production quality. Romanized Hindi is acceptable for reference collection and semantic diagnosis, but mixed-script recognition WER needs an agreed normalization/adjudication policy. English meaning is scored for fidelity separately, never by English recognition WER. No new inference, model selection or GPU changes occurred.


### Second percentage-selected reference: English (2026-10-21)

The owner checked the52:46–53:06 interval, marking it English and partly unclear, with Atlas as a key term. The raw submission was frozen privately before a bounded Qwen3-ASR/native Whisper comparison; its English-meaning field delegated to the spoken wording, so it is not an independent translation reference. [Evidence](transcription-reference35-validation.json) records the comparison and unchanged production baseline. No reference text or Atlas hint was supplied to either model.

Both retain Atlas and the clear list-review purpose/conditional need, but neither clearly preserves the substantive signup-responsibility phrase. Their completions in unknown spans remain unverified and are not counted as established hallucinations. No full-window WER or provisional10% gate result is reported for this partial reference. This English case does not supply the still-needed checked mixed-language evidence. Other two unreviewed packet clips remain pending; no candidate is accepted.


### Remaining reference packet submissions (2026-10-21)

The owner supplied the98:00–98:20 and128:10–128:30 reviews. The former was repeated identically in the later export and is counted once; it is explicitly unintelligible English and excluded from accuracy scoring and new inference, not treated as silence. The latter is partial Hindi-English source wording with unspecified audibility and unclear spans, but its meaning field does not supply a checked English translation of Hindi. All three unique packet cases are now received; a complete bilingual meaning-reference set is not established.

[Mixed-reference evidence](transcription-reference85-validation.json) records a bounded Qwen/native Whisper comparison after freezing the submissions. Both source outputs retain recognizable central pricing/model-choice wording but write the English phonetically in Devanagari, failing the accepted Original Transcript script contract. Whisper English preserves the clear central English content. Its opening coverage and the Hindi-to-English portions remain unverified. Source outputs include an amount/credit clause not in the translation; because that source clause conflicts with the partial reference and is unverified, this is diagnostic disagreement, not an adjudicated hallucination or true-amount omission. Native source timing overran the20s input by0.28s. No mixed-language WER, full English-meaning score or pipeline acceptance follows.

Reference text/hints were not supplied to models. All isolated runtime processes were removed; sampled production health remained good, image/start time were unchanged and GPU memory returned to baseline. Raw submissions, outputs and uncertainty stay private.


## Bounded script/context configuration verdict (2026-10-21)

[Configuration evidence](transcription-script-configuration-validation.json) records the authorized final tuning experiment on the four checked20s clips: two English and two partial mixed-language references. Existing models/checkpoints were reused, with no downloads, reference text or clip-specific hints in prompts. Qwen generated20 outputs across full20s generic script context,10s plain and10s generic context. Native Whisper ran16 recognition/translation tasks on independent10s cuts. Raw chronological output and Qwen raw/parsed text are retained privately; no silent reconciliation was applied.

**Stop this configuration-tuning path.** Generic Qwen context did not reliably preserve English Latin alongside Hindi Devanagari. Both10s configurations additionally rendered part of a listener-confirmed English clip in Devanagari. The clear signup-responsibility recognition error persisted. Native10s recognition produced severe garbling on the question-bearing half of the opening diagnostic after a Sinhala language prediction; this is not verified Sinhala speech. Its source output on the later mixed clip also failed to preserve the checked model-choice clause.

Native short-segment English translation retained the checked date/travel question and the later pricing/model-choice English clauses, but did not repair the English-control signup-responsibility error. That limited agreement cannot establish unreferenced Hindi meaning or complete coverage. Unclear opening words, the disputed tentative qualifier and unverified amount/billing remain unadjudicated. No full-window/mixed WER, translation accuracy score or pipeline acceptance is reported. This experiment rejects the tested prompt/10s configurations, not every segmentation approach or future model.

All isolated processes were removed. Production remained sampled healthy with unchanged image/start time and returned to baseline GPU memory. Product implementation/deployment was not changed.


## Srota trained code-switch checkpoint trial (2026-10-21)

The owner authorized a bounded trial of the [screened Srota union checkpoint](hindi-english-open-model-research.md). [Evidence](transcription-srota-validation.json) records the pinned ungated Apache checkpoint/weight hash, originalqwen_asr0.0.6 wrapper and isolated Transformers4.57.6 dependencies. Four frozen20s clips were processed inFP16/SDPA, with auto languageNone, empty context, greedy512tokens and no reference or vocabulary hints. Generated raw and parsed text remain private.

**The tested Srota configurations fail.** The opening mixed-language case keeps the date but loses the checked destination question/answer. The listener-confirmed English Atlas clip becomes Devanagari and loses the signup-responsibility content. The later mixed-language case still writes English largely phonetically in Devanagari. The first partly unclear English clip is comparatively recognizable, but cannot override these failures. All generations reachedEOS, which does not prove completeness.

Before assigning the failures beyondFP16, oneFP32 control repeated the failed English and travel-question cases, with finite model parameters verified. The question output was identical; key script/coverage failures persisted. The packaged prompt renders identically to the base checkpoint format; no prompt/template correction was applied. This is a failure of the tested original-wrapper configurations, not proof about every future training/runtime approach. No downstream translation trial or pipeline acceptance follows. Uncertain opening words, disputed tentative qualifier and unverified Hindi meaning remain excluded; no full-window/mixedWER or10% accuracy-gate result is claimed.

TheFP16 andFP32 inference runs completed in approximately35s and21s, with sampled freeGPU memory at least9843MiB and7581MiB respectively. This establishes only bounded batch1 coexistence, not sustained capacity. Both isolated runtimes were removed; production remained sampled healthy with unchanged image/start time and returned to3015MiB used/11897MiB free. Downloaded public weights/dependencies stay in disposable instance storage; private results/references remain persistent. No product implementation or deployment changed.


## Trelis automatic mixed-script trial (2026-10-21)

[Evidence](transcription-trelis-validation.json) records the authorized pinned Trelis Whisper Hinglish Preview trial. TwoF32 weight shards were hash-verified, and config dimensions confirm large-v3 despite conflicting model-page ancestry metadata. FP16/SDPA inference used full frozen20s clips, checkpoint-generated language tokens and a uniformly enabled mixedcode marker, with a matched no-marker control. No human language labels, reference text, glossary or corrections were supplied. This automatic setup is distinct from the publisher's specified-language benchmark.

**Retain the mixedcode recognizer as a candidate; do not accept the pipeline.** The special mixedcode marker materially improves ordinary English-Latin output and preserves the checked travel question/date that the no-marker control garbles. The later pricing/model-choice clause is also substantially more recognizable in mixed script. Both modes retain Atlas but still substitute a different substantive phrase for checked signup responsibility. Proper-location script, uncertain opening words, disputed tentative qualifier and unverified Hindi meaning remain unadjudicated. Four coarse language predictions matching the listener's broad labels do not validate automatic routing generally.

Because source text improved, the unchanged self-hosted HY template rendered the four mixedcode outputs. It still drops the checked destination question and invents a date-to-destination interpretation even though that question is present in the Trelis source. The English renderer therefore has an independently demonstrated failure after improved recognition. Inherited Atlas errors are not repaired, and unverified Hindi meaning/amount/billing or ambiguous pronoun referents do not become checked facts. No full-window/mixedWER, translation accuracy score or10% gate result is claimed.

Eight recognition generations and four rendering generations completed withEOS. Recognition and rendering runs took approximately37s and31s with sampled freeGPU minima7981MiB and7615MiB. Both isolated runtimes were removed, production retained healthy sampled status/image/start time and returned to baseline3015MiB used/11897MiB free. This is bounded batch1 coexistence, not sustained capacity. No product code/deployment changed.


## Accepted v1 scope: translation deferred (2026-10-21)

After the Trelis recognition/rendering comparison, the owner explicitly deferred translation. Current capture, processing and delivery specs now request one Original Transcript, preserving English/Hindi/code-switching, with one transcription completion outcome and no English-rendering task, translated sibling, translation retry or rendering-failure notice. Recognition checkpoints remain internal; publication is still required before successful source cleanup. Video remains independently selectable/deliverable, and artifact deletion stays independently fenced. Historical two-artifact pilot reports are retained as evidence rather than rewritten.

This scope decision does not accept Trelis or the existing English-only Granite worker. Representative fully checked original-language meeting passages, English regressions, actual per-participant capture-path checks, sustained capacity and safe caption coexistence remain release gates. The existing worker's recognition integration, automatic hints and earlier Transcript.txt filename remain implementation gaps against the Original Transcript.txt contract. No code deployment or GPU change accompanied this documentation revision.


## Continuous five-minute Trelis draft (2026-10-21)

[Longer-source evidence](transcription-trelis-long-validation.json) records the authorized original-language-only run on02:05:40–02:10:40 of the known recording. The sourcevideoSHA was reverified. Fifteen adjacent20s PCM windows reconstruct the frozen300s input exactly, after trimming a28.667ms resampler tail. Trelis uses the same FP16/SDPA, automatic language token, uniform mixedcode marker and greedy440 configuration; no carry text, translation, hints or human reference is supplied. These are independent short recognition calls over continuous input, not a single five-minute-context decode or validated stitching algorithm.

All15 windows completed withEOS and nonempty drafts, at most201generatedtokens each, in approximately80s. These completion checks do not establish word completeness or quality. All language predictions were Hindi, not verified language labels. A private chronological draft and audio-linked listening form provide the full passage or individual windows, plus a35s Atlas context recheck with no suggested wording. Revealing/downloading drafts is recorded as model exposure; notes export as post-pilot feedback, not blind ground truth. The Atlas phrase and longer accuracy remain pending human review. NoWER or quality acceptance is claimed.

The mixed recording does not establish source speaker identities, actual per-participant/VAD capture behavior or subtitle alignment. All isolated processes were removed, sampled production health remained good with unchanged image/start time, and GPU memory returned to baseline3015MiBused/11897MiBfree (minimum7947MiBfree during this bounded run). No worker integration or production rollout occurred.

The owner subsequently supplied the35s Atlas context wording, marked clear English and without revealing a draft in the form (earlier exposure still exists). It again confirms signup responsibility; that Trelis substitution remains a recognition error under the checked reference. One bracketed unresolved span is preserved. This35s contextual reference is not scored against the earlier20s output without alignment, and it does not complete the five-minute passage review. The immutable submission and hash are retained privately.

### Public references replace further owner transcription work

The owner asked to stop manual transcription tasks. A bounded automatic Trelis run used50 preselected whole HiACC mixed-script clips and20 existing frozen Svarah Indian-English cases, with publisher references and normalization fixed before inference. Common-normalized Indian-English WER was24/293 (**8.19%**), passing the provisional10% ceiling on this small sample. Hindi-English script-safe WER was139/771 (**18.03%**); it has no newly invented10% ceiling. All70 outputs were nonempty and ended withEOS. [Results and limits](transcription-public-benchmark-results.md) and [aggregate evidence](transcription-public-benchmark-validation.json) record selection, script-safe scoring, reference-ID correction and cleanup. This is an author-used public benchmark, not an untouched meeting-quality test or semantic certification. Trelis remains provisional, rollout stays disabled, and no further owner transcription task is requested.

### Provisional recognizer integration (2026-10-21)

The worker now integrates pinned Trelis automatic-language mixedcode decoding and
new artifacts use Original Transcript.txt. New captures freeze the complete
supported model/decoding configuration; old Granite jobs/checkpoints are not
silently migrated. Actual PCM input is bounded to30s and missingEOS becomes an
explicit retryable source failure. The existing source identity, fair queue,
private publication and deletion fences remain in place.

[Integration evidence](transcription-trelis-integration-validation.json) records69
automated checks,87 real-GPU fixture sources, checkpoint/retry recovery,85 exact
prior-draft regression matches,30s boundary handling, digital silence, missing
cache/EOS checks, authenticated worker startup and final UTF-8 artifact reads.
This is layered verification; no fresh full browser-to-GPU-to-Drive replay was
performed in this turn. A code-overlay image reused the pinned dependency
runtime; a later12-call batch ran without pilot extras.

The short isolated caption comparison had no failed clips, but p95 first-text
latency rose from1.413s alone to2.049s during active batch inference. It does not
approve production GPU sharing. Setup failures before replay are retained, all
test containers/runtimes were removed, and production retained its healthy
state/image/start time and baseline GPU memory. The feature flag stays disabled.
Shared vocabulary/automatic hints, representative source fidelity and sustained
capacity/latency gates remain open; no new manual transcription task was given
to the owner.
