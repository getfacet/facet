export const meta = {
  name: 'spec-bridge',
  description: 'Facet spec bridge — fanned-out context (package map + parallel risk-lens probes) → single writer → an independent multi-reviewer gate panel → bounded fix loop. Stops at an approvable plan.',
  whenToUse: 'After a feature-intake brief is approved. Pass args.slug. Produces specs/context, specs/dev-specs (+ execution manifest), and a panel verdict. The calling agent asks the human for approval — this workflow never starts implementation.',
  phases: [
    { title: 'Context', detail: 'map affected packages + gather evidence, then parallel RISK-lens probes (INV / API / PKG), then write the context file', model: 'opus' },
    { title: 'Write', detail: 'single spec writer (separate context) → dev-spec + execution manifest', model: 'opus' },
    { title: 'Review', detail: 'independent multi-reviewer panel, one per gate-family, unioned (none saw the writer)', model: 'opus' },
    { title: 'Fix loop', detail: 'if P0/P1: fixer edits the spec, re-run the whole review panel (max 3 rounds)', model: 'opus' },
  ],
}

// spec-bridge: Context is FANNED OUT (a package-map agent + parallel risk-lens probes + a context writer);
// Write stays a SINGLE author (one coherent artifact); Review is FANNED OUT into an independent panel of
// gate-family reviewers whose findings are unioned; then a bounded fix→re-review loop. Reviewers never see
// the writer's reasoning (fresh agents). The human-approval step is intentionally OUTSIDE this workflow —
// it returns awaitingApproval/escalate and the /spec-bridge skill asks. Invoked via
// Workflow({name:'spec-bridge', args:{slug:'<slug>'}}).

const MAX_ROUNDS = 3
const M = 'opus'

// Tolerate args arriving JSON-stringified (the harness sometimes stringifies an
// object arg) so the slug never becomes the literal `{"slug":"..."}` string.
let a = args
if (typeof a === 'string' && a.trim().startsWith('{')) { try { a = JSON.parse(a) } catch {} }
const slug = (a && typeof a === 'object' && typeof a.slug === 'string' && a.slug.trim())
  ? a.slug.trim()
  : (typeof a === 'string' && a.trim() ? a.trim() : '')
if (!slug) return { error: "No slug provided. Pass it as args: Workflow({name:'spec-bridge', args:{slug:'<slug>'}})." }

const briefPath = 'specs/feature-intake/' + slug + '.md'
const contextPath = 'specs/context/' + slug + '.md'
const specPath = 'specs/dev-specs/' + slug + '.md'
const manifestPath = 'specs/dev-specs/' + slug + '.execution.yaml'

// ─── Risk-lens probes: each is an independent investigation (fan-out for coverage) ───
const RISK_LENSES = [
  { key: 'INV', label: 'invariant probe', focus:
    'Facet invariants the brief marks TOUCHES (esp. #5 overlay/flow-only, #6 two-writers coherence, #1 backend/UI-out). ' +
    'For each touched invariant, find the concrete code seam (file:line) and the mitigation the spec must implement.' },
  { key: 'API', label: 'public-API probe', focus:
    'a changed PUBLISHED @facet/* surface (a barrel export, a brick/token/action shape in @facet/core, a protocol type, a CLI command). ' +
    'Grep existing consumers (other packages + apps/playground + examples/); classify additive vs breaking; give the migration per consumer.' },
  { key: 'PKG', label: 'cross-package coupling probe', focus:
    'a module move/split or a new cross-package import. Verify @facet/core stays node-free, barrel exports hold, and no import cycle is introduced.' },
]

// ─── Review gate-families: each reviewer owns a slice of the rubric (fan-out to kill self-review blind spots) ───
const GATE_FAMILIES = [
  { key: 'traceability', focus:
    'DC traceability + test coverage: every intake DC-00N id is preserved and maps to a WU test_plan; the union of all WU test_plan.covers_dc covers EVERY DC-*; test types/targets are real.' },
  { key: 'decomposition', focus:
    'Work Unit decomposition: no WU > 5 files; every file assigned to exactly one WU (no orphans); depends_on / parallel_group are sane; every prod-code WU has a valid red_check (a vitest cmd that FAILS before / PASSES after) or a justified N/A.' },
  { key: 'invariant-fit', focus:
    'Invariant Fit Audit is real, not hand-wave: each TOUCHES invariant has a concrete safe design (#6 ordering/version rule, #5 constrained brick shape, #3 fail-safe behavior); the Fail-safe & boundary checklist covers malformed/empty/deep/cyclic input, offline agent, rapid events.' },
  { key: 'risk-consistency', focus:
    'every RISK-* from the context pass is resolved in-spec or explicitly waived; spec/manifest consistency (WU ids/files/deps/checks/final_gate_chain IDENTICAL between the .md and the .execution.yaml); feature hard gate includes /worktree-prep, /update-tests, /verify, /code-review, /live-test, /update-docs; final_gate_owner = main-agent; file:line paths match the context evidence.' },
]

