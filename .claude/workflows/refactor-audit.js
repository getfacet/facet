export const meta = {
  name: 'refactor-audit',
  description: 'Facet structural audit — fan out one audit-structure reviewer per dimension, adversarially verify each finding with a vote panel, run a completeness critic that re-audits under-covered slices, dedup across dimensions, then rank a cleanup plan.',
  whenToUse: 'Owner-run consolidation pass (not per-change). Audits the whole repo for duplication, boundaries, dead code, hygiene, naming. Produces a ranked plan, not applied changes — the maintainer approves scope afterward.',
  phases: [
    { title: 'Audit', detail: 'one audit-structure agent per dimension over packages/**/src + apps/**/src' },
    { title: 'Verify', detail: 'review-verifier panel per finding — 3 votes for P0/P1, 1 for P2/P3 (majority-real survives)' },
    { title: 'Sweep', detail: 'completeness critic names under-audited (dimension, area) slices → targeted re-audit' },
    { title: 'Plan', detail: 'dedup across dimensions, rank by impact/effort, recommend order + what NOT to touch' },
  ],
}

// refactor-audit: parallel Audit per dimension → tiered adversarial Verify panel per finding →
// completeness-critic Sweep (re-audit under-covered slices, since one agent per dimension over the WHOLE
// repo is shallow) → cross-dimension dedup → ranked Plan. Fans out discovery + verification; keeps the
// Plan single. Reuses audit-structure + review-verifier. Invoked via
// Workflow({name:'refactor-audit', args?:{votes?,thorough?,skipCritic?}}).

const DIMENSIONS = [
  { key: 'duplication', focus: 'the same logic/spec/string in >=2 places (e.g. the LLM stage spec). Cite EVERY location.' },
  { key: 'boundaries', focus: 'wrong dependency direction, protocol types outside @facet/core, reusable code stuck in apps/playground that consumers need, Node built-ins in a browser entry. Cite the import.' },
  { key: 'dead-code', focus: 'unused exports/files/branches, orphans after a refactor. PROVE it with a grep showing no references.' },
  { key: 'hygiene', focus: 'package.json uniformity (build/files/exports/publishConfig/sideEffects), missing tests on pure logic (kit builders, cli op-building), doc drift vs the actual published package set.' },
  { key: 'naming', focus: 'misleading or inconsistent names across the tree.' },
]
const DIM_KEYS = DIMENSIONS.map(d => d.key)
const dimFocus = Object.fromEntries(DIMENSIONS.map(d => [d.key, d.focus]))
const HIGH_SEV = new Set(['P0', 'P1'])
const sevRank = { P0: 0, P1: 1, P2: 2, P3: 3 }

const cfg = (args && typeof args === 'object') ? args : {}
const VOTES_HIGH = Number.isInteger(cfg.votes) && cfg.votes > 0 ? cfg.votes : 3
const votesFor = sev => (cfg.thorough || HIGH_SEV.has(sev)) ? VOTES_HIGH : 1

