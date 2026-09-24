# Memory tokenizer: runtime counter and parity/load harness

Status: **local complete-or-block service adoption, verified.** The root dependency
is pinned to `gpt-tokenizer@4.0.0` with the verified SRI below. No existing package
versions changed. Ordinary service dispatch now counts prepared buckets before
claim for the exact model names listed below. This is not full summary/retrieval,
model/account eligibility, or deployed acceptance. Staged alpha remains separate.
The standalone load harness keeps its disposable install.

Preparation scope reads use schema14's ordered partial index: at most65 rows
per scope, at most195 SQL-returned rows and65 parsed bodies before the64-record
complete-or-block gate. Actual local workerd plans avoid full scans and temporary
sorting. This does not bound index construction, storage size or unlimited legacy
enqueue snapshots; query-plan evidence is not deployed CPU or latency acceptance.

## Owner-adopted summary metadata (not prompt substitution)

`memory.put` accepts optional `summary: {schema_version: 1, source_sha256, text}`.
Summary text is1..2000 Unicode code points. The owner must classify the memory
as `explicit_constraint: false` (including a previously adopted false preserved
by an older editor). True or unclassified records cannot carry summaries.
The source digest is lowercase SHA256 over UTF-8 `JSON.stringify` of this exact
ordered array, with no Unicode normalization:

```js
[1, id, expected_revision + 1, scope.kind, scope.id, text,
 source_event_id, expires_at, sensitivity, false]
```

Here `text` is the full source, not summary text. The digest binds the resulting
record revision, scope, provenance reference, expiry and sensitivity. A digest
does not establish summary fidelity: the verified owner adopts the supplied
text. Summary text cannot grant tools or authority. Each subsequent revision
needs fresh summary adoption; omitting summary clears it rather than silently
reusing a stale projection. Current/revision/command purge removes it alongside
the source. No separate index or summary table is created.

This is only a storage/adoption contract. Full source text remains in context,
and both source and metadata count toward the existing byte/token budget. There
is no automatic inference, wake, compression, or UI summary editor. The bounded
read tool below does not replace the full prompt. Substitution requires exact revision pointers, disclosed
compression and bounded authorized retrieval before adoption.

## Targeted-read protocol and runtime delivery

Ordinary-runtime RPCs `memory-read-prepare` and `memory-read-reserve` implement
the control-plane stages. They require an active exact task/attempt, current
epoch/boot/lease/deadline, an admitted memory-budget receipt, and the explicitly
adopted persona tool policy `748dbc8c-c4dd-4b54-9e3c-d13cbedf77fa`. Installing code
does not adopt that policy. Staged alpha and warm/background task credentials
cannot use these routes. The ordinary runtime exposes `hehebot_read_memory` only
when explicitly listed in its persona's `allowedTools`. Its immutable task grant
also binds the admitted selected model and initial budget digest.

The request binds a trusted-runtime UUID `read_id`, memory ID/revision from the
admitted snapshot, code-point offset and limit1..2000. Membership is checked before
loading a current body. Exact revision/body, scope and expiry must remain valid;
there is no fallback to old or newer source. Preparation returns exact serialized
response text with source metadata and range/truncation disclosure, plus a digest
binding task/epoch/read/range/model/initial receipt and those bytes. `not_after`
is capped by current source expiry, attempt deadline and executor lease.

The host counts exactly that text with the admitted model tokenizer,
then reserves before delivery. Reservation rechecks source and authority in the
same transaction that charges the bucket. Accounting version1 is the initial
bucket count plus separately counted additional response envelopes, including
repeats. This is conservative exposure accounting, not exact concatenated/native
prompt tokenization. Global4000/scoped8000 limits remain; no refund follows lost
delivery or compaction. Counts are trusted-runtime receipts, not model input.

One bounded `runtime_metadata` record per task/attempt retains at most64 read
identities/fingerprints and cumulative totals, never source/response bodies.
An identical retry reconciles its charge but returns `delivery_allowed:false`;
changed counts/bytes with the same identity conflict. Replays still revalidate
current source before returning any authorization metadata. The runtime verifies
all identity/digest/model/tokenizer fields, captures text before counting, then
requires a fresh delivery authorization. Each new MCP invocation gets a runtime
UUID, independent of the connection-local JSON-RPC ID. It never retries unknown
reservation outcomes or refunds uncertain delivery.