// ─── Schemas ───
const MAP_SCHEMA = {
  type: 'object', required: ['briefFound', 'ok', 'packages'],
  properties: {
    briefFound: { type: 'boolean' },
    ok: { type: 'boolean' }, // false if the brief references a package/pattern that does not exist (hard stop)
    packages: { type: 'array', items: { type: 'string' } },
    entrypoints: { type: 'array', items: { type: 'string' } }, // "pkg: file:line — pattern"
    triggers: { // which risk lenses the brief triggers (probes still run but can early-return)
      type: 'object',
      properties: { INV: { type: 'boolean' }, API: { type: 'boolean' }, PKG: { type: 'boolean' } },
    },
    note: { type: 'string' },
  },
}
const PROBE_SCHEMA = {
  type: 'object', required: ['triggered', 'riskItems'],
  properties: {
    triggered: { type: 'boolean' },
    riskItems: { type: 'array', items: {
      type: 'object', required: ['id', 'detail'],
      properties: { id: { type: 'string' }, detail: { type: 'string' } }, // detail must carry file:line + resolution
    }},
    note: { type: 'string' },
  },
}
const DONE_SCHEMA = {
  type: 'object', required: ['result'],
  properties: { result: { enum: ['DONE', 'FAIL'] }, workUnits: { type: 'number' }, note: { type: 'string' } },
}
const REVIEWER_SCHEMA = {
  type: 'object', required: ['findings', 'gateReport'],
  properties: {
    findings: { type: 'array', items: {
      type: 'object', required: ['severity', 'gate', 'evidence'],
      properties: {
        severity: { enum: ['P0', 'P1', 'P2', 'P3'] }, gate: { type: 'string' },
        evidence: { type: 'string' }, fix: { type: 'string' },
      },
    }},
    gateReport: { type: 'string' },
  },
}
const FIX_SCHEMA = {
  type: 'object', required: ['result'],
  properties: { result: { enum: ['DONE', 'FAIL'] }, resolved: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } },
}

// ════════════════ Stage 0 — Context (FANNED OUT) ════════════════
phase('Context')

// 0a. Package map + brief check (one agent — establishes what the probes investigate)
const map = await agent(
  '## Spec-bridge context map for `' + slug + '`\n\n' +
  '1. Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/REVIEW-RULES.md`.\n' +
  '2. Read the intake brief at `' + briefPath + '`. If it does NOT exist, return briefFound=false and stop.\n' +
  '3. From the brief `User Scenario`, `Invariant Fit`, `Public API / Package Surface`, infer the affected @facet/* packages. ' +
  'For each, record the entry files + the existing pattern the feature must follow + exact `file:line` anchors (as "pkg: file:line — pattern").\n' +
  '4. Decide which RISK lenses the brief TRIGGERS: INV (any invariant marked TOUCHES), API (a published @facet/* surface changes), PKG (a module moves/splits or an import crosses packages). Return them in `triggers`.\n' +
  'If the brief references a package/pattern that does NOT exist, set ok=false and explain in note (hard stop).\n' +
  'Return briefFound, ok, packages, entrypoints, triggers, note. Do NOT write any file yet.\n\nStructured output only.',
  { agentType: 'general-purpose', model: M, label: 'map', phase: 'Context', schema: MAP_SCHEMA }
)
if (!map) return { error: 'Context map agent returned no result — cannot proceed.', slug }
if (!map.briefFound) return { verdict: 'FAIL', slug, stop: 'BRIEF_NOT_FOUND', note: 'Intake brief not found at ' + briefPath + '. Run /feature-intake first.' }
if (!map.ok) return { verdict: 'FAIL', slug, stop: 'CONTEXT_INVALID', note: map.note || 'Context map found a referenced package/pattern that does not exist.' }
const triggers = map.triggers || {}
log('Context map: packages=[' + (map.packages || []).join(', ') + '] · triggers=' + RISK_LENSES.filter(l => triggers[l.key]).map(l => l.key).join('/') || '(none)')