// ─── Schemas ───
const AUDIT_SCHEMA = {
  type: 'object', required: ['findings'],
  properties: {
    findings: {
      type: 'array', items: {
        type: 'object', required: ['title', 'files', 'severity', 'evidence', 'fix', 'effort'],
        properties: {
          title: { type: 'string' }, files: { type: 'array', items: { type: 'string' } },
          severity: { enum: ['P0', 'P1', 'P2', 'P3'] }, evidence: { type: 'string' },
          fix: { type: 'string' }, effort: { enum: ['S', 'M', 'L'] },
        },
      },
    },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', required: ['isReal', 'severity', 'reason'],
  properties: {
    isReal: { type: 'boolean' }, severity: { enum: ['P0', 'P1', 'P2', 'P3'] }, reason: { type: 'string' },
  },
}
const CRITIC_SCHEMA = {
  type: 'object', required: ['gaps'],
  properties: {
    gaps: {
      type: 'array', maxItems: 6, items: {
        type: 'object', required: ['dimension', 'area', 'why'],
        properties: { dimension: { enum: DIM_KEYS }, area: { type: 'string' }, why: { type: 'string' } },
      },
    },
  },
}
const PLAN_SCHEMA = {
  type: 'object', required: ['executionOrder', 'doNotTouch', 'summary'],
  properties: {
    summary: { type: 'string' },
    executionOrder: { type: 'array', items: {
      type: 'object', required: ['title', 'why'], properties: { title: { type: 'string' }, why: { type: 'string' } },
    }},
    doNotTouch: { type: 'array', items: {
      type: 'object', required: ['item', 'why'], properties: { item: { type: 'string' }, why: { type: 'string' } },
    }},
  },
}

const decideSeverity = (realVotes, fallback) => {
  const counts = {}
  for (const v of realVotes) counts[v.severity] = (counts[v.severity] || 0) + 1
  let best = null
  for (const s of Object.keys(counts)) {
    if (best === null || counts[s] > counts[best] || (counts[s] === counts[best] && sevRank[s] < sevRank[best])) best = s
  }
  return best || fallback
}

// Merge findings that are the same issue reached from different lenses: same file-set + same title.
// Keep the more severe; union the dimensions so the plan shows it was seen from multiple angles.
const dedupeFindings = list => {
  const key = f => [...f.files].sort().join('|') + '::' + f.title.trim().toLowerCase()
  const map = new Map()
  for (const f of list) {
    const k = key(f)
    const prev = map.get(k)
    if (!prev) { map.set(k, { ...f }); continue }
    const keep = sevRank[f.severity] <= sevRank[prev.severity] ? { ...f } : { ...prev }
    const dims = new Set([...String(prev.dimension).split('+'), ...String(f.dimension).split('+')])
    keep.dimension = [...dims].join('+')
    map.set(k, keep)
  }
  return [...map.values()]
}

const AUDIT_PROMPT = dim =>
  '## Structural audit dimension: ' + dim.key + '\n\n' +
  'Read `docs/REVIEW-RULES.md` first (the audit dimensions + invariants).\n' +
  'Audit the WHOLE tree: `packages/**/src`, `apps/**/src`, and package manifests.\n\n' +
  'Cover ONLY the **' + dim.key + '** dimension: ' + dim.focus + '\n\n' +
  'For each finding give a suggested fix and a rough effort (S/M/L). Prove every claim with concrete evidence ' +
  '(the >=2 locations for duplication; a grep showing no references for dead code; the wrong import for boundaries). ' +
  'Bias toward consolidations that reduce drift or clarify a boundary — flag cosmetic churn as low value. ' +
  'Empty list if the dimension is clean; do not invent findings.\n\nStructured output only.'

const TARGETED_PROMPT = gap =>
  '## Targeted structural audit: ' + gap.dimension + ' within `' + gap.area + '`\n\n' +
  'A single whole-repo pass likely under-covered this slice. Why it was flagged: ' + (gap.why || '') + '\n\n' +
  'Read `docs/REVIEW-RULES.md`. Audit ONLY the **' + gap.dimension + '** dimension, focused on `' + gap.area + '` ' +
  '(report cross-area links if you find them). Go deeper than a whole-repo pass would.\n' +
  (dimFocus[gap.dimension] ? 'Dimension focus: ' + dimFocus[gap.dimension] + '\n' : '') +
  'Prove every claim with concrete evidence; give a fix + effort (S/M/L) each. Empty list if clean.\n\nStructured output only.'

const VERIFY_PROMPT = (f, dim, voterIdx, total) =>
  '## Adversarially verify one ' + dim.key + ' audit finding — try to REFUTE it' +
  (total > 1 ? ' (independent skeptic ' + (voterIdx + 1) + '/' + total + ' — reason on your own)' : '') + '\n\n' +
  'Finding: **' + f.title + '**\nFiles: ' + f.files.join(', ') + ' (claimed ' + f.severity + ', effort ' + f.effort + ')\n' +
  'Evidence: ' + f.evidence + '\nProposed fix: ' + f.fix + '\n\n' +
  'Confirm from the code, do not agree by default. For dead-code: grep to confirm it is truly unreferenced. ' +
  'For duplication: confirm the locations are truly the same logic, not superficially similar. ' +
  'For boundaries: confirm the import direction is actually wrong. Is the severity right or inflated? ' +
  'Default to isReal=false when the evidence is weak. Return isReal, the correct severity, and a reason ' +
  'citing what you checked (a grep result, the two blocks, the import).\n\nStructured output only.'

const verifyFinding = (f, dim) => {
  const n = votesFor(f.severity)
  return parallel(Array.from({ length: n }, (_, i) => () =>
    agent(VERIFY_PROMPT(f, dim, i, n), {
      agentType: 'review-verifier', label: (n > 1 ? 'v' + i + ':' : 'verify:') + dim.key, phase: 'Verify', schema: VERDICT_SCHEMA,
    })
  )).then(votes => {
    const valid = votes.filter(Boolean)
    if (valid.length === 0) return null
    const real = valid.filter(v => v.isReal)
    if (!(real.length > valid.length / 2)) return null
    return { ...f, dimension: dim.key, severity: decideSeverity(real, f.severity),
      verifierReason: real.map(v => v.reason).join(' | '), votes: real.length + '/' + valid.length }
  })
}

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
  ({ dim, findings }) => parallel(findings.map(f => () => verifyFinding(f, dim)))
)
const round1 = audited.flat().filter(Boolean)
log('Verify done: ' + round1.length + ' finding(s) survived across ' + DIMENSIONS.length + ' dimensions')