MCP and dynamic-tool responses cross host awaits as body-free, single-use handles.
The MCP stdout writer and native transport materialize the captured text only
immediately before their synchronous write, checking abort and the earlier of
preparation/reservation deadlines again. A missing delivery step exposes no body.
MCP cancellation notifications abort counting or suppress late delivery. Dynamic
expiry/cancellation returns a tool denial without closing the shared native
connection; the reserved charge remains and consumption is not acknowledged.
Call journals retain only fingerprints/status, never memory text, and refuse all
same-call replay after reconstruction. Mutation tool replay semantics are unchanged.
Worker authorization is a linearization point, not atomic distributed erasure
of an already authorized in-flight response. This stage adds no summarization,
projection, deployed/native-model acceptance or retention policy for the new ledger.

## Runtime counting contract

`runtime/memory-tokenizer.mjs` exports async
`countMemory({selected_model, global, scoped}, {timeoutMs = 30000, signal} = {})`.
The two buckets are exact serialized strings, not separate-record token sums.
Combined UTF-8 input is capped at131072 bytes before starting an owned Node worker
thread; model identity is syntax-checked and echoed, never mapped or admitted by
this module. It returns schema_version1, that model, tokenizer identity
`gpt-tokenizer@4.0.0/o200k_base/ordinary-v1`, and separate safe-integer token counts.
Empty special-token sets preserve literals as ordinary text; merge caching is
disabled. Runtime version mismatch fails instead of silently switching encoders.

Timeouts1..60000ms and AbortSignal cancellation terminate the owned worker and
await its termination before settling. Errors remain handled while termination
is pending; unconfirmed termination rejects and never returns successful counts.
Worker heap limits are safety controls, not measured total-memory acceptance.
Counting does not perform inference, network access or external effects, and no
memory edit invokes it automatically.

`node --test tests/runtime-memory-tokenizer.mjs` verifies independently derived
tiktoken vectors, Unicode and byte boundaries, event-loop responsiveness and
cleanup. An isolated nonterminating tokenizer stub proves timeout/abort let the
host exit; executed no-termination mutants must hang until the test harness kills
them. Thus natural encoding completion cannot masquerade as termination. Parent
independent execution with the verified tarball passed17 counter tests plus23
harness tests. This does not establish full selected-model budgets or native
task/tool/effect settlement.

## What the harness proves

1. **Token-for-token parity** between the candidate `gpt-tokenizer@4.0.0`
   (narrow import `gpt-tokenizer/encoding/o200k_base`, `setMergeCacheSize(0)`,
   `encode(text, { allowedSpecial: new Set(), disallowedSpecial: new Set() })`)
   and the official OpenAI `tiktoken==0.11.0` Python `o200k_base`
   `encode_ordinary` reference, on a deterministic varied corpus — including
   multilingual text, combining marks, emoji/ZWJ sequences, lone surrogates,
   and special literals compared as **ordinary text** (never as control
   tokens).
2. **The same parity inside real local workerd** (installed Miniflare) with the
   actual application module (`src/worker/index.ts` and `src/core/control.ts`)
   bundled into the same isolate as the candidate.
3. **Realistic load behavior** at the current memory-text contract limit,
   including multi-record batches of maximum-size records (a selected stress
   case at the contract maximum, not a proven worst-case admitted input).
4. **Its own negative controls**: corrupted expected tokens, altered artifacts,
   non-discriminating corpus shapes, never-replying/closed/erroring inspector
   sockets, hung child process groups, and evidence-overwrite hazards are all
   detected as failures.
5. **Bounded execution**: every external operation runs in a detached process
   group with a timeout, and on timeout the whole group is SIGTERMed and then
   SIGKilled, which actually terminates owned workerd children instead of
   leaving work running. Timeouts are harness safety failures, never
   performance results or acceptance.

## How to run