// 0b. Risk-lens probes (PARALLEL — independent investigations, one per lens)
const probeResults = await parallel(RISK_LENSES.map(lens => () =>
  agent(
    '## RISK probe: ' + lens.label + ' (lens ' + lens.key + ') for `' + slug + '`\n\n' +
    'Inputs: brief `' + briefPath + '`, affected packages [' + (map.packages || []).join(', ') + '].\n' +
    'The context map ' + (triggers[lens.key] ? 'MARKED this lens as TRIGGERED' : 'did NOT mark this lens as triggered — double-check; return triggered=false with a one-line reason if it truly does not apply') + '.\n\n' +
    'Investigate ONLY this lens: ' + lens.focus + '\n\n' +
    'For every risk, emit a `RISK-' + lens.key + '-N` item whose `detail` carries the detected pattern, a concrete `file:line`, and the resolution the spec must implement. ' +
    'Grep to prove consumer/coupling claims. Empty riskItems if genuinely none.\n\nStructured output only.',
    { agentType: 'general-purpose', model: M, label: 'probe:' + lens.key, phase: 'Context', schema: PROBE_SCHEMA }
  ).then(r => ({ lens: lens.key, ...(r || { triggered: false, riskItems: [] }) }))
))
const risks = probeResults.flatMap(p => (p.riskItems || []).map(r => ({ lens: p.lens, ...r })))
log('Risk probes: ' + risks.length + ' item(s) across ' + probeResults.filter(p => p.triggered).length + ' triggered lens(es)')

// 0c. Context writer — assemble the map evidence + all risks into specs/context/<slug>.md (single writer, no conflict)
const riskBlock = risks.length
  ? risks.map(r => '- ' + r.id + ' (' + r.lens + '): ' + r.detail).join('\n')
  : '(no RISK items raised)'
const ctxWrite = await agent(
  '## Write the context file `' + contextPath + '` for `' + slug + '`\n\n' +
  'Assemble the evidence gathered by the context pass into a single markdown file. Sections:\n' +
  '- Affected packages: ' + (map.packages || []).join(', ') + '\n' +
  '- Code entrypoints (with file:line):\n' + (map.entrypoints || []).map(e => '  - ' + e).join('\n') + '\n' +
  '- Risk register:\n' + riskBlock + '\n\n' +
  'Write a clean, spec-writer-facing context doc to `' + contextPath + '` capturing exactly this evidence (do not invent new facts). ' +
  'Return result DONE (or FAIL with why).\n\nStructured output only.',
  { agentType: 'general-purpose', model: M, label: 'context-writer', phase: 'Context', schema: DONE_SCHEMA }
)
if (!ctxWrite || ctxWrite.result !== 'DONE') return { verdict: 'FAIL', slug, stop: 'CONTEXT_INVALID', note: (ctxWrite && ctxWrite.note) || 'Context writer failed to produce ' + contextPath }

// ════════════════ Stage 1 — Write (SINGLE author) ════════════════
phase('Write')
const write = await agent(
  '## Write the Facet development spec + execution manifest for `' + slug + '`\n\n' +
  'Inputs:\n- Intake brief: `' + briefPath + '`\n- Context evidence + risk register: `' + contextPath + '`\n' +
  '- Spec template: `.claude/skills/spec-bridge/templates/dev-spec.md`\n- Manifest template: `.claude/skills/spec-bridge/references/execution-manifest-template.yaml`\n\n' +
  'Write the spec to `' + specPath + '` and the manifest to `' + manifestPath + '` (ONE author writes both so WU ids/files/deps/checks stay IDENTICAL).\n\n' +
  'The writer MUST resolve each RISK-* from the context file in-spec (or record an explicit waiver).\n\n' +
  'The spec MUST:\n' +
  '- preserve intake `DC-00N` ids and map `DC → file/function/test`.\n' +
  '- decompose into Work Units (**max 5 files each**); every file in exactly one WU; no orphans.\n' +
  '- per WU: owner_role, packages, depends_on, parallel_group, red_check (a vitest cmd that FAILS before impl / PASSES after — or N/A with a deletion/docs/move justification), quick_checks, no_regression_checks, test_plan (type/target/covers_dc/action), handoff_format (incl. refactor_decision + green_diff_summary).\n' +
  '- union of all WU test_plan.covers_dc MUST cover every DC-*.\n' +
  '- include an **Invariant Fit Audit**, a Fail-safe & boundary checklist, and a risk register resolving every RISK-*.\n' +
  '- final gate chain: /worktree-prep → /update-tests → /verify → /code-review (P0-P2=0) → /live-test → /update-docs, final_gate_owner = main-agent.\n' +
  'The manifest MUST keep WU ids, files, depends_on, parallel_group, red_check, quick_checks, no_regression_checks, handoff_format, and final_gate_chain IDENTICAL to the spec, with final_gate_owner: main-agent.\n\n' +
  'Return result DONE (or FAIL with why) and the Work Unit count.\n\nStructured output only.',
  { agentType: 'general-purpose', model: M, label: 'writer', phase: 'Write', schema: DONE_SCHEMA }
)
if (!write || write.result !== 'DONE') return { verdict: 'FAIL', slug, stop: 'WRITER_FAILED', contextPath, note: (write && write.note) || 'Spec writer did not complete.' }
log('Write: spec + manifest written · ' + (write.workUnits || '?') + ' Work Units')

