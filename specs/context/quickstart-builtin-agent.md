# Context Evidence: quickstart-builtin-agent

> Stage 0 output of `/spec-bridge`. Evidence map + risk probes for the writer.
> Brief: `specs/feature-intake/quickstart-builtin-agent.md`.

## Affected packages

`@facet/core`, `@facet/react`, `@facet/client` (type-level), `@facet/server`,
`@facet/quickstart` (NEW), repo skills (`/live-test`). Runtime/agent/agent-client
carry the event whole (no reconstruction) — type-level only.

## A. core anchors

- `packages/core/src/nodes.ts:37-43` — `AgentAction { kind?: "agent"; name; payload? }`.
  **`collect?: NodeId` is added here.** `NodeId = string` at `nodes.ts:29`.
  `FacetAction` union at `nodes.ts:73`; `BoxNode.onPress` at `nodes.ts:112-124`.
- `packages/core/src/protocol.ts:33-36` — `ClientEvent` union; the `action` arm
  gains `fields?: Readonly<Record<string, string>>` (on the EVENT, not inside
  the action — per brief Decision Lock). `AgentEventFrame` wraps `event` whole
  (`protocol.ts:82-89`) → fields ride to external agents automatically.
- `packages/core/src/validate.ts:105-147` — `asAction`; agent branch (112-128)
  copies only `name`+`payload`. **`collect` is silently dropped today** — must
  be sanitized (string) and copied here. `sanitizeActionPayload` at 65-74;
  `isPrimitiveRecord` at 82-84 (used by server guard).
- `packages/core/src/spec.ts:12` — action doc line in `STAGE_SPEC`; `collect`
  + field-name guidance must be documented here (single source for prompts).
- Barrel `packages/core/src/index.ts:1-10` re-exports nodes/protocol — new
  types flow out automatically.

## B. react anchors