// ─── Sweep: completeness critic → targeted re-audit of under-covered slices ───
let targeted = []
if (!cfg.skipCritic) {
  phase('Sweep')
  const critic = await agent(
    '## Completeness critic for the Facet structural audit\n\n' +
    'The audit ran ONE agent per dimension (' + DIM_KEYS.join(', ') + ') over the WHOLE repo — shallow for a multi-package tree.\n\n' +
    'Confirmed findings so far:\n' +
    (round1.length ? round1.map(f => '- [' + f.severity + '] ' + f.dimension + ': ' + f.title + ' (' + f.files.join(', ') + ')').join('\n') : '(none)') + '\n\n' +
    'Identify up to 6 (dimension, area) slices that were LIKELY UNDER-AUDITED — a specific package/subtree × dimension where a single ' +
    'whole-repo pass probably missed things (e.g. duplication between two specific packages, dead exports in a large package, boundary ' +
    'leaks in apps/playground, hygiene drift in a specific package.json). Use ls/grep to ground your picks in the ACTUAL tree. ' +
    'Prefer high-value gaps; return an empty list if coverage genuinely looks complete.\n\nStructured output only.',
    { agentType: 'general-purpose', label: 'critic', phase: 'Sweep', schema: CRITIC_SCHEMA }
  )
  const gaps = (critic && Array.isArray(critic.gaps)) ? critic.gaps : []
  if (gaps.length) {
    log('Completeness critic: ' + gaps.length + ' under-audited slice(s) → targeted re-audit')
    targeted = (await pipeline(
      gaps,
      gap => agent(TARGETED_PROMPT(gap), { agentType: 'audit-structure', label: 'sweep:' + gap.dimension, phase: 'Sweep', schema: AUDIT_SCHEMA })
        .then(r => ({ gap, findings: r && Array.isArray(r.findings) ? r.findings : [] })),
      ({ gap, findings }) => parallel(findings.map(f => () => verifyFinding(f, { key: gap.dimension })))
    )).flat().filter(Boolean)
    log('Targeted sweep: ' + targeted.length + ' additional finding(s) survived')
  } else {
    log('Completeness critic: coverage looks complete — no targeted sweep')
  }
}

// ─── Dedup across dimensions + rank by impact / effort ───
const confirmed = dedupeFindings([...round1, ...targeted])
const dupMerged = round1.length + targeted.length - confirmed.length
if (dupMerged > 0) log('Dedup: merged ' + dupMerged + ' cross-dimension duplicate(s)')

const sevImpact = { P0: 4, P1: 3, P2: 2, P3: 1 }
const effortWeight = { S: 1, M: 2, L: 3 }
const ranked = confirmed
  .map(f => ({ ...f, score: sevImpact[f.severity] / effortWeight[f.effort] }))
  .sort((a, b) => (b.score - a.score) || (sevRank[a.severity] - sevRank[b.severity]))
const counts = confirmed.reduce((acc, f) => { acc[f.severity]++; return acc }, { P0: 0, P1: 0, P2: 0, P3: 0 })

if (ranked.length === 0) {
  return { summary: 'No structural findings survived verification — the tree is clean on all ' + DIMENSIONS.length + ' dimensions.',
    findings: [], counts, executionOrder: [], doNotTouch: [],
    stats: { dimensions: DIMENSIONS.length, round1: round1.length, targeted: targeted.length, confirmed: 0 } }
}

// ─── Plan ───
phase('Plan')
const block = ranked.map((f, i) =>
  '### [' + i + '] ' + f.severity + ' · ' + f.title + ' (effort ' + f.effort + ', score ' + f.score.toFixed(2) + ', votes ' + f.votes + ')\n' +
  'Dimension: ' + f.dimension + ' · Files: ' + f.files.join(', ') + '\n' +
  'Evidence: ' + f.evidence + '\nFix: ' + f.fix + '\nVerifier: ' + f.verifierReason + '\n'
).join('\n')

const plan = await agent(
  '## Plan the Facet cleanup\n\n' +
  ranked.length + ' structural findings survived verification, pre-ranked by impact/effort. ' +
  'Produce a recommended execution order (a few high-value consolidations first — real duplication, a misplaced module, ' +
  'a dead file — over cosmetic churn) and an explicit list of what NOT to touch and why (avoid churn for its own sake). ' +
  'Every proposed move must reduce drift or clarify a boundary.\n\n' +
  '## Ranked findings\n' + block + '\n\nReturn the execution order (titles + why), the do-not-touch list, and a 2-4 sentence summary.\n\nStructured output only.',
  { label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA }
)

return {
  summary: (plan && plan.summary) || (ranked.length + ' structural finding(s) to consider.'),
  counts,
  findings: ranked.map(f => ({
    severity: f.severity, title: f.title, files: f.files, dimension: f.dimension, effort: f.effort,
    score: Number(f.score.toFixed(2)), votes: f.votes, evidence: f.evidence, fix: f.fix, verifierReason: f.verifierReason,
  })),
  executionOrder: (plan && plan.executionOrder) || [],
  doNotTouch: (plan && plan.doNotTouch) || [],
  stats: {
    dimensions: DIMENSIONS.length, round1: round1.length, targeted: targeted.length,
    mergedDuplicates: dupMerged, confirmed: confirmed.length, votesHigh: VOTES_HIGH,
  },
}
