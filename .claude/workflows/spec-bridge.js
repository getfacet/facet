export const meta = {
  name: 'spec-bridge',
  description: 'Facet spec bridge — context pass + risk probes, then a spec writer and an independent adversarial reviewer in separate contexts, with a bounded fix→re-review loop. Stops at an approvable plan.',
  whenToUse: 'After a feature-intake brief is approved. Pass args.slug. Produces specs/context, specs/dev-specs (+ execution manifest), and a reviewer verdict. The calling agent asks the human for approval — this workflow never starts implementation.',
  phases: [
    { title: 'Context', detail: 'map affected packages, gather file:line evidence, run RISK probes', model: 'fable' },
    { title: 'Write', detail: 'spec writer (separate context) → dev-spec + execution manifest', model: 'fable' },
    { title: 'Review', detail: 'independent adversarial reviewer → gate report (never saw the writer)', model: 'fable' },
    { title: 'Fix loop', detail: 'if P0/P1: fixer edits the spec, re-run the reviewer (max 3 rounds)', model: 'fable' },
  ],
}

// spec-bridge: Context (+risk probes) → Write (spec + manifest) → Review (separate context)
//   → bounded fix→re-review loop. Reviewer never sees the writer's reasoning (fresh agent).
// The human-approval step (Stage 3) is intentionally OUTSIDE this workflow — the workflow
// can't ask the user — so it returns awaitingApproval:true and the /spec-bridge skill asks.
// Invoked via Workflow({name: 'spec-bridge', args: { slug: '<slug>' }}).

const MAX_ROUNDS = 3
const M = 'fable'

const slug = (args && typeof args === 'object' && typeof args.slug === 'string' && args.slug.trim())
  ? args.slug.trim()
  : (typeof args === 'string' && args.trim() ? args.trim() : '')
if (!slug) {
  return { error: "No slug provided. Pass it as args: Workflow({name: 'spec-bridge', args: { slug: '<slug>' }})." }
}

const briefPath = 'specs/feature-intake/' + slug + '.md'
const contextPath = 'specs/context/' + slug + '.md'
const specPath = 'specs/dev-specs/' + slug + '.md'
const manifestPath = 'specs/dev-specs/' + slug + '.execution.yaml'