```sh
node scripts/test-memory-tokenizer.mjs
```

Run from the repository root. Requires Node ≥ 22.16 (repo engines pin) and
network access for public downloads only: `registry.npmjs.org` (candidate
tarball + packument), PyPI (tiktoken 0.11.0), and
`openaipublic.blob.core.windows.net` (o200k_base ranks). No credentials are
used or inherited; child processes get an isolated HOME, empty npm config, and
an isolated cache. The candidate is installed only into a disposable
`mkdtemp` directory with `--ignore-scripts`; the repository dependency tree is
never modified.

**Evidence.** Every invocation — success or failure — writes its own unique
per-invocation directory under `.local/memory-tokenizer-harness/` (created on
demand; a fresh checkout without `.local/` works), containing
`evidence.json` (machine-readable summary including pinned hashes, corpus
hash, all observations, and, on failure, the error and the retained disposable
fixture location), `workerd-child.mjs`, `workerd-result.json` (written
incrementally after each workerd step, so partial observations survive a crash
or timeout), and `workerd-child.stdout`/`workerd-child.stderr`. Repeated runs
never overwrite earlier evidence: each run gets a fresh directory, so a
failure followed by another failure preserves both. On failure the disposable
fixture directory is **retained** and its path recorded in the evidence; on
success it is removed. `.local/` is gitignored.

Focused offline tests of the harness logic (no network, no workerd):
`node --test tests/runtime-tokenizer-parity.mjs`, also part of
`npm run test:runtime`.

## Pinned artifacts

| Artifact | Pin |
| --- | --- |
| Candidate | `gpt-tokenizer@4.0.0`, npm gitHead `fb04ebca53f662200e737caefe9a5ef372a5e41a`, tarball SRI `sha512-YAWIyzvuVUHEfW7tFfFAxH8qQb+Q3RU9nYOTy7skMNX5qzU6Q8jxTHZLyO56ug1vYvCR7wndzpd3jwD86/mhjQ==`, no runtime dependencies |
| Reference | `tiktoken==0.11.0` from PyPI (official OpenAI Python package) |
| Ranks | `https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken`, SHA-256 `446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d` |

The harness verifies the tarball SRI byte-for-byte, cross-checks the pin
against the live registry packument (`gitHead` and `dist.integrity`), asserts
the installed package has no runtime dependencies, verifies the rank blob
SHA-256 directly, and places the ranks in a `TIKTOKEN_CACHE_DIR` so the
reference never downloads anything itself (tiktoken additionally re-asserts
the rank hash when loading the encoding).

### Provenance (parent-owned conclusions, cited not re-derived)

The parent source-custody thread established, and this harness relies on:
OpenAI tiktoken tag `0.11.0` resolves to commit
`eedc856364506a9d4651645a0290eb0ba81e6935`; its `tiktoken_ext/openai_public.py`
pins the o200k_base ranks SHA-256 above, and both the official blob and
`niieani/gpt-tokenizer@fb04ebca53f662200e737caefe9a5ef372a5e41a`'s
`data/o200k_base.tiktoken` match it exactly. Candidate root MIT notice
(copyright 2023–2024 Bazyli Brzoska) SHA-256
`55c0b09ede96ed11bd312d90b200d74807cad56415cb491a76364e6a537d3b92`; OpenAI
root MIT notice (copyright 2022 OpenAI, Shantanu Jain) SHA-256
`418cb499b436128d653d79941333a5437b7be2ea9213dcc2f04d15d5d2c51d86`.
Licensing and provenance conclusions remain parent-owned.

### Notices for the runtime dependency

The pinned npm package is unmodified; the Hehebot worker-thread wrapper is
independently written. The runtime uses `esm/encoding/o200k_base.js` and its
package-internal encoder/rank modules, not upstream branding, UI or assets.
The verified package declares no runtime dependencies. Its generated o200k_base
data corresponds to the pinned OpenAI ranks above. Preserve both notices below
when distributing the runtime dependency or a bundle incorporating it. This is
the narrow dependency's provenance record, not a repository-wide legal audit.

**gpt-tokenizer — MIT License**

