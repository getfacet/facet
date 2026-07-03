export const meta = {
  name: 'code-review',
  description: 'Facet code review — scope the diff, fan out one reviewer per dimension, then adversarially verify every finding with a severity-tiered vote panel, and compute the P0-P2 verdict.',
  whenToUse: 'Before shipping a change. Reviews the branch diff (main...HEAD) by default; pass args.scope="repo" to review the whole tree. Human-facing rendering + PASS/FAIL presentation stay with the calling agent.',
  phases: [
    { title: 'Scope', detail: 'git diff → changed files + which dimensions to run' },
    { title: 'Find', detail: 'one review-* agent per dimension, scoped to the diff' },
    { title: 'Verify', detail: 'review-verifier panel per finding — 3 votes for P0/P1, 1 for P2/P3 (majority-real survives)' },
    { title: 'Synthesize', detail: 'dedup, rank, propose a fix per confirmed finding' },
  ],
}

// code-review: Scope → pipeline(Find per dimension → adversarial Verify panel per finding) → Synthesize.
// Find is fanned out by dimension (7 lenses); Verify is fanned out by VOTE (independent skeptics per
// finding, tiered by severity so P0/P1 get a 3-vote majority and P2/P3 get a single check). Reuses
// Facet's review-* subagent types. Invoked by /code-review via Workflow({name:'code-review', args:{...}}).

const DIMENSIONS = [
  { key: 'bugs', agentType: 'review-bugs', focus: 'logic & correctness bugs (wrong results, off-by-one, null/undefined, mishandled Promises, wrong RFC 6902 patch/pointer handling, validateTree gaps)' },
  { key: 'types', agentType: 'review-types', focus: 'type safety & public API contracts (any, unsafe as, missing narrowing, exactOptionalPropertyTypes / noUncheckedIndexedAccess holes)' },
  { key: 'edge', agentType: 'review-edge', focus: 'edge cases, error handling, the fail-safe boundaries (validateTree, StageRenderer), empty/malformed/deep/cyclic input, lifecycle/cleanup' },
  { key: 'security', agentType: 'review-security', focus: 'the "safe by construction" claims, untrusted input (LLM output, client visitorId, --dangerously-skip-permissions), injection, CORS' },
  { key: 'concurrency', agentType: 'review-concurrency', focus: 'races (same-visitor events, runtime stage), the bridge queue + persistent generator handshake, ordering, deadlock, timeouts, resource leaks' },
  { key: 'consistency', agentType: 'review-consistency', focus: 'duplication, cross-package drift, dev-vs-published resolution (publishConfig/exports), barrel usage, naming' },
  { key: 'test-gaps', agentType: 'review-test-gaps', focus: 'changed behavior without a test; critical pure logic (validateTree, applyPatch, Stage, stores, createSerialQueue) losing coverage; untested testable surface; tautological tests' },
]
const DIM_KEYS = DIMENSIONS.map(d => d.key)
const BLOCKING = new Set(['P0', 'P1', 'P2']) // verdict: PASS = none of these
const HIGH_SEV = new Set(['P0', 'P1']) // get the multi-vote panel
const sevRank = { P0: 0, P1: 1, P2: 2, P3: 3 }

// ─── args: { scope?, base?, dimensions?, hint?, votes?, thorough? } ───
const cfg = (args && typeof args === 'object') ? args : {}
const wantScope = cfg.scope === 'repo' ? 'repo' : (cfg.scope === 'diff' ? 'diff' : null)
const baseRef = typeof cfg.base === 'string' && cfg.base.trim() ? cfg.base.trim() : 'main'
const forcedDims = Array.isArray(cfg.dimensions) ? cfg.dimensions.filter(d => DIM_KEYS.includes(d)) : null
const hint = typeof cfg.hint === 'string' ? cfg.hint : (typeof args === 'string' ? args : '')
const VOTES_HIGH = Number.isInteger(cfg.votes) && cfg.votes > 0 ? cfg.votes : 3 // votes for P0/P1 (or all, if thorough)
const votesFor = sev => (cfg.thorough || HIGH_SEV.has(sev)) ? VOTES_HIGH : 1

