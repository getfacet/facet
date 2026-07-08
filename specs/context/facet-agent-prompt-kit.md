# Context Evidence: facet-agent-prompt-kit

## Scope

Planned feature: add reusable Facet LLM prompt-kit helpers to
`@facet/agent-tools`, then have `@facet/reference-agent` consume those helpers
through its existing `buildSystem(guide, assets?)` API.

This is an agent-authoring feature. It must not change `@facet/core` vocabulary,
validation, renderer behavior, runtime session handling, transports, or browser
local action semantics.

## Affected Packages And Entrypoints

- `@facet/agent-tools`
  - Current package role is provider-neutral stage tool mechanism:
    `docs/PACKAGE-BOUNDARIES.md:45-54`.
  - Package depends only on `@facet/core`:
    `packages/agent-stack/agent-tools/package.json:27`.
  - Public root export is `src/index.ts` in dev and `dist/index.*` when
    published: `packages/agent-stack/agent-tools/package.json:18-44`.
  - Current barrel exports tool specs/executor/observations/shadow only, no
    prompt kit yet: `packages/agent-stack/agent-tools/src/index.ts:1-53`.
- `@facet/reference-agent`
  - Current `buildSystem` owns generic workflow, tool-result, asset, and page
    brief prompt sections: `packages/agent-stack/reference-agent/src/prompt/system.ts:41-111`.
  - It imports `STAGE_SPEC` from `@facet/core` and tool specs from
    `@facet/agent-tools`: `packages/agent-stack/reference-agent/src/prompt/system.ts:5-12`.
  - Public root exports include `DEFAULT_GUIDE`, `TOOLS`, `buildSystem`,
    `buildInitialMessages`, and prompt types:
    `packages/agent-stack/reference-agent/src/index.ts:4-22`.
  - Compatibility tests pin these exports:
    `packages/agent-stack/reference-agent/src/index.test.ts:28-94`.
- `@facet/quickstart`
  - It re-exports `@facet/reference-agent`, so it is a transitive consumer:
    `packages/agent-stack/quickstart/src/index.ts:1-6`.
  - Its local prompt barrel re-exports `DEFAULT_GUIDE`, `buildSystem`, and
    `PromptAssets` from `@facet/reference-agent`:
    `packages/agent-stack/quickstart/src/prompt.ts:1-9`.
  - Docs describe `facet.md` as the final `PAGE BRIEF` layer:
    `packages/agent-stack/quickstart/README.md:80-105`.

## Current Prompt Behavior

- System prompt composition currently joins:
  - live-agent role line
  - `STAGE_SPEC`
  - `WORKFLOW`
  - `TOOL_RESULT_CONTRACT`
  - optional `THEMES`
  - optional `STAMPS`
  - final `PAGE BRIEF`
- Evidence: `packages/agent-stack/reference-agent/src/prompt/system.ts:97-111`.
- Existing tests require:
  - `STAGE_SPEC` is included:
    `packages/agent-stack/reference-agent/src/prompt.test.ts:65-76`.
  - structured tool-result outcomes are taught:
    `packages/agent-stack/reference-agent/src/prompt.test.ts:78-87`.
  - no-assets/empty-assets output remains identical:
    `packages/agent-stack/reference-agent/src/prompt.test.ts:125-134`.
  - theme names/descriptions are included but CSS values are not:
    `packages/agent-stack/reference-agent/src/prompt.test.ts:136-159`.
  - stamp names/descriptions/slots are included but node JSON is not:
    `packages/agent-stack/reference-agent/src/prompt.test.ts:161-186`.
  - `TOOLS` identity is exactly `FACET_STAGE_TOOL_SPECS`:
    `packages/agent-stack/reference-agent/src/prompt.test.ts:206-208`;
    `packages/agent-stack/agent-tools/src/specs.test.ts:32-40`.

## What Must Stay In Reference-Agent

- `DEFAULT_GUIDE` is a built-in sample page brief and belongs in the reference
  brain, not in `@facet/agent-tools`:
  `packages/agent-stack/reference-agent/src/prompt/system.ts:14-39`.
- Event/history/current-stage message assembly imports `StoredEvent` from
  `@facet/runtime`; moving it to `@facet/agent-tools` would break the package
  dependency boundary:
  `packages/agent-stack/reference-agent/src/prompt/messages.ts:8`;
  `packages/agent-stack/reference-agent/src/prompt/messages.ts:133-153`.
- Provider turn types remain in `@facet/reference-agent`:
  `packages/agent-stack/reference-agent/src/prompt/messages.ts:10`.

## Consumer Search

Commands run:

```bash
rg -n "buildSystem|DEFAULT_GUIDE|WORKFLOW|TOOL RESULT CONTRACT|PromptAssets|PAGE BRIEF|STAGE_SPEC|FACET_STAGE_TOOL|TOOL_RESULT_CONTRACT" packages docs specs -g '!**/dist/**'
rg --files packages/agent-stack/agent-tools packages/agent-stack/reference-agent packages/agent-stack/quickstart | sort
```

Observed consumers and anchors:

- `packages/agent-stack/reference-agent/src/agent.ts:54-60` builds the system
  once with `buildSystem(options.guide ?? DEFAULT_GUIDE, { themes, stamps })`.
- `packages/agent-stack/quickstart/src/agent.test.ts` and
  `packages/agent-stack/reference-agent/src/agent.test.ts` assert provider turns
  contain `DEFAULT_GUIDE`.
- `packages/agent-stack/quickstart/src/quickstart.e2e.test.ts` asserts
  quickstart prompt exports are identical to reference-agent prompt exports.
- Prior specs mention prompt behavior, but current implementation consumers are
  the package tests and re-export surfaces above.

## Risk Probes

### INV Probe

| Risk id | Detected (file:line) | Risk |
|---|---|---|
| RISK-INV-1 | `AGENTS.md:29`; `docs/ARCHITECTURE.md:303`; `docs/ARCHITECTURE.md:330`; `packages/agent-stack/reference-agent/src/prompt/system.ts:17`; `packages/agent-stack/reference-agent/src/prompt/system.ts:41`; `packages/agent-stack/reference-agent/src/prompt/system.ts:110` | Moving more than generic stage/tool prompt fragments into `@facet/agent-tools` would turn the mechanism package into reference brain policy. Keep `DEFAULT_GUIDE`, deployer `PAGE BRIEF`, and reference-brain sample policy owned by `@facet/reference-agent`. |
| RISK-INV-2 | `AGENTS.md:14`; `docs/ARCHITECTURE.md:49`; `packages/core/core/src/spec.ts:1`; `packages/core/core/src/spec.ts:10`; `packages/core/core/src/spec.ts:17`; `packages/agent-stack/reference-agent/src/prompt/system.ts:101`; `packages/agent-stack/reference-agent/src/prompt.test.ts:89` | Prompt kit must not fork Facet vocabulary text. `STAGE_SPEC` remains the single prompt source for bricks, token-only style values, and flow-only layout. |
| RISK-INV-3 | `docs/ARCHITECTURE.md:122`; `docs/ARCHITECTURE.md:144`; `packages/agent-stack/reference-agent/src/prompt/system.ts:66`; `packages/agent-stack/reference-agent/src/prompt/system.ts:79`; `packages/agent-stack/reference-agent/src/prompt.test.ts:136`; `packages/agent-stack/reference-agent/src/prompt.test.ts:161` | Asset helpers can leak CSS values or stamp node JSON if generalized carelessly. Prompt kit must expose names/descriptions/slot names only. |
| RISK-INV-4 | `docs/ARCHITECTURE.md:361`; `docs/ARCHITECTURE.md:371`; `packages/agent-stack/reference-agent/src/prompt/system.ts:49`; `packages/agent-stack/reference-agent/src/prompt.test.ts:78` | Fail-safe recovery can regress if tool workflow is separated from the structured observation contract. The shared prompt must keep outcome/visibility/warning/next-action guidance. |
| RISK-INV-5 | `docs/ARCHITECTURE.md:89`; `docs/ARCHITECTURE.md:381`; `packages/core/core/src/spec.ts:11`; `packages/core/core/src/spec.ts:12`; `packages/agent-stack/reference-agent/src/prompt.test.ts:330` | Prompt guidance must preserve the distinction between server-authored stage content and browser-owned view/input state. |
| RISK-INV-6 | `docs/ARCHITECTURE.md:440`; `docs/ARCHITECTURE.md:303`; `packages/agent-stack/agent-tools/src/index.ts:1`; `packages/agent-stack/agent-tools/src/specs.ts:21` | Prompt kit must stay limited to Facet stage/tool guidance, not backend/domain task policy. |

### API Probe