Copyright (c) 2023-2024 Bazyli Brzoska

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

**OpenAI tiktoken — MIT License**

Copyright (c) 2022 OpenAI, Shantanu Jain

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### Model identity is separate from tokenizer-family mapping

Correction (2026-09-24): the earlier text conflated two upstream revisions.
The reference-version [`tiktoken/model.py` at eedc856](https://github.com/openai/tiktoken/blob/eedc856364506a9d4651645a0290eb0ba81e6935/tiktoken/model.py)
has a `gpt-5-` prefix and no exact `gpt-5` entry. It maps `gpt-5-codex`, but
does **not** map `gpt-5`, `gpt-5.4` or `gpt-5.5`. Downloaded file SHA256:
`c438d91dcac59786ab343e41d773afa9b3fcccef64db0121852c6fb16a3c9e31`.

Separately pinned [upstream mapping at 4e71bbe](https://github.com/openai/tiktoken/blob/4e71bbe0c078468e00fefbf94b39849389f346e5/tiktoken/model.py)
has exact `gpt-5` and the broader `gpt-5` prefix, all selecting `o200k_base`.
That metadata maps `gpt-5.4`, `gpt-5.5` and `gpt-5-codex`; file SHA256:
`600f26902d1cf6a1a5f54e37be988b3e0d911f1ff17ba7060bb361f9b5295521`.
This is a mapping-source pin, **not** an upgrade of the 0.11.0 parity reference,
rank artifact or installed runtime package. Both downloaded files are retained
under `.local/tokenizer-provenance/`; AST-extracted dictionaries independently
confirm these positive/negative lookups.

Both revisions also map the nonexistent `gpt-5-NOT-A-MODEL` by prefix.
The upstream lookup explicitly warns about this. Encoding parity and mapping
therefore establish neither model existence nor account eligibility. Runtime
adoption must use reviewed exact model names, never admit unknown names just
because they share a prefix, and retain separate account-admission checks.

The supported Codex 0.154.0 [`model/list` Model schema](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/v2/Model.ts)
contains model identity and availability metadata, but no tokenizer encoding.
Ordinary service wiring now uses the reviewed exact-name set `gpt-5`, `gpt-5.4`,
`gpt-5.5`, `gpt-5-codex`, all selecting this pinned o200k_base counter. Unknown
names (including plausible-looking suffixes) refuse before claim. This is a
bounded initial mapping policy, not a claim that other models are nonexistent
or unsupported by OpenAI. Staged alpha does not gain generic memory preparation.

The service counts exact prepared JSON buckets before admission, carries the
source/model/task-bound receipt into claim, and checks the returned memory bytes.
The supervisor aborts on recovery and checks lease authority at the actual send.
Worker claims revalidate the source and visibly block over-budget work without
truncating constraints. Encoding selection remains separate from model/account
eligibility; production gates remain false. Summaries and targeted retrieval
are not implemented by this complete-or-block stage.

Prepared buckets use stable literal relevance ordering: distinct Unicode
letter/mark/number terms shared with the admitted task instruction, descending,
then ordinal ID ascending. NFC normalization and lowercasing affect comparison
only, never the raw counted text. This is not semantic retrieval, stemming or
language-aware segmentation. Scope/expiry filtering and record/byte bounds come
first; every eligible record remains, including zero-score explicit constraints.
The sorted exact bytes are counted and digested, and claim recomputes the order.

## Methodology

**Corpus.** `buildCorpus()` is pure and deterministic (mulberry32 PRNG, no
clocks, no `Math.random`), so every run compares the identical inputs
(corpus SHA-256 recorded in evidence). Coverage: English/Indonesian/Chinese/
Arabic/mixed text, code/JSON/URL/markdown, whitespace and CRLF variants,
contractions (ASCII and Unicode apostrophes), combining marks (decomposed and
precomposed), emoji and ZWJ sequences, lone surrogates (high, low, consecutive,
reversed), special literals as ordinary text (the end-of-text delimiter and `<|im_start|>` forms are
*not* control tokens here), exact token-boundary discriminator pairs that must
tokenize differently, seeded generated strings from mixed alphabets and raw
code-point ranges, long repeated and long non-repeated text, and memory-contract
size cases. The harness asserts every discriminator pair produces different
reference encodings, proving the corpus discriminates token boundaries rather
than only bulk output.

**Size semantics.** The memory-text contract limit is Ajv `maxLength` =
`ucs2length` = Unicode code points (astral code point counts as one). The
maximum legal record is therefore 16000 astral code points = 32000 UTF-16
units = up to 64000 UTF-8 bytes. Corpus cases include ASCII, BMP, astral and
mixed maxima (exactly 16000 code points) plus one-over variants (16001) for
every variant — including the mixed composition (`oneOverMixed`). The harness
validates max and one-over payloads against the real generated memory command
schema through the real application `parseCommand` path inside workerd: maxima
must validate, one-over must be rejected `INVALID_INPUT`. One-over cases are
workload-boundary probes only; parity is still compared. The maximum-size
records used for batches are selected stress cases at the contract maximum,
not proven worst-case admitted inputs. No product limit is changed, and no
total-memory-count bound is claimed — the application currently has a
per-record text limit only.

**Independence.** Inputs are generated by the harness; reference vectors are
computed by the official Python implementation in a disposable virtual
environment; the candidate runs in Node and in workerd. Nothing derives the
expected values from the candidate.

**Negative controls.**

- A corrupted expected token (one deterministic position, +1) must be detected,
  and the failure message must name the case id and token index.
- Altered tarball/rank bytes must fail the hash gates (in-memory assertion,
  mirroring `scripts/verify-wappmcp.mjs`).
- A non-discriminating corpus (discriminator pair tokenizing identically)
  fails the run.
- The inspector protocol layer has executable negative tests: a socket that
  never replies must time out with a classified harness-safety-failure error
  (with listener/timer cleanup), an already-closed socket, a protocol error
  reply, a socket that closes before the reply, an unparseable reply, and a
  reply carrying a different request id must each be rejected — and only an
  id-matching reply resolves.
- The bounded child runner has executable negative tests: a hung child (with a
  hung grandchild) must be actually terminated by the group kill — both PIDs
  verified dead — not merely abandoned by a `Promise.race`.
- Evidence retention has executable tests: unique per-invocation directories,
  repeated failures preserved without overwriting, and missing parent
  directories created (fresh checkout without `.local/`).
- Correctness failures exit nonzero. There is no benchmark pass threshold
  masquerading as product acceptance.

**workerd phase.** A probe entry is written into the disposable install
directory and bundled with esbuild (`--loader:.sql=text`, external
`cloudflare:*` and `node:*`) together with the actual application entry module
(`src/worker/index.ts`) and the real command validator (`src/core/control.ts`
→ generated Ajv validators → `SCHEMAS/contracts.json`). The bundle runs in real
local workerd through installed Miniflare using the current options shape
(`workers: [{ config: { name, type: 'worker', compatibilityDate: '2026-09-10',
compatibilityFlags: ['nodejs_compat'], manifest: { mainModule, modules: { … } } } }]`,
`inspectorPort: 0`, `telemetry: { enabled: false }`). The probe-only fetch
handler serves `/probe/*` only; it imports the application entry module and
control class (both must be present and loaded, asserted via `/probe/health`)
but **never calls any application or provider route**.

**Bounded execution design.** The whole workerd phase runs in a generated child
process (`workerd-child.mjs` inside the run's evidence directory) spawned in
its own **detached process group**. Every step inside the child — esbuild,
`getWorker`, the probe fetches (including response-body reads), inspector
URL/`/json/list`/socket-open, each `Runtime.getHeapUsage`, the parity encode,
each boundary validation and each batch — is individually bounded; the child
writes its result file incrementally after every step (partial observations),
disposes Miniflare in a `finally`, and exits nonzero on any failure. The
parent bounds the child with a timeout larger than the sum of the child's
internal bounds, so the child classifies its own overruns; if the child ever
overruns anyway, the parent SIGTERMs and then SIGKills the entire process
group, which actually terminates the owned workerd children rather than
leaving them running behind a `Promise.race`. The npm/uv/Python/Node-runner
phases use the same bounded group runner. A timeout is always reported as a
harness safety failure and exits nonzero; it is never read as a performance
measurement, threshold, or acceptance result.

**Inspector protocol.** `getInspectorURL` is awaited and its WebSocket URL's
HTTP origin is used for `/json/list`; the exact named user Worker target
(`/core:user:<name>`) is selected, never a router isolate. Every inspector
request (`Runtime.getHeapUsage`) matches the reply by request id, and rejects
on a protocol error reply, socket close, socket error, unparseable reply, or
timeout — with listener and timer cleanup on every exit path. Used/total JS
heap is distinguished from total isolate memory (only the former is observable
here). Batches of 1, 10, 100 maximum-size records are posted and their token
counts checked against the reference. Workers and the temporary install are
always disposed/removed on success; on failure the fixture is retained with
its location recorded in the evidence.

## What the harness does not prove

- Used/total JS heap (`Runtime.getHeapUsage`) is **not** total isolate memory;
  total isolate memory is not directly observable through this harness.
- Wall-clock startup and request latency are **not** billed CPU time; billed
  CPU is not observable in local workerd.
- Local workerd is **not** deployed acceptance.
- All timings are workload observations on one machine, not thresholds, not
  gates, and not product acceptance.
- A bounded-phase timeout is a **harness safety failure** that exits nonzero;
  it proves nothing about performance, latency budgets, or acceptance.
- No total-memory-count bound is claimed or tested; the application has a
  per-record memory-text limit only.
- gpt-tokenizer's wider API (special-token handling, decoding, other encodings)
  is out of scope; only the narrow `o200k_base` ordinary-text path above is
  verified.

## Observed results (one local run)

Corrected-harness run 2026-09-24 from the task branch at source-custody HEAD
`29d8806` (orb, Node 26.5.1, Linux x64); machine-readable evidence in
`.local/memory-tokenizer-harness/<run-id>/evidence.json` (corpus sha256
`af1cee6fa1507923d8db81436a7a4be10dd3d56a924d595a134b8f793b5f389d`, 92 cases,
including `oneOverMixed`). The same run directory retains
`workerd-child.mjs`, the incremental `workerd-result.json`, and the child's
stdout/stderr. An earlier invocation of this corrected harness failed on a
generated-child syntax error; its evidence directory and disposable fixture
were retained untouched by the later successful run (per-invocation
directories), demonstrating repeated-failure preservation.

- Parity: all 92 corpus cases matched the tiktoken 0.11.0 reference
  token-for-token in Node and in real local workerd, including lone surrogates,
  ZWJ sequences, combining marks, special literals as ordinary text and all
  max-size records.
- Negative parity control: the corrupted expected token (`english[5]`,
  8197→8198) was detected and reported with case id and index.
- Discriminating power: all 16 discriminator pairs produced different
  reference encodings.
- Contract boundary in workerd: 16000-code-point ASCII/BMP/astral/mixed maxima
  validated through the real application `parseCommand` + generated schema; all
  one-over variants — including `oneOverMixed` — were rejected `INVALID_INPUT`.
- Bounded-execution negative tests (offline, in
  `tests/runtime-tokenizer-parity.mjs`): a never-replying inspector socket
  timed out as a classified harness safety failure; already-closed, protocol
  error, socket-close, and unparseable replies were each rejected; only an
  id-matching reply resolved; a hung child process group (middle child +
  grandchild) was actually terminated by the group kill — both PIDs verified
  dead — not abandoned by `Promise.race`; repeated failures left distinct
  preserved evidence directories.
- Load observations (not thresholds): workerd ready 544 ms; corpus parity in
  workerd 5.4 s; JS heap 31915888/34865152 used/total before the workload and
  105012236/173993984 after; batches of 1/10/100 maximum-size records
  (32000 tokens per record) completed in 1.4 s/13.2 s/135.0 s; full run
  172 s including installs.

Remaining adoption gates are parent-owned: contract wiring, memory-budget
policy, provenance/licensing publication, and deployed acceptance.