- `packages/react/src/StageRenderer.tsx`:
  - press flow: box render 248 → `classifyPress` 85-113 (agent branch 102-111
    must thread `collect`) → `handlePress` 151-173 → `onAction?.(press.action)`
    at 170-171 (**primary emit change site**).
  - `onAction` prop type at 120-124: `(action: FacetAction) => void` — must
    widen to deliver `fields`.
  - **fields are uncontrolled DOM-only**: `<input type name placeholder />` at
    296 — no value/onChange/ref/state. Collection needs NEW machinery: a
    container ref + DOM read by field `name` at press time, or ref-tracked
    fields. Largest renderer change; no precedent exists.
  - view-state precedent (invariant #6): `currentScreen` +
    `visibilityOverrides` at 140-143; navigate/toggle never reach `onAction`
    (152-169). Subtree enumeration precedent: data-side walk over
    `tree.nodes[id].children` (cf. `validate.ts:425-451` breakCycles).
- `packages/react/src/useFacet.ts:28-62` — event-shape-agnostic `send`;
  no change needed beyond types.
- jsdom test pattern: per-file `// @vitest-environment jsdom` +
  `@testing-library/react` (`StageRenderer.interaction.test.tsx:1-7,39-58`).
  No per-package vitest config; root `vitest.config.ts` globs cover `.tsx`.

## C. event path (fields survive; no lossy hop)

1. client `sse-transport.ts:43-51` — `JSON.stringify({ visitor, event })` whole.
2. client `local-transport.ts:25-27` — passes event whole.
3. server `server.ts:541-544` → `handleEvent` 308-356; body parsed whole,
   `runtime.handle(visitor, event)` at 334. **Per-kind guard `isEventBody`
   `server.ts:127-155`**: action branch 143-153 validates `name`/`payload`
   only — **fields validation (string-record, 2000-char cap) must be added
   here** (guard is boolean, doesn't strip).
4. runtime `runtime.ts:72-76,98-105,114-126` — event whole to agent + sink.
5. server `agent-channel.ts:140-149` — frame stringified whole.
6. agent-client `connect.ts:50-65,135-143` — type-guard only, passes whole.

**Construction sites that must add `fields` or it vanishes**:
`apps/playground/src/App.tsx:127`, `apps/playground/src/live.tsx:62`
(`send({ kind:"action", action })`), plus the renderer emit at
`StageRenderer.tsx:170-171`. Consumers that read actions (additive-safe, may
optionally surface fields): `bridge/src/bridge.ts:95-107`,
`bridge/src/persistent.ts:65`, `playground/src/live-agent.ts:27-28`,
`playground/src/nova.ts:91-92`, `agent/src/define-agent.ts:4-24` (the seam the
quickstart brain reads events through — no signature change).

## D. quickstart precedents

- LLM loop: `apps/playground/src/generator.ts` — `SYSTEM = STAGE_SPEC + wrapper`
  (9-13, layer-① precedent); `extractJson`/`balancedEnd`/`hasNodesObject`
  (16-75, **reusable LLM-output salvage**); `generatePage` (111-131) with
  current-page context (layer-③ precedent) + retry + `validateTree` at 122.
  Playground-only: `callClaude` spawns local `claude` CLI (77-90) — quickstart
  replaces with HTTP provider adapters.
- Stub precedent: `apps/playground/src/live-agent.ts:23-51` (`useLlm` flag,
  echo stub). Boot precedent: `apps/playground/src/server.ts:30-57`
  (`createFacetServer({...}).listen()` + print link; `FACET_AGENT=echo|none`).
- `createFacetServer` options: `server.ts:37-58` (`port, agentId, agent?,
  agentTimeoutMs?, agentStaleMs?, agentToken?, offlineFace?, stageStore?,
  sink?`); in-process agent wired via `channel.fallbackAgent`
  (`server.ts:456-461`).
- **GAP (must design): server serves NO page.** Routes = health/stream/event/
  agent/* then 404 (`server.ts:497-583`); playground page is Vite-served. The
  quickstart bin must serve an HTML shell + a prebuilt browser bundle
  (SseTransport + useFacet + StageRenderer).
- bin/package conventions: `packages/bridge/package.json` is the closest
  template (bin + library + external SDK deps; dev `src/*.ts` entries,
  `publishConfig` → `dist`, `files:["dist"]`, tsup build). `cli.ts:1` shebang.
- E2E harness: `packages/server/src/server.test.ts` — `start()` random-port
  boot (21-35), fetch POST fake clients, SSE readers `readEvents`/`readFrames`/
  `collectFrames`/`waitFor` (70-135). **`/live-test` Tier 1 reuses this
  pattern.**
- workspace: `pnpm-workspace.yaml` covers `packages/*` (auto-include).
  `.changeset/config.json` `fixed: [["@facet/*"]]` — new package auto-joins
  the fixed version group.

## Risk register input (writer MUST resolve each)

| Risk id | Detected (file:line) | Proposed resolution |
|---|---|---|
| RISK-INV-1 (#3 fail-safe, LLM output) | LLM boundary precedent `generator.ts:56-75,122`; stored-stage boundary `runtime.ts:157` | quickstart parsing mirrors extractJson→validateTree; malformed → error say + stage untouched (DC-006) |
| RISK-INV-2 (#6 two-writers, field values) | uncontrolled inputs `StageRenderer.tsx:296`; view-state 140-143 | fields = view-state read-only snapshot at press; travel only in the event; never patched into the tree |
| RISK-INV-3 (#1 boundary, brain in repo) | reference-impl precedent: `@facet/server` (transport), bridge deps pattern | brain lives in NEW optional `@facet/quickstart`; core/runtime/server gain zero LLM awareness; no domain tools v1 |
| RISK-API-1 (collect dropped) | `validate.ts:112-128` copies name+payload only | update asAction + classifyPress + STAGE_SPEC in ONE WU (single source stays true) |
| RISK-API-2 (fields vanish at construction) | `StageRenderer.tsx:170-171`, `App.tsx:127`, `live.tsx:62` | widen onAction to carry fields; update both playground construction sites in the same WU as the renderer change |
| RISK-API-3 (fields unvalidated server-side) | `isEventBody` `server.ts:143-153` | enforce cap/coercion in BOTH renderer (at collection, cap 2000 + String()) and server guard (reject non-string-record, cap) — untrusted client rule |
| RISK-PKG-1 (new package conventions) | `bridge/package.json` template; changeset fixed group | replicate dev-src/publish-dist split; add changeset |
| RISK-PKG-2 (dependency direction) | nothing imports playground (verified) | quickstart depends on core/runtime/agent/server (+client/react only for the served bundle); nothing depends on quickstart |
| RISK-PKG-3 (page-serving gap) | `server.ts:497-583` (404 fallback); playground page is Vite's | quickstart ships a PREBUILT browser bundle (built at package build time) + minimal HTML shell served by the quickstart bin's own static route — @facet/server stays transport-only |

## Flags for the writer

1. Page-serving is the largest unbuilt piece (RISK-PKG-3) — design it
   explicitly (bundling strategy, which package builds it, how the bin serves
   it) without touching @facet/server's route table.
2. Fields cap location: renderer AND server (defense in depth; RISK-API-3).
3. `fields` is NOT stage data — `validateTree` never sees it; do not route it
   through tree validation.
4. Provider adapters: external deps (openai / @anthropic-ai/sdk or raw fetch)
   — bridge's external-SDK precedent applies; keep them OUT of core/server.