| Risk id | Detected (file:line) | Risk |
|---|---|---|
| RISK-API-1 | `packages/agent-stack/agent-tools/package.json:18`; `packages/agent-stack/agent-tools/src/index.ts:1`; `specs/feature-intake/facet-agent-prompt-kit.md:102` | New prompt-kit exports become root public API because `@facet/agent-tools` exposes only `"."`; names and barrel coverage need tests. |
| RISK-API-2 | `packages/agent-stack/agent-tools/package.json:27`; `packages/agent-stack/agent-tools/README.md:8`; `specs/feature-intake/facet-agent-prompt-kit.md:81` | Prompt kit must not pull `@facet/reference-agent`, provider SDKs, Node-only APIs, or quickstart into `@facet/agent-tools`. |
| RISK-API-3 | `packages/agent-stack/reference-agent/src/index.ts:4`; `packages/agent-stack/reference-agent/src/index.test.ts:32`; `packages/agent-stack/reference-agent/src/index.test.ts:90`; `specs/feature-intake/facet-agent-prompt-kit.md:87` | `@facet/reference-agent` must keep `DEFAULT_GUIDE`, `PromptAssets`, `buildSystem`, and `TOOLS` root exports and the same `buildSystem(guide, assets?)` shape. |
| RISK-API-4 | `packages/agent-stack/reference-agent/src/prompt/system.ts:98`; `packages/agent-stack/reference-agent/src/prompt.test.ts:65`; `packages/agent-stack/reference-agent/src/prompt.test.ts:78`; `packages/agent-stack/reference-agent/src/prompt.test.ts:125`; `packages/agent-stack/reference-agent/src/prompt.test.ts:136`; `packages/agent-stack/quickstart/README.md:80` | Prompt text is observable behavior. Section names/reordering must be intentional and tests/docs must reflect changes. |
| RISK-API-5 | `packages/agent-stack/reference-agent/src/prompt/system.ts:114`; `packages/agent-stack/reference-agent/src/prompt.test.ts:206`; `packages/agent-stack/agent-tools/src/specs.test.ts:32` | `TOOLS` identity must remain exactly `FACET_STAGE_TOOL_SPECS`, not a cloned prompt-kit copy. |
| RISK-API-6 | `packages/agent-stack/quickstart/src/index.ts:1`; `packages/agent-stack/quickstart/src/prompt.ts:1`; `packages/agent-stack/quickstart/src/quickstart.e2e.test.ts:199`; `specs/feature-intake/facet-agent-prompt-kit.md:144` | Quickstart is a transitive consumer; new prompt-kit exports should not accidentally broaden quickstart API unless intentionally documented. |

### PKG Probe

| Risk id | Detected (file:line) | Risk |
|---|---|---|
| RISK-PKG-001 | `packages/agent-stack/agent-tools/package.json:27`; `packages/agent-stack/reference-agent/src/prompt/messages.ts:8`; `packages/agent-stack/reference-agent/src/prompt/messages.ts:133` | Extracting message/history code into `@facet/agent-tools` would leak `@facet/runtime` into the agent-tools public surface. |
| RISK-PKG-002 | `packages/agent-stack/reference-agent/src/prompt/system.ts:9`; `packages/agent-stack/reference-agent/src/provider/types.ts:1` | Moving `prompt/system.ts` as-is would import reference provider types or create the wrong dependency direction. |
| RISK-PKG-003 | `tsconfig.base.json:23`; `packages/agent-stack/agent-tools/package.json:20`; `packages/agent-stack/agent-tools/package.json:38` | A new `@facet/agent-tools/prompt-kit` subpath would need path/export map updates. Prefer root exports for this PR. |
| RISK-PKG-004 | `packages/agent-stack/agent-tools/package.json:25`; `packages/agent-stack/agent-tools/package.json:30`; `packages/agent-stack/agent-tools/src/index.ts:1` | New helpers must be re-exported from the barrel to be part of the supported public API. |
| RISK-PKG-005 | `docs/PACKAGE-BOUNDARIES.md:45`; `docs/PACKAGE-BOUNDARIES.md:75`; `packages/agent-stack/reference-agent/src/prompt/system.ts:14` | Extracting `DEFAULT_GUIDE` or reference-agent-specific sample policy into `@facet/agent-tools` would blur taxonomy. |
| RISK-PKG-006 | `packages/agent-stack/reference-agent/src/index.ts:4`; `packages/agent-stack/reference-agent/src/prompt.ts:1` | Moving existing reference-agent prompt APIs instead of wrapping/delegating would be a compatibility break. |

## Design Direction From Evidence

- Add a root-exported prompt kit module under `@facet/agent-tools` rather than a
  subpath export in this PR.
- The kit may import `STAGE_SPEC` and Facet asset types from `@facet/core`
  because `@facet/agent-tools` already depends on `@facet/core`.
- The kit must not import `@facet/reference-agent`, `@facet/runtime`, provider
  types, Node built-ins, quickstart, or package-local reference harness code.
- Keep `DEFAULT_GUIDE`, `buildInitialMessages`, `describeEvent`, stage summary,
  provider adapters, and harness context in `@facet/reference-agent`.
- `@facet/reference-agent buildSystem` should become a compatibility wrapper
  around the kit and keep `TOOLS` as the exact `FACET_STAGE_TOOL_SPECS` object.
- Tests should pin both API shape and the model-facing guidance semantics:
  compact UX, edit-before-append, tool-result recovery, asset metadata-only, and
  privacy redaction/no sensitive literals.
