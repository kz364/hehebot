# Memory tokenizer parity and local-workerd load harness

Status: **local harness deliverable only.** This document describes the
repeatable, credential-free verification harness in `scripts/test-memory-tokenizer.mjs`.
It is not application tokenizer adoption, not a memory-budget implementation,
not a licensing conclusion, and not production or deployed acceptance.

## What the harness proves

1. **Token-for-token parity** between the candidate `gpt-tokenizer@4.0.0`
   (narrow import `gpt-tokenizer/encoding/o200k_base`, `setMergeCacheSize(0)`,
   `encode(text, { allowedSpecial: new Set(), disallowedSpecial: new Set() })`)
   and the official OpenAI `tiktoken==0.11.0` Python `o200k_base`
   `encode_ordinary` reference, on a deterministic varied corpus.
2. **The same parity inside real local workerd** (installed Miniflare) with the
   actual application module (`src/worker/index.ts` and `src/core/control.ts`)
   bundled into the same isolate as the candidate.
3. **Realistic load behavior** at the current memory-text contract limit,
   including multi-record batches of maximum-size records.
4. **Its own negative controls**: corrupted expected tokens, altered artifacts,
   and non-discriminating corpus shapes are all detected as failures.

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
never modified. On any failure the disposable environment is retained (path
printed) and failure evidence is written to
`.local/memory-tokenizer-harness-failure.json`; on success the environment is
removed and evidence lands in `.local/memory-tokenizer-harness.json`
(`.local/` is gitignored).

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

## Methodology

**Corpus.** `buildCorpus()` is pure and deterministic (mulberry32 PRNG, no
clocks, no `Math.random`), so every run compares the identical inputs
(corpus SHA-256 recorded in evidence). Coverage: English/Indonesian/Chinese/
Arabic/mixed text, code/JSON/URL/markdown, whitespace and CRLF variants,
contractions (ASCII and Unicode apostrophes), combining marks (decomposed and
precomposed), emoji and ZWJ sequences, lone surrogates (high, low, consecutive,
reversed), special literals as ordinary text (`` and `<|im_start|>` forms are
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
mixed maxima (exactly 16000 code points) plus one-over variants (16001), and
the harness validates max and one-over payloads against the real generated
memory command schema through the real application `parseCommand` path inside
workerd: maxima must validate, one-over must be rejected `INVALID_INPUT`.
One-over cases are workload-boundary probes only; parity is still compared.
No product limit is changed, and no total-memory-count bound is claimed — the
application currently has a per-record text limit only.

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
but **never calls any application or provider route**. Heap usage is read via
the inspector WebSocket (`Runtime.getHeapUsage`) after selecting the exact
named user Worker target from `/json/list` (`/core:user:<name>`), never a
router isolate. Batches of 1, 10, 100 maximum-size records are posted and their
token counts checked against the reference. Workers and the temporary install
are always disposed/removed.

## What the harness does not prove

- Used/total JS heap (`Runtime.getHeapUsage`) is **not** total isolate memory;
  total isolate memory is not directly observable through this harness.
- Wall-clock startup and request latency are **not** billed CPU time; billed
  CPU is not observable in local workerd.
- Local workerd is **not** deployed acceptance.
- All timings are workload observations on one machine, not thresholds, not
  gates, and not product acceptance.
- No total-memory-count bound is claimed or tested; the application has a
  per-record memory-text limit only.
- gpt-tokenizer's wider API (special-token handling, decoding, other encodings)
  is out of scope; only the narrow `o200k_base` ordinary-text path above is
  verified.

## Observed results (one local run)

Run 2026-09-21 from the task branch at source-custody HEAD `29d8806`
(orb, Node 26, Linux x64); machine-readable evidence in
`.local/memory-tokenizer-harness.json` (corpus sha256
`87f9eb3f1622cdadc2b468ef8007900efd59abe407b3fff820b9c167a709a603`, 91 cases).

- Parity: all 91 corpus cases matched the tiktoken 0.11.0 reference
  token-for-token in Node and in real local workerd, including lone surrogates,
  ZWJ sequences, combining marks, special literals as ordinary text and all
  max-size records.
- Negative parity control: the corrupted expected token (`english[5]`,
  8197→8198) was detected and reported with case id and index.
- Discriminating power: all 16 discriminator pairs produced different
  reference encodings.
- Contract boundary in workerd: 16000-code-point ASCII/BMP/astral/mixed maxima
  validated through the real application `parseCommand` + generated schema; all
  one-over variants were rejected `INVALID_INPUT`.
- Load observations (not thresholds): workerd ready 521 ms; corpus parity in
  workerd 8.6 s; JS heap 31912180/34865152 used/total before the workload and
  123046616/172941312 after; batches of 1/10/100 maximum-size records
  (32000 tokens per record) completed in 1.7 s/14.1 s/134.1 s; full run
  175 s including installs.

Remaining adoption gates are parent-owned: contract wiring, memory-budget
policy, provenance/licensing publication, and deployed acceptance.
