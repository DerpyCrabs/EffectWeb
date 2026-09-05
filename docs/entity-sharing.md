# Entity sharing before presentation

The measured result supports keeping this implementation. It reduces repeated presentation work on refetched and serialized data while ordinary single-tab edits remain comparable. Grouped compiler dependency checks remain a separate experiment.

| Workload, 1,000 rendered messages | Previous median CPU | Candidate median CPU |                Change |
| --------------------------------- | ------------------: | -------------------: | --------------------: |
| Owner-tab edit                    |            21.81 ms |             21.80 ms | effectively unchanged |
| Owner-tab history page            |            48.20 ms |             50.23 ms |                 +4.2% |
| Owner-tab burst of 20 messages    |           809.90 ms |            828.89 ms |                 +2.3% |
| Follower-tab edit                 |            49.17 ms |             18.63 ms |                -62.1% |
| Follower-tab history page         |            68.60 ms |             51.16 ms |                -25.4% |
| Follower-tab burst of 20 messages |           249.87 ms |            203.19 ms |                -18.7% |

These are medians across three alternating baseline/candidate pairs on one machine. Follower edit DOM-ready time fell from 63.9 to 33.0 ms; settled time fell from 71.0 to 49.35 ms. Both variants retained existing message DOM nodes during edits. All benchmark rounds reported zero errors. This is workload evidence, not a general performance guarantee.

The initial three first-open samples were noisy, so a separate 12-pair opening check was run. Median CPU was 45.12 versus 45.61 ms, a 1.1% increase; median settled time was 42.25 versus 47.85 ms. The candidate adds 270 gzip bytes to the clean TeleVecha fixture build, from 433,595 to 433,865 bytes. Every clean candidate asset was byte-compared against the assets served during measurement. Median retained heap after loading the follower history was 39.85 versus 39.33 MiB; no memory claim is made from that small difference.

The presenter-only probe used 200 dialogs and 500 messages. Reordered refetches went from 17.57 to 1.04 ms, refetched edits from 17.27 to 0.81 ms, unchanged refreshes from 2.74 to 0.74 ms, and local edits from 0.44 to 0.09 ms. Its input cloning is outside the timer. Unchanged entities retain their previous presentation objects even when their positions move.

[Measurement metadata and summaries](entity-sharing-results.json) include every measured browser workload, per-variant sample counts, timings, DOM replacement counts and build sizes.

EffectWeb now supports sharing immutable entities before query results or application snapshots reach presentation functions. Collections declare identity once for both sharing and rendered rows. `collection(identity).share(previous, incoming)` keeps unchanged entities through insertion, deletion and reorder. It returns the previous array for equal results, preserves already-shared incoming arrays, and compares changed entities recursively. Reference-equal items bypass key lookup and comparison; a lookup map is allocated when identity moves. Repeated array comparisons use weak caches local to the collection definition.

`shareValue(previous, incoming, fields)` composes field-specific strategies with default sharing for the rest of a JSON-shaped record. Custom comparisons are separate from the ordinary object-pair cache, so a previous positional comparison cannot override an explicit collection strategy. Query definitions accept `share(previous, incoming)` and apply it before publishing into their existing AtomRegistry entry. Observers and prefetch share the result and keep the existing invalidation, ownership and error behavior.

This adds no global entity store, JSX keys, reactive proxies or compiler transforms. The renderer already shares row data by identity; earlier sharing lets application presenters reuse their caches before rendering begins. Generic array sharing remains positional unless a collection strategy is supplied. Identity must be unique within the collection and include its parent scope where needed. Matching identity selects the old value to compare; it never declares changed data equal.

## Consumers

TeleVecha declares reusable peer, message and ID collections in `src/domain/collections.ts`. Engine and cross-tab snapshots share dialogs, messages, pinned messages and pending sends before its existing cached presenters run. Message identity includes peer ID. Account snapshot publication uses only the account strategies, while the generic state owner receives its comparison function explicitly.

LocalChat keeps its application-specific optimistic acknowledgement and streaming recovery. It delegates the final entity and array comparison to its existing message collection, preserving render keys and reusing the entire message array after unchanged refreshes.

Inbox declares capture identity once and uses it for search-result sharing and rendering. Query metadata still updates normally, and changed processing/enrichment data is compared rather than ignored.

## Release

Entity sharing is included in EffectWeb 0.2.2. Install the runtime and matching integrations from npm:

```sh
npm install effectweb@0.2.2 @effectweb/compiler@0.2.2 @effectweb/lucide@0.2.2
```

The measurements below used local packages built from the same runtime source before release.

## Measurement

TeleVecha's `node scripts/benchmark-entity-sharing.mjs OUTPUT_JSON` compares the previous snapshot algorithm against the current implementation using its real cached presenters. It uses synthetic 200-dialog/500-message snapshots, prepares fresh inputs outside the timer, alternates execution order and discards four warmup pairs. It reports entity reuse as well as timing. It does not measure DOM rendering or claim a whole-app speedup.

`TELEVECHA_BENCH_IDLE_MS=0 node scripts/benchmark-ui.mjs BASELINE_DIST CANDIDATE_DIST OUTPUT_JSON 3` compares production builds, including direct DOM work, frame completion, CPU, DOM identity and retained heap. Both builds must use `VITE_TELEVECHA_E2E=1`. Add `TELEVECHA_BENCH_FOLLOWER=1` to keep the transport in a separate tab and measure a follower receiving actual serialized snapshots. That mode reports follower-tab CPU; end-to-end latency also includes transport-tab work and the benchmark's fixture bridge. The transport tab initially opens a different chat.

Performance runs must be sequential with tests stopped. The presenter probe uses its own temporary Vite cache, and browser runs use static build directories. Inbox validation runs in a temporary copy to preserve its live assets. LocalChat's temporary test copy uses ports 13234/13917 after its normal mock-provider port failed to bind.

For the supplementary opening check, set `TELEVECHA_BENCH_OPEN_ONLY=1` and use 12 pairs. It uses the same setup and first-open measurement as the full browser benchmark, then closes the context.

## Verification

- EffectWeb: 160 unit tests, nine Rust tests, 28 browser tests, clean packed consumption including the new sharing API, lint/types and bundle budgets passed.
- TeleVecha: 320 unit tests and all 302 browser tests passed. The composer-growth and TGS cases also passed five repetitions each after isolating the test setup. Formatting, lint/types, browser types and a clean production fixture build passed.
- LocalChat: 29 unit tests and 23 browser tests passed, with 13 existing skips. Lint/types and production build passed; pre-existing Effect migration advisories remain. The final browser run used fresh fixture storage and a separate optimizer cache.
- Inbox: 22 unit tests and 37 browser tests passed in the temporary copy, along with checks and a production build. Its live output was preserved.

Initial verification attempts exposed an outdated Vite optimizer response and reused on-disk skill fixtures. Final timing runs were performed after tests stopped; the benchmark cache and fixture directories were isolated. No derp-media-server files were read or changed during this implementation.
