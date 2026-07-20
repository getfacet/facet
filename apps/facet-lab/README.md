# Facet Lab

Facet Lab is Facet's complete local developer workbench for inspecting the
closed UI vocabulary, exercising the reference agent, and investigating
recorded behavior. It lives in this repository as the private `@facet/lab`
workspace and composes the real Core, assets, reference-agent, runtime,
transport, and React renderer paths.

Facet Lab is deliberately:

- an unpublished dependency-leaf app, not an npm package or integration
  entrypoint;
- local/self-hosted contributor tooling, not a hosted or multi-tenant SaaS;
- a durable diagnostic workbench, not the zero-setup Quickstart experience; and
- outside Facet's public package contract. Public packages must never depend on
  it.

Use [Quickstart](../../packages/tools/quickstart/README.md) when you want the
shortest way to see one reference-agent page. Use Facet Lab when you need the
Catalog, official scenarios, immutable run evidence, evaluation, replay,
comparison, or the Contract Sandbox. See the [root package chooser](../../README.md)
when selecting an API to integrate into an application.

## Launch locally

Facet Lab requires Node.js 20 or newer and pnpm 9. From the repository root:

```bash
corepack enable
pnpm install
pnpm --filter @facet/lab build
pnpm --filter @facet/lab serve
```

Open `http://127.0.0.1:5293`. `serve` starts one same-origin loopback server for
the built browser app, the bounded Lab API, the live Facet transport, and
evidence persistence. Rebuild after browser changes before restarting it. The
Vite `dev` script serves browser assets only and is not the complete workbench
server.

Generate always uses a configured real provider. Put one or both keys in the
server process environment; values remain Node-only. The deterministic fixture
is reserved for contributor regression tests and is not exposed in the
workbench UI:

```bash
OPENAI_API_KEY=sk-… pnpm --filter @facet/lab serve
# or
ANTHROPIC_API_KEY=sk-ant-… pnpm --filter @facet/lab serve
```

Supported server configuration:

| Variable | Meaning |
| --- | --- |
| `OPENAI_API_KEY` | Enables the configured OpenAI models. The browser receives only availability and allowlisted model IDs. |
| `ANTHROPIC_API_KEY` | Enables the configured Anthropic models under the same boundary. |
| `FACET_LAB_OPENAI_MODELS` | Optional comma-separated OpenAI model allowlist. Without it, Lab offers GPT-5.6 Sol/Terra/Luna, GPT-5.5/Pro, and GPT-5.4/Pro/mini/nano. |
| `FACET_LAB_ANTHROPIC_MODELS` | Optional comma-separated Anthropic model allowlist. |
| `FACET_LAB_PORT` | Loopback port, `5293` by default. |
| `FACET_LAB_DATA_DIR` | External application-data root. It must resolve outside the repository checkout. |

Settings reports only safe capability booleans, model identifiers, operational
bounds, and a generic data-location label. It never reports key values, request
headers, or an absolute secret-bearing configuration path.

## Workbench map

The five primary areas have stable keyboard-accessible navigation. Secondary
routes keep related work together.

| Area | Routes | What it is for |
| --- | --- | --- |
| Catalog | `/catalog` | Search package-defined Bricks, Presets, Patterns, token values, and fixed choices; compare each isolated preview with its exact Facet document and package definition. |
| Generate | `/generate`, `/scenarios` | Run a free-form prompt or an official scenario through a configured real provider, then interact with the live stage using the package-default Theme and Patterns. |
| Runs | `/runs`, `/runs/:runId` | Filter immutable history and inspect correlated traces, provenance, checks, visual evidence, usage, warnings, and artifacts. |
| Replay | `/replay`, `/replay/:runId`, `/compare` | Scrub accepted checkpoints without a provider, open a capture-safe immutable run route, and compare two to four records with explicit evidence gaps. |
| Sandbox | `/sandbox`, `/settings` | Create or clone an isolated safe tree, apply revision-checked patches, checkpoint view state separately, and inspect secret-free server capabilities. |

The shell supports light and dark workbench chrome, named landmarks, visible
focus, skip navigation, and arrow/Home/End movement across the primary areas.
Generated-stage color mode remains separate Facet view state.

## Catalog and asset truth