// ─── Schemas ───
const SCOPE_SCHEMA = {
  type: 'object', required: ['mode', 'changedFiles', 'dimensions'],
  properties: {
    mode: { enum: ['diff', 'repo'] },
    base: { type: 'string' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    dimensions: { type: 'array', items: { enum: DIM_KEYS } },
    rationale: { type: 'string' },
  },
}
const FINDINGS_SCHEMA = {
  type: 'object', required: ['findings'],
  properties: {
    findings: {
      type: 'array', items: {
        type: 'object', required: ['title', 'file', 'line', 'severity', 'evidence', 'why'],
        properties: {
          title: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' },
          severity: { enum: ['P0', 'P1', 'P2', 'P3'] }, evidence: { type: 'string' }, why: { type: 'string' },
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
const SYNTH_SCHEMA = {
  type: 'object', required: ['findings', 'summary'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array', items: {
        type: 'object', required: ['title', 'file', 'line', 'severity', 'fix'],
        properties: {
          title: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' },
          severity: { enum: ['P0', 'P1', 'P2', 'P3'] }, fix: { type: 'string' },
        },
      },
    },
  },
}

// Pick the severity a panel agrees on: mode among the real votes, ties broken toward MORE severe.
const decideSeverity = (realVotes, fallback) => {
  const counts = {}
  for (const v of realVotes) counts[v.severity] = (counts[v.severity] || 0) + 1
  let best = null
  for (const s of Object.keys(counts)) {
    if (best === null || counts[s] > counts[best] || (counts[s] === counts[best] && sevRank[s] < sevRank[best])) best = s
  }
  return best || fallback
}

// ─── Phase Scope ───
phase('Scope')
const scope = await agent(
  '## Code-review scoping\n\n' +
  'Determine the review scope for this Facet repo and pick which dimensions to run.\n\n' +
  (wantScope === 'repo'
    ? 'Scope is FORCED to the whole repo. Return mode="repo", changedFiles=[], dimensions=all.\n\n'
    : 'Run these to find the branch diff against `' + baseRef + '`:\n' +
      '```\ngit diff --name-only ' + baseRef + '...HEAD\ngit diff --stat ' + baseRef + '...HEAD\n```\n' +
      'If the diff is empty, fall back to uncommitted changes: `git status --short` + `git diff --name-only HEAD`.\n\n') +
  (hint ? 'Reviewer hint (may narrow/redirect scope): ' + hint + '\n\n' : '') +
  '## Pick dimensions\nAvailable: ' + DIM_KEYS.join(', ') + '.\n' +
  'Scale the fan-out to the change (a one-file fix needs a couple of dimensions; a cross-package change needs all). ' +
  'Include a dimension only if the diff plausibly contains that class of risk. When in doubt for a non-trivial change, include it.\n' +
  'Return mode, base, the changed files, the chosen dimension keys, and a one-line rationale.\n\nStructured output only.',
  { label: 'scope', phase: 'Scope', schema: SCOPE_SCHEMA }
)

const mode = wantScope || (scope && scope.mode) || 'diff'
const changedFiles = (scope && scope.changedFiles) || []
const chosen = forcedDims && forcedDims.length ? forcedDims
  : (scope && scope.dimensions && scope.dimensions.length ? scope.dimensions : DIM_KEYS)
const runDims = DIMENSIONS.filter(d => chosen.includes(d.key))

if (mode === 'diff' && changedFiles.length === 0 && !(scope && scope.dimensions)) {
  return { verdict: 'PASS', scope: { mode, base: baseRef }, findings: [], counts: { P0: 0, P1: 0, P2: 0, P3: 0 },
    note: 'No changes detected against ' + baseRef + ' (and no uncommitted changes). Nothing to review.' }
}
log('Scope: ' + mode + (mode === 'diff' ? ' (' + changedFiles.length + ' files vs ' + baseRef + ')' : '') + ' · dimensions: ' + runDims.map(d => d.key).join(', '))

const scopeBlock = mode === 'repo'
  ? 'Review ALL of `packages/**/src` and `apps/**/src`.'
  : 'Review the branch diff against `' + baseRef + '` and everything it touches. Get the diff with:\n' +
    '```\ngit diff ' + baseRef + '...HEAD\n```\n' +
    (changedFiles.length ? 'Changed files:\n' + changedFiles.map(f => '- ' + f).join('\n') + '\n' : '')

const FIND_PROMPT = dim =>
  '## Review dimension: ' + dim.key + '\n\n' +
  'Read `docs/REVIEW-RULES.md` first (invariants, severity, evidence rules).\n\n' + scopeBlock + '\n\n' +
  'Hunt for: ' + dim.focus + '.\n' +
  'Trace the actual runtime path. Every finding needs `file:line` + a code quote + the concrete failing case. ' +
  'No evidence → not a finding. Report an empty list if the code is clean; do not invent findings.\n\nStructured output only.'

const VERIFY_PROMPT = (f, dim, voterIdx, total) =>
  '## Adversarially verify one ' + dim.key + ' finding — try to REFUTE it' +
  (total > 1 ? ' (independent skeptic ' + (voterIdx + 1) + '/' + total + ' — reason on your own, do not assume other voters agree)' : '') + '\n\n' +
  'Finding: **' + f.title + '**\nLocation: `' + f.file + ':' + f.line + '` (claimed ' + f.severity + ')\n' +
  'Evidence: ' + f.evidence + '\nWhy claimed wrong: ' + f.why + '\n\n' +
  'Read the cited code and its callers. Challenge: does the triggering condition actually occur? ' +
  'Is it already handled by a guard / fail-safe boundary / validation / test? Is the severity right or inflated? ' +
  'Default to isReal=false when the evidence is weak or the condition cannot happen — no false alarms. ' +
  'Return isReal, the correct severity (P0-P3), and a reason citing what you checked (a caller, a guard, a grep).\n\nStructured output only.'

// One finding → a tiered panel of independent verifiers. Survives on a strict majority of real votes.
const verifyFinding = (f, dim) => {
  const n = votesFor(f.severity)
  const short = f.file.split('/').pop()
  return parallel(Array.from({ length: n }, (_, i) => () =>
    agent(VERIFY_PROMPT(f, dim, i, n), {
      agentType: 'review-verifier',
      label: (n > 1 ? 'v' + i + ':' : 'verify:') + dim.key + ':' + short,
      phase: 'Verify', schema: VERDICT_SCHEMA,
    })
  )).then(votes => {
    const valid = votes.filter(Boolean)
    if (valid.length === 0) return null // all abstained/errored → drop (no false alarm)
    const real = valid.filter(v => v.isReal)
    if (!(real.length > valid.length / 2)) return null // needs a strict majority calling it real
    return { ...f, dimension: dim.key, severity: decideSeverity(real, f.severity),
      verifierReason: real.map(v => v.reason).join(' | '), votes: real.length + '/' + valid.length }
  })
}

// ─── Find + Verify (pipeline: each dimension's findings verify as soon as that dimension returns) ───
const reviewed = await pipeline(
  runDims,
  dim => agent(FIND_PROMPT(dim), { agentType: dim.agentType, label: 'find:' + dim.key, phase: 'Find', schema: FINDINGS_SCHEMA })
    .then(r => {
      const findings = r && Array.isArray(r.findings) ? r.findings : []
      log('find:' + dim.key + ' → ' + findings.length + ' candidate' + (findings.length === 1 ? '' : 's'))
      return { dim, findings }
    }),
  ({ dim, findings }) => parallel(findings.map(f => () => verifyFinding(f, dim)))
)

// ─── Dedup + verdict ───
const confirmedRaw = reviewed.flat().filter(Boolean)
const byKey = new Map()
for (const f of confirmedRaw) {
  const k = (f.file + ':' + f.line + ':' + f.title).toLowerCase()
  const prev = byKey.get(k)
  if (!prev || sevRank[f.severity] < sevRank[prev.severity]) byKey.set(k, f)
}
const confirmed = [...byKey.values()].sort((a, b) => sevRank[a.severity] - sevRank[b.severity])
const counts = confirmed.reduce((acc, f) => { acc[f.severity]++; return acc }, { P0: 0, P1: 0, P2: 0, P3: 0 })
const verdict = confirmed.some(f => BLOCKING.has(f.severity)) ? 'FAIL' : 'PASS'
log('Verify done: ' + confirmedRaw.length + ' survived → ' + confirmed.length + ' after dedup · ' +
  'P0=' + counts.P0 + ' P1=' + counts.P1 + ' P2=' + counts.P2 + ' P3=' + counts.P3 + ' → ' + verdict)

if (confirmed.length === 0) {
  return { verdict: 'PASS', scope: { mode, base: baseRef, dimensions: runDims.map(d => d.key) }, findings: [], counts,
    note: 'No findings survived adversarial verification.', stats: { dimensions: runDims.length, candidates: reviewed.flat().length } }
}

// ─── Synthesize ───
phase('Synthesize')
const block = confirmed.map((f, i) =>
  '### [' + i + '] ' + f.severity + ' · ' + f.title + '\n`' + f.file + ':' + f.line + '` (dimension: ' + f.dimension + ', votes ' + f.votes + ')\n' +
  'Evidence: ' + f.evidence + '\nWhy: ' + f.why + '\nVerifier: ' + f.verifierReason + '\n'
).join('\n')

const synth = await agent(
  '## Synthesize the Facet code-review result\n\n' +
  confirmed.length + ' findings survived adversarial verification. For EACH, propose the concrete fix ' +
  '(what to change, not "make it cleaner"). Preserve severity, file, and line exactly. Then write a 2-4 sentence summary.\n\n' +
  '## Confirmed findings\n' + block + '\n\nReturn one entry per finding (same file:line) with its fix, plus the summary.\n\nStructured output only.',
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA }
)

const fixByKey = new Map()
if (synth && Array.isArray(synth.findings)) for (const s of synth.findings) fixByKey.set((s.file + ':' + s.line).toLowerCase(), s.fix)
const findings = confirmed.map(f => ({
  severity: f.severity, title: f.title, file: f.file, line: f.line, dimension: f.dimension,
  votes: f.votes, evidence: f.evidence, why: f.why,
  fix: fixByKey.get((f.file + ':' + f.line).toLowerCase()) || '(fix not synthesized — see evidence)',
}))

return {
  verdict,
  scope: { mode, base: baseRef, dimensions: runDims.map(d => d.key), changedFiles },
  counts,
  summary: (synth && synth.summary) || (verdict + ' — ' + confirmed.length + ' confirmed finding(s).'),
  findings,
  stats: { dimensions: runDims.length, candidates: reviewed.flat().length, confirmed: confirmed.length, votesHigh: VOTES_HIGH },
}