// ─── Schemas ───
const CONTEXT_SCHEMA = {
  type: 'object', required: ['briefFound', 'ok', 'packages', 'risks'],
  properties: {
    briefFound: { type: 'boolean' },
    ok: { type: 'boolean' }, // false if a referenced package/pattern does not exist (hard stop)
    packages: { type: 'array', items: { type: 'string' } },
    risks: {
      type: 'array', items: {
        type: 'object', required: ['id', 'detail'],
        properties: {
          id: { type: 'string' }, // RISK-INV-*, RISK-API-*, RISK-PKG-*
          detail: { type: 'string' },
        },
      },
    },
    note: { type: 'string' },
  },
}
const WRITE_SCHEMA = {
  type: 'object', required: ['result'],
  properties: {
    result: { enum: ['DONE', 'FAIL'] },
    workUnits: { type: 'number' },
    note: { type: 'string' },
  },
}
const REVIEW_SCHEMA = {
  type: 'object', required: ['verdict', 'counts', 'findings', 'gateReport'],
  properties: {
    verdict: { enum: ['PASS', 'FAIL'] },
    counts: {
      type: 'object', required: ['P0', 'P1', 'P2', 'P3'],
      properties: { P0: { type: 'number' }, P1: { type: 'number' }, P2: { type: 'number' }, P3: { type: 'number' } },
    },
    findings: {
      type: 'array', items: {
        type: 'object', required: ['severity', 'gate', 'evidence'],
        properties: {
          severity: { enum: ['P0', 'P1', 'P2', 'P3'] },
          gate: { type: 'string' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    gateReport: { type: 'string' },
  },
}
const FIX_SCHEMA = {
  type: 'object', required: ['result'],
  properties: {
    result: { enum: ['DONE', 'FAIL'] },
    resolved: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
}

// ─── Stage 0: Context pass + RISK probes → specs/context/<slug>.md ───
phase('Context')
const ctx = await agent(
  '## Spec-bridge context pass for `' + slug + '`\n\n' +
  '1. Read `AGENTS.md` (Facet contract), `docs/ARCHITECTURE.md`, `docs/REVIEW-RULES.md`.\n' +
  '2. Read the intake brief at `' + briefPath + '`. If it does NOT exist, return briefFound=false and stop.\n' +
  '3. From the brief `User Scenario`, `Invariant Fit`, and `Public API / Package Surface`, infer the affected ' +
  '`@facet/*` packages. Map, per package: entry files, the existing patterns the feature must follow, and the ' +
  'exact `file:line` anchors the writer should reference.\n' +
  '4. Run the RISK PROBES the brief triggers, each with `file:line` + proposed resolution:\n' +
  '   - **RISK-INV-N** (invariant probe) — required if any invariant is marked TOUCHES (esp. #5 overlay, #6 two-writers, #1 backend).\n' +
  '   - **RISK-API-N** (public-API probe) — required if a published @facet/* surface changes; grep existing consumers (other packages + apps/playground + examples/), additive vs breaking + migration per consumer.\n' +
  '   - **RISK-PKG-N** (cross-package coupling) — required if a module moves/splits or an import crosses packages; verify @facet/core stays node-free, barrels hold, no import cycle.\n' +
  '5. Write the evidence map + risk register to `' + contextPath + '`.\n\n' +
  'If a probe finds the brief references a package/pattern that does NOT exist, set ok=false and explain in note (hard stop).\n' +
  'Return briefFound, ok, the affected packages, the RISK ids + details, and a short note.\n\nStructured output only.',
  { agentType: 'general-purpose', model: M, label: 'context', phase: 'Context', schema: CONTEXT_SCHEMA }
)

if (!ctx) return { error: 'Context agent returned no result — cannot proceed.', slug }
if (!ctx.briefFound) return { verdict: 'FAIL', slug, stop: 'BRIEF_NOT_FOUND', note: 'Intake brief not found at ' + briefPath + '. Run /feature-intake first.' }
if (!ctx.ok) return { verdict: 'FAIL', slug, stop: 'CONTEXT_INVALID', contextPath, note: ctx.note || 'Context pass found a referenced package/pattern that does not exist.' }
log('Context: packages=[' + (ctx.packages || []).join(', ') + '] · risks=' + (ctx.risks || []).length)

const riskBlock = (ctx.risks && ctx.risks.length)
  ? 'The writer MUST resolve each of these in-spec (or record an explicit waiver):\n' +
    ctx.risks.map(r => '- ' + r.id + ': ' + r.detail).join('\n') + '\n\n'
  : 'No RISK items were raised by the context pass.\n\n'

// ─── Stage 1 + 1.5: Spec writer (separate context) → dev-spec + execution manifest ───
// One agent writes BOTH so WU ids/files/deps/checks stay IDENTICAL between them (a hard gate).
phase('Write')
const write = await agent(
  '## Write the Facet development spec + execution manifest for `' + slug + '`\n\n' +
  'Inputs:\n' +
  '- Intake brief: `' + briefPath + '`\n' +
  '- Context evidence + risk register: `' + contextPath + '`\n' +
  '- Spec template: `.claude/skills/spec-bridge/templates/dev-spec.md`\n' +
  '- Manifest template: `.claude/skills/spec-bridge/references/execution-manifest-template.yaml`\n\n' +
  'Write the spec to `' + specPath + '` and the manifest to `' + manifestPath + '`.\n\n' +
  riskBlock +
  'The spec MUST:\n' +
  '- preserve intake `DC-00N` ids and map `DC → file/function/test`.\n' +
  '- decompose into Work Units (**max 5 files each**); every file in exactly one WU; no orphans.\n' +
  '- per WU: owner_role, packages, depends_on, parallel_group, red_check (a vitest command that FAILS before impl / PASSES after — or N/A with a deletion/docs/move justification), quick_checks, no_regression_checks, test_plan (type/target/covers_dc/action), handoff_format (incl. refactor_decision + green_diff_summary).\n' +
  '- union of all WU test_plan.covers_dc MUST cover every DC-*.\n' +
  '- include an **Invariant Fit Audit** (each TOUCHES invariant → concrete safe design; esp. #6 ordering/version rule, #5 constrained brick shape, #3 fail-safe behavior).\n' +
  '- include a Fail-safe & boundary checklist and a risk register resolving every RISK-*.\n' +
  '- final gate chain: /verify → /code-review (P0-P2=0), /refactor-audit periodic, final_gate_owner = main-agent.\n\n' +
  'The manifest MUST keep WU ids, files, depends_on, parallel_group, red_check, quick_checks, no_regression_checks, ' +
  'and handoff_format IDENTICAL to the Markdown spec, with final_gate_owner: main-agent.\n\n' +
  'Return result DONE (or FAIL with why) and the Work Unit count.\n\nStructured output only.',
  { agentType: 'general-purpose', model: M, label: 'writer', phase: 'Write', schema: WRITE_SCHEMA }
)

if (!write || write.result !== 'DONE') {
  return { verdict: 'FAIL', slug, stop: 'WRITER_FAILED', contextPath,
    note: (write && write.note) || 'Spec writer did not complete.' }
}
log('Write: spec + manifest written · ' + (write.workUnits || '?') + ' Work Units')

// ─── Stage 2 + fix loop: independent reviewer, then bounded fix→re-review ───
const REVIEW_PROMPT = round =>
  '## Independently review the Facet dev spec for `' + slug + '` — be adversarial' +
  (round > 0 ? ' (re-review round ' + round + ' after fixes)' : '') + '\n\n' +
  'You did NOT write this spec. Inputs:\n' +
  '- Spec: `' + specPath + '`\n- Manifest: `' + manifestPath + '`\n' +
  '- Brief: `' + briefPath + '`\n- Context: `' + contextPath + '`\n' +
  '- Gates: `.claude/skills/spec-bridge/references/spec-qa-gates.md`\n\n' +
  'Evaluate EVERY gate. Verify file:line paths against the context evidence. Verify spec/manifest consistency ' +
  '(WU ids/files/deps/checks IDENTICAL). Verify the Invariant Fit Audit is real, not hand-wave. Verify every ' +
  'RISK-* is resolved or explicitly waived, every DC-* is traceable to a WU test_plan, no WU > 5 files, every ' +
  'prod-code WU has a valid red_check, and final_gate_owner = main-agent.\n\n' +
  'Assign P0-P3 per finding (a false-invariant or missing-required-section is >= P1). verdict = FAIL if any P0 or P1, else PASS. ' +
  'Return the verdict, the P0-P3 counts, the findings (severity/gate/evidence/fix), and a gate report.\n\nStructured output only.'

phase('Review')
let review = await agent(REVIEW_PROMPT(0), { agentType: 'general-purpose', model: M, label: 'reviewer', phase: 'Review', schema: REVIEW_SCHEMA })
if (!review) return { verdict: 'FAIL', slug, stop: 'REVIEWER_FAILED', contextPath, specPath, manifestPath, note: 'Reviewer returned no result.' }
const failing = r => r.verdict === 'FAIL' || (r.counts && (r.counts.P0 > 0 || r.counts.P1 > 0))
log('Review round 0: ' + review.verdict + ' (P0=' + review.counts.P0 + ' P1=' + review.counts.P1 + ' P2=' + review.counts.P2 + ' P3=' + review.counts.P3 + ')')

let rounds = 0
while (failing(review) && rounds < MAX_ROUNDS) {
  rounds++
  phase('Fix loop')
  const blocking = review.findings.filter(f => f.severity === 'P0' || f.severity === 'P1')
  const fixBlock = blocking.map((f, i) => '- [' + f.severity + '] (' + f.gate + ') ' + f.evidence + (f.fix ? ' → fix: ' + f.fix : '')).join('\n')
  const fix = await agent(
    '## Fix the Facet dev spec for `' + slug + '` (round ' + rounds + ')\n\n' +
    'The independent reviewer raised these blocking (P0/P1) findings. Edit `' + specPath + '` and ' +
    '`' + manifestPath + '` to resolve EACH, keeping spec/manifest consistent (WU ids/files/deps/checks identical). ' +
    'Do not weaken any gate to make a finding disappear — fix the underlying issue.\n\n' +
    '## Blocking findings\n' + fixBlock + '\n\n' +
    'Return result DONE (or FAIL with why) and the list of resolved findings.\n\nStructured output only.',
    { agentType: 'general-purpose', model: M, label: 'fixer:r' + rounds, phase: 'Fix loop', schema: FIX_SCHEMA }
  )
  if (!fix || fix.result !== 'DONE') {
    log('Fix round ' + rounds + ' did not complete — stopping the loop')
    break
  }
  review = await agent(REVIEW_PROMPT(rounds), { agentType: 'general-purpose', model: M, label: 'reviewer:r' + rounds, phase: 'Review', schema: REVIEW_SCHEMA })
  if (!review) return { verdict: 'FAIL', slug, stop: 'REVIEWER_FAILED', contextPath, specPath, manifestPath, note: 'Re-review returned no result after fix round ' + rounds + '.' }
  log('Review round ' + rounds + ': ' + review.verdict + ' (P0=' + review.counts.P0 + ' P1=' + review.counts.P1 + ' P2=' + review.counts.P2 + ' P3=' + review.counts.P3 + ')')
}

const stillFailing = failing(review)
return {
  verdict: stillFailing ? 'FAIL' : 'PASS',
  slug,
  awaitingApproval: !stillFailing, // main agent asks the human on PASS; on FAIL it escalates
  escalate: stillFailing, // 3 fix rounds exhausted without PASS
  contextPath,
  specPath,
  manifestPath,
  workUnits: write.workUnits,
  packages: ctx.packages,
  risks: ctx.risks,
  fixRounds: rounds,
  counts: review.counts,
  findings: review.findings,
  gateReport: review.gateReport,
  stats: { agentCalls: 1 + 1 + 1 + rounds * 2 },
}