Catalog does not maintain a second asset roster. It derives:

- Brick identities and definitions from `@facet/core`'s public contracts;
- token and fixed-choice metadata from Core's style-value contract; and
- defaults, same-Brick Presets, and Patterns from the package-default Theme and
  Pattern list in `@facet/assets`.

Consequently, adding or removing package-defined assets changes Catalog through
the package source rather than a Lab-only list. Each item is either rendered or
shown with an item-scoped diagnostic; an empty category and a load failure are
different states.

Every renderable item has three explicitly separate inspector views:

- **Preview** renders an isolated example through `StageRenderer`;
- **Facet document** shows and copies the complete validated tree passed to that
  renderer, including its root, nodes, and applied style values; and
- **Package definition** shows the Core contract or selected asset data that
  defines what is allowed or reusable. It is not necessarily a stage document.

Token values and fixed choices also receive a validated example document. Lab
places the selected value on one compatible Brick style property discovered
from Core's contract, so the preview and JSON demonstrate actual usage without
inventing a second vocabulary.

Facet Lab always uses `@facet/assets` package defaults for new runs. It exposes
the default Theme and Patterns read-only for Catalog previews and records a
detached, content-digested snapshot with each run. Custom Theme/Pattern import
is intentionally not a Lab feature; use the package authoring workflow when
testing a custom design system in an integrating application.

Use the [Design System guide](../../docs/DESIGN-SYSTEM.md) to author a Theme or
Pattern; Lab is an inspector and validator, not a general visual page builder.

## Generate and scenarios

Generate separates three choices and always executes through a configured real
provider/model:

1. **Free-form or official.** Free-form uses the operator prompt. Official
   scenarios provide a checked brief.
2. **Autonomous or constrained assets.** Autonomous lets the agent discover the
   package-default snapshot. A constraint names one exact `brick:…`, `pattern:…`, or
   `preset:<brick>:<name>`; unavailable and known-unmet constraints are shown
   instead of silently passing.
3. **Viewport and color mode.** Each run records mobile, tablet, or desktop plus
   light or dark provenance.

The eight official scenario families are:

- Landing and marketing;
- Analytics dashboard;
- Table and chart data;
- Settings form;
- Documentation and content;
- Product list and detail;
- Support triage; and
- Loading, empty, error, and result lifecycle states.

Starting a run creates a distinct run/session/visitor/generation identity. One
in-flight button activation is deduplicated; a later intentional start creates
a new run rather than merging stages. The live page uses the normal Facet
UI-IN path for actions and follow-up messages. Cancel is scoped to the selected
run, and the last valid stage remains inspectable after failure or cancellation.

## Evidence, evaluation, and artifacts

Runs distinguish `queued`, `running`, `complete`, `failed`, `cancelled`, and
`incomplete`. A v1 run record keeps bounded, correlated evidence including:

- immutable run, provider/model, scenario, prompt, constraint, viewport,
  color-mode, asset-digest, and import provenance;
- the run-owned Theme/Pattern snapshot and initial/final trees;
- UI-IN and diagnostic records, accepted frames, RFC 6902 patches, turn IDs,
  ordinals, stage versions, and view checkpoints;
- provider usage when supplied, classified warnings, overflow/redaction state,
  contract checks, visual evaluations, and artifact metadata.

Run detail keeps deterministic contract/safety checks separate from advisory
human or vision evidence. Missing or failed visual evaluation stays explicitly
unavailable/failed and cannot turn the blocking contract verdict into a pass.
Actions can cancel an active run, recalculate contract checks, request the
six-condition viewport/color capture matrix, download artifacts, and export a
run bundle. Partial evidence remains useful when a provider fails or a bound is
reached.

Exports are bounded, versioned, digest-checked JSON bundles and pass through a
fresh redaction/secret scan. Imports validate the complete envelope, evidence,
digest, and artifacts before storage, then receive a new local identity while
retaining `importedFromRunId` provenance. A corrupt or incompatible import does
not become trusted history.

## Storage, replay, and comparison

Evidence is stored outside the checkout. Without an override, Facet Lab uses
the platform application-data location:

- macOS: `~/Library/Application Support/Facet Lab`;
- Windows: the local/app data directory under `Facet Lab`; and
- Linux: `$XDG_DATA_HOME/facet-lab` or `~/.local/share/facet-lab`.

`FACET_LAB_DATA_DIR` may select another external root. The server refuses a
resolved path inside the repository. Run bundles are written atomically under
the root's `runs` directory, and the store retains 500 runs by default. Product
bounds include 20,000 prompt code units, 2 MiB JSON requests, 32 MiB evidence
bundles, a 24 MiB ceiling for the asset snapshot embedded in imported run
evidence with an 8 MiB terminal-evidence reserve, 10,000 evidence items per run,
depth 32, and 250,000 projected nodes. The shared run contract is authoritative
if these values change.

Replay starts from recorded state and folds only accepted patches; it never
calls a provider. The scrubber remounts on run identity changes, reports digest
or ordering gaps, and hydrates only sanitized recorded view checkpoints.
Comparison is likewise read-only: it accepts two to four records and shows
provider/model/assets/scenario/view provenance and missing dimensions rather
than inventing equivalence.

## Contract Sandbox

Sandbox direct-authoring accepts only a validated Facet tree, bounded RFC 6902
patch array, and sanitized view checkpoint. It rejects raw markup, executable
content, arbitrary style keys, malformed pointers, and out-of-contract trees.

Create starts an isolated session. Clone first copies a live or saved run's
tree, Theme, identity provenance, and revision into that session; it never
makes the source writable. Patch and view mutations use compare-and-swap
revisions. A stale, malformed, prohibited, or invalid edit keeps the last safe
preview and original clone visible. View checkpoints are stored separately from
the Facet tree, preserving the document/view writer boundary.

## Contributor gates

Focused development commands:

```bash
pnpm --filter @facet/lab exec playwright install chromium
pnpm --filter @facet/lab typecheck
pnpm --filter @facet/lab test
pnpm --filter @facet/lab build
pnpm --filter @facet/lab test:e2e
pnpm --filter @facet/lab test:e2e:deterministic
pnpm --filter @facet/lab test:e2e:boundaries
pnpm --filter @facet/lab test:e2e:a11y
node scripts/check-lab-gates.mjs --mode deterministic
```

Install Chromium once on a new contributor machine. `test:e2e` runs the whole
Lab browser suite; the narrower commands support focused diagnosis. Run the
deterministic journey twice when checking reproducibility. The boundary journey
owns invalid-input, race/cancellation, offline-recovery, corruption, and
secret-canary coverage; the accessibility journey owns keyboard and automated
accessibility checks. The deterministic journey installs a test-only browser
adapter; it does not restore a deterministic choice in Generate.

Real-provider evidence is key-gated:

```bash
OPENAI_API_KEY=sk-… pnpm --filter @facet/lab test:e2e:live
# and/or ANTHROPIC_API_KEY=sk-ant-…
```

A missing key is never reported as a provider pass. Required-key gates fail
when the key is absent; an explicitly optional owner-run visual journey reports
a visible skip. Deterministic contract failures always block regardless of
provider or visual availability.

The gate wrapper uses `FACET_LAB_LIVE_REQUIRED=1` for a blocking provider
journey and `FACET_LAB_OPTIONAL_VISUAL=1` for the advisory visual tier. Run the
wrapper instead of setting these policy variables by hand:

```bash
node scripts/check-lab-gates.mjs --mode required-provider
node scripts/check-lab-gates.mjs --mode optional-visual
```

Before handing off a repository change, run the applicable Facet hard gate and
the root mechanical gate:

```bash
pnpm verify
```

Facet Lab complements the repository's existing `/live-test`; it does not
replace Quickstart evidence or change Quickstart's zero-setup behavior.

## Trust boundary

The bundled host binds only to numeric loopback and rejects foreign Host/Origin,
unsafe path, oversized body, and direct inner-agent-channel requests. That is a
local-workbench boundary, not user authentication or tenant authorization. Do
not expose the server directly to a shared or public network. A production
platform must supply identity, authorization, rate limits, billing/metering,
secrets management, durable operations, and abuse controls.

See [Security](../../SECURITY.md) and
[Package Boundaries](../../docs/PACKAGE-BOUNDARIES.md) for the surrounding trust
and deployment model.