// ════════════════ Stage 2 — Review panel (FANNED OUT) + fix loop ════════════════
const failing = counts => counts.P0 > 0 || counts.P1 > 0

// One review round = an independent panel, one reviewer per gate-family, findings unioned.
const runPanel = async round => {
  const reviews = await parallel(GATE_FAMILIES.map(fam => () =>
    agent(
      '## Independently review the Facet dev spec for `' + slug + '` — gate-family: ' + fam.key +
      (round > 0 ? ' (re-review round ' + round + ' after fixes)' : '') + '\n\n' +
      'You did NOT write this spec; be adversarial. Inputs:\n' +
      '- Spec: `' + specPath + '`\n- Manifest: `' + manifestPath + '`\n- Brief: `' + briefPath + '`\n- Context: `' + contextPath + '`\n' +
      '- Gates rubric: `.claude/skills/spec-bridge/references/spec-qa-gates.md`\n\n' +
      'Evaluate ONLY your gate-family: ' + fam.focus + '\n\n' +
      'Assign P0-P3 per finding (a false-invariant, an untraceable DC, a WU>5 files, a missing red_check, a spec/manifest mismatch, a missing feature hard-gate step, or final_gate_owner≠main-agent is >= P1). ' +
      'Return findings (severity/gate/evidence/fix) and a one-paragraph gate report for this family.\n\nStructured output only.',
      { agentType: 'general-purpose', model: M, label: 'review:' + fam.key + (round > 0 ? ':r' + round : ''), phase: 'Review', schema: REVIEWER_SCHEMA }
    ).then(r => ({ family: fam.key, ...(r || { findings: [], gateReport: '(reviewer returned nothing)' }) }))
  ))
  const findings = reviews.flatMap(r => (r.findings || []).map(f => ({ family: r.family, ...f })))
  const counts = findings.reduce((acc, f) => { acc[f.severity] = (acc[f.severity] || 0) + 1; return acc }, { P0: 0, P1: 0, P2: 0, P3: 0 })
  const gateReport = reviews.map(r => '### ' + r.family + '\n' + r.gateReport).join('\n\n')
  return { verdict: failing(counts) ? 'FAIL' : 'PASS', counts, findings, gateReport }
}

phase('Review')
let review = await runPanel(0)
log('Review round 0: ' + review.verdict + ' (P0=' + review.counts.P0 + ' P1=' + review.counts.P1 + ' P2=' + review.counts.P2 + ' P3=' + review.counts.P3 + ') across ' + GATE_FAMILIES.length + ' reviewers')

let rounds = 0
while (failing(review.counts) && rounds < MAX_ROUNDS) {
  rounds++
  phase('Fix loop')
  const blocking = review.findings.filter(f => f.severity === 'P0' || f.severity === 'P1')
  const fixBlock = blocking.map(f => '- [' + f.severity + '] (' + f.gate + ') ' + f.evidence + (f.fix ? ' → fix: ' + f.fix : '')).join('\n')
  const fix = await agent(
    '## Fix the Facet dev spec for `' + slug + '` (round ' + rounds + ')\n\n' +
    'The independent review panel raised these blocking (P0/P1) findings. Edit `' + specPath + '` and `' + manifestPath + '` to resolve EACH, ' +
    'keeping spec/manifest consistent (WU ids/files/deps/checks identical). Do not weaken any gate to make a finding disappear — fix the underlying issue.\n\n' +
    '## Blocking findings\n' + fixBlock + '\n\nReturn result DONE (or FAIL with why) and the list of resolved findings.\n\nStructured output only.',
    { agentType: 'general-purpose', model: M, label: 'fixer:r' + rounds, phase: 'Fix loop', schema: FIX_SCHEMA }
  )
  if (!fix || fix.result !== 'DONE') { log('Fix round ' + rounds + ' did not complete — stopping the loop'); break }
  review = await runPanel(rounds)
  log('Review round ' + rounds + ': ' + review.verdict + ' (P0=' + review.counts.P0 + ' P1=' + review.counts.P1 + ' P2=' + review.counts.P2 + ' P3=' + review.counts.P3 + ')')
}

const stillFailing = failing(review.counts)
return {
  verdict: stillFailing ? 'FAIL' : 'PASS',
  slug,
  awaitingApproval: !stillFailing,
  escalate: stillFailing,
  contextPath, specPath, manifestPath,
  workUnits: write.workUnits,
  packages: map.packages,
  risks,
  fixRounds: rounds,
  counts: review.counts,
  findings: review.findings,
  gateReport: review.gateReport,
  stats: { riskLenses: RISK_LENSES.length, reviewers: GATE_FAMILIES.length, fixRounds: rounds },
}
