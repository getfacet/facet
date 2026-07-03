export const meta = {
  name: 'refactor-audit',
  description: 'Facet structural audit — fan out one audit-structure reviewer per dimension over the whole tree, verify each finding, then rank a cleanup plan by impact/effort.',
  whenToUse: 'Owner-run consolidation pass (not per-change). Audits the whole repo for duplication, boundaries, dead code, hygiene, naming. Produces a ranked plan, not applied changes — the maintainer approves scope afterward.',
  phases: [
    { title: 'Audit', detail: 'one audit-structure agent per dimension over packages/**/src + apps/**/src' },
    { title: 'Verify', detail: 'review-verifier challenges each finding (truly dead/dup/misplaced?)' },
    { title: 'Plan', detail: 'rank by impact/effort, recommend order + what NOT to touch' },
  ],
}

// refactor-audit: parallel Audit per dimension → per-finding Verify → ranked Plan.
// Whole-repo structural review (shape, not correctness). Reuses the audit-structure and
// review-verifier subagent types. Invoked by the /refactor-audit skill via
// Workflow({name: 'refactor-audit'}). Returns a plan; the maintainer approves + executes.

const DIMENSIONS = [
  { key: 'duplication', focus: 'the same logic/spec/string in >=2 places (e.g. the LLM stage spec). Cite EVERY location.' },
  { key: 'boundaries', focus: 'wrong dependency direction, protocol types outside @facet/core, reusable code stuck in apps/playground that consumers need, Node built-ins in a browser entry. Cite the import.' },
  { key: 'dead-code', focus: 'unused exports/files/branches, orphans after a refactor. PROVE it with a grep showing no references.' },
  { key: 'hygiene', focus: 'package.json uniformity (build/files/exports/publishConfig/sideEffects), missing tests on pure logic (kit builders, cli op-building), doc drift vs the actual published package set.' },
  { key: 'naming', focus: 'misleading or inconsistent names across the tree.' },
]

// ─── Schemas ───
const AUDIT_SCHEMA = {
  type: 'object', required: ['findings'],
  properties: {
    findings: {
      type: 'array', items: {
        type: 'object', required: ['title', 'files', 'severity', 'evidence', 'fix', 'effort'],
        properties: {
          title: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          severity: { enum: ['P0', 'P1', 'P2', 'P3'] },
          evidence: { type: 'string' },
          fix: { type: 'string' },
          effort: { enum: ['S', 'M', 'L'] },
        },
      },
    },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', required: ['isReal', 'severity', 'reason'],
  properties: {
    isReal: { type: 'boolean' },
    severity: { enum: ['P0', 'P1', 'P2', 'P3'] },
    reason: { type: 'string' },
  },
}
const PLAN_SCHEMA = {
  type: 'object', required: ['executionOrder', 'doNotTouch', 'summary'],
  properties: {
    summary: { type: 'string' },
    executionOrder: {
      type: 'array', items: {
        type: 'object', required: ['title', 'why'],
        properties: {
          title: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
    doNotTouch: {
      type: 'array', items: {
        type: 'object', required: ['item', 'why'],
        properties: {
          item: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
  },
}

const AUDIT_PROMPT = dim =>
  '## Structural audit dimension: ' + dim.key + '\n\n' +
  'Read `docs/REVIEW-RULES.md` first (the audit dimensions + invariants).\n' +
  'Audit the WHOLE tree: `packages/**/src`, `apps/**/src`, and package manifests.\n\n' +
  'Cover ONLY the **' + dim.key + '** dimension: ' + dim.focus + '\n\n' +
  'For each finding give a suggested fix and a rough effort (S/M/L). Prove every claim with concrete ' +
  'evidence (the >=2 locations for duplication; a grep showing no references for dead code; the wrong ' +
  'import for boundaries). Bias toward consolidations that reduce drift or clarify a boundary — flag ' +
  'cosmetic churn as low value. Empty list if the dimension is clean; do not invent findings.\n\nStructured output only.'

const VERIFY_PROMPT = (f, dim) =>
  '## Adversarially verify one ' + dim.key + ' audit finding — try to REFUTE it\n\n' +
  'Finding: **' + f.title + '**\n' +
  'Files: ' + f.files.join(', ') + ' (claimed ' + f.severity + ', effort ' + f.effort + ')\n' +
  'Evidence: ' + f.evidence + '\nProposed fix: ' + f.fix + '\n\n' +
  'Confirm from the code, do not agree by default. For dead-code: grep to confirm it is truly unreferenced. ' +
  'For duplication: confirm the locations are truly the same logic, not superficially similar. ' +
  'For boundaries: confirm the import direction is actually wrong. Is the severity right or inflated? ' +
  'Default to isReal=false when the evidence is weak. Return isReal, the correct severity, and a reason ' +
  'citing what you checked (a grep result, the two blocks, the import).\n\nStructured output only.'

// ─── Audit + Verify (pipeline: each dimension verifies as soon as it returns) ───
phase('Audit')
const audited = await pipeline(
  DIMENSIONS,
  dim => agent(AUDIT_PROMPT(dim), { agentType: 'audit-structure', label: 'audit:' + dim.key, phase: 'Audit', schema: AUDIT_SCHEMA })
    .then(r => {
      const findings = r && Array.isArray(r.findings) ? r.findings : []
      log('audit:' + dim.key + ' → ' + findings.length + ' candidate' + (findings.length === 1 ? '' : 's'))
      return { dim, findings }
    }),
  ({ dim, findings }) => parallel(
    findings.map(f => () =>
      agent(VERIFY_PROMPT(f, dim), { agentType: 'review-verifier', label: 'verify:' + dim.key, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then(v => {
          if (!v || !v.isReal) return null
          return { ...f, dimension: dim.key, severity: v.severity || f.severity, verifierReason: v.reason }
        })
    )
  )
)

const confirmed = audited.flat().filter(Boolean)
log('Verify done: ' + confirmed.length + ' finding(s) survived across ' + DIMENSIONS.length + ' dimensions')

// ─── Rank by impact / effort (deterministic) ───
// impact = inverse severity rank (P0 highest); effort weight S<M<L. score = impact / effortWeight.
const sevImpact = { P0: 4, P1: 3, P2: 2, P3: 1 }
const effortWeight = { S: 1, M: 2, L: 3 }
const sevRank = { P0: 0, P1: 1, P2: 2, P3: 3 }
const ranked = confirmed
  .map(f => ({ ...f, score: sevImpact[f.severity] / effortWeight[f.effort] }))
  .sort((a, b) => (b.score - a.score) || (sevRank[a.severity] - sevRank[b.severity]))
const counts = confirmed.reduce((acc, f) => { acc[f.severity]++; return acc }, { P0: 0, P1: 0, P2: 0, P3: 0 })

if (ranked.length === 0) {
  return {
    summary: 'No structural findings survived verification — the tree is clean on all ' + DIMENSIONS.length + ' dimensions.',
    findings: [], counts, executionOrder: [], doNotTouch: [],
    stats: { dimensions: DIMENSIONS.length, candidates: audited.flat().length, confirmed: 0 },
  }
}

// ─── Plan: recommended order + explicit do-not-touch ───
phase('Plan')
const block = ranked.map((f, i) =>
  '### [' + i + '] ' + f.severity + ' · ' + f.title + ' (effort ' + f.effort + ', score ' + f.score.toFixed(2) + ')\n' +
  'Dimension: ' + f.dimension + ' · Files: ' + f.files.join(', ') + '\n' +
  'Evidence: ' + f.evidence + '\nFix: ' + f.fix + '\nVerifier: ' + f.verifierReason + '\n'
).join('\n')

const plan = await agent(
  '## Plan the Facet cleanup\n\n' +
  ranked.length + ' structural findings survived verification, pre-ranked by impact/effort. ' +
  'Produce a recommended execution order (a few high-value consolidations first — real duplication, a ' +
  'misplaced module, a dead file — over cosmetic churn) and an explicit list of what NOT to touch and why ' +
  '(avoid churn for its own sake). Every proposed move must reduce drift or clarify a boundary.\n\n' +
  '## Ranked findings\n' + block + '\n\n' +
  'Return the execution order (titles + why), the do-not-touch list, and a 2-4 sentence summary.\n\nStructured output only.',
  { label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA }
)

return {
  summary: (plan && plan.summary) || (ranked.length + ' structural finding(s) to consider.'),
  counts,
  findings: ranked.map(f => ({
    severity: f.severity,
    title: f.title,
    files: f.files,
    dimension: f.dimension,
    effort: f.effort,
    score: Number(f.score.toFixed(2)),
    evidence: f.evidence,
    fix: f.fix,
    verifierReason: f.verifierReason,
  })),
  executionOrder: (plan && plan.executionOrder) || [],
  doNotTouch: (plan && plan.doNotTouch) || [],
  stats: {
    dimensions: DIMENSIONS.length,
    candidates: audited.flat().length,
    confirmed: confirmed.length,
    agentCalls: DIMENSIONS.length + audited.flat().length + 1,
  },
}
