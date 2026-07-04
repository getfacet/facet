export const meta = {
  name: 'live-journey',
  description: 'Live journey tier — 3 fresh-visitor Playwright journeys against a real-LLM quickstart, then per-lens vision judges, synthesized through the tested verdict.ts (HARD/SOFT/quorum). Owner-run, pre-merge.',
  whenToUse: 'Invoked by /live-test after the vitest Tiers 1-2, when a provider key is present and a real-LLM quickstart server URL is supplied. Proves the real browser + real LLM experience renders and responds. Not a CI gate.',
  phases: [
    { title: 'Preflight', detail: 'node dist/cli.js --stub bin smoke (the published-bin standalone gap)' },
    { title: 'Journey', detail: '3 visitors, each a fresh visitorId, run the fixed Playwright journey → screenshots' },
    { title: 'Judge', detail: 'per (visitor × lens) vision judges — render/responsiveness/safety/fidelity + cross-visitor diversity' },
    { title: 'Synthesize', detail: 'aggregate votes through node verdict.ts (HARD/SOFT/quorum) → PASS/FAIL/WARNING' },
  ],
}

// live-journey: Preflight (bin smoke) → fan-out 3 visitor journeys (Playwright, via agents that run
// tsx journey.ts) → fan-out per-(visitor×lens) vision judges → synthesize through the tested verdict.ts.
// The workflow script has no shell, so every browser run / node run happens inside an agent() bash call,
// and every screenshot is assessed by a judge agent that Reads the PNG (vision). The LONG-LIVED real-LLM
// server lifecycle is owned by the /live-test skill (durable main-agent bash), which passes `url` here and
// tears it down after. Every gating decision is delegated to verdict.ts — this script never re-implements it.

const JOURNEY = 'packages/quickstart/e2e/journey/journey.ts'
const VERDICT = 'packages/quickstart/e2e/journey/verdict.ts'

// Per-visitor lenses (judged on each visitor's shots). HARD/SOFT is decided by verdict.ts's
// DEFAULT_LENS_POLICY — kept here only to know which judges to spawn. `diversity` is cross-visitor.
const PER_VISITOR_LENSES = [
  { key: 'render', focus: 'Did each screenshot show a COHERENT, non-empty rendered page (a real UI: text, boxes, a chat dock) — not blank, not raw JSON, not an error?' },
  { key: 'responsiveness', focus: 'Across the 4 shots (load → after chat 1 → after chat 2 → after click), did the page VISIBLY CHANGE in response to the chat messages and the click — i.e. the UI is live, not frozen?' },
  { key: 'safety', focus: 'ADVERSARIAL: scan every shot for ANY broken state — blank canvas, raw JSON/markup leaking as text, an error message, overlapping/off-screen/cut-off layout, unreadable contrast. Fail if you find ONE.' },
  { key: 'fidelity', focus: 'Did the page actually reflect the requests — a Pricing section with ~three plans appearing after chat 1, and a playful/cat-themed restyle after chat 2? (SOFT — a reasonable partial attempt passes.)' },
]
const VOTES_HARD = 3 // adversarial votes for the HARD-ish lenses
const VOTES_SOFT = 2

const cfg = (args && typeof args === 'object') ? args : {}
const url = typeof cfg.url === 'string' ? cfg.url : ''
const artifactsDir = typeof cfg.artifactsDir === 'string' ? cfg.artifactsDir : 'packages/quickstart/e2e/journey/artifacts'
const nVisitors = Number.isInteger(cfg.visitors) && cfg.visitors > 0 ? cfg.visitors : 3

if (cfg.keyPresent === false) {
  return { verdict: 'SKIP', reason: 'No provider key — the live-journey tier is owner-run and needs a real LLM; SKIP-with-reason (this is NOT the Tier-2 SKIPPED=FAIL rule).' }
}
if (!url) {
  return { verdict: 'SKIP', reason: 'No server url supplied — /live-test boots the real-LLM quickstart and passes { url } to this workflow.' }
}

// ─── Schemas ───
const RUN_SCHEMA = {
  type: 'object', required: ['ok', 'shots'],
  properties: {
    ok: { type: 'boolean' },
    shots: { type: 'array', items: { type: 'string' } }, // screenshot file paths
    detail: { type: 'string' },
  },
}
const VOTE_SCHEMA = {
  type: 'object', required: ['verdict', 'reason'],
  properties: {
    verdict: { enum: ['pass', 'fail', 'abstain'] }, // matches verdict.ts Vote
    reason: { type: 'string' },
  },
}
const SMOKE_SCHEMA = {
  type: 'object', required: ['ran', 'ok', 'detail'],
  properties: { ran: { type: 'boolean' }, ok: { type: 'boolean' }, detail: { type: 'string' } },
}
const SYNTH_SCHEMA = {
  type: 'object', required: ['verdict', 'exitCode'],
  properties: {
    verdict: { enum: ['PASS', 'FAIL'] },
    exitCode: { type: 'number' },
    warnings: { type: 'array', items: { type: 'string' } },
    blocking: { type: 'array', items: { type: 'string' } },
    raw: { type: 'string' },
  },
}

// ─── Preflight: the published-bin standalone smoke (short-lived, stub, no key) ───
phase('Preflight')
const smoke = await agent(
  '## Preflight: published-bin standalone smoke\n\n' +
  'Run the built quickstart bin standalone and report whether it boots — this gates the dev-vs-published resolution gap.\n' +
  'Run: `pnpm --filter @facet/quickstart build` then use the harness `runBinSmoke` OR directly `node packages/quickstart/dist/cli.js --stub --port <free>`, poll `/health`, then KILL the child.\n' +
  'Return { ran:true, ok:<did it answer /health 200?>, detail:<one line — e.g. the ERR_MODULE_NOT_FOUND if it failed> }. ' +
  'NOTE: in the dev monorepo it is EXPECTED to fail (ok:false) with `@facet/* → src/*.ts` resolution — report that; do not treat it as a tier failure by itself.\n\nStructured output only.',
  { label: 'bin-smoke', phase: 'Preflight', schema: SMOKE_SCHEMA }
)
log('Bin smoke: ' + (smoke ? (smoke.ok ? 'boots ✓' : 'ok=false — ' + (smoke.detail || '').slice(0, 80)) : 'no result'))

// ─── Journey: 3 fresh-visitor Playwright runs (parallel) ───
phase('Journey')
const visitors = Array.from({ length: nVisitors }, (_, i) => 'v' + (i + 1))
const runs = await parallel(visitors.map(v => () =>
  agent(
    '## Visitor ' + v + ' — run the fixed Playwright journey\n\n' +
    'Run EXACTLY this (headless; it launches its own chromium + a fresh visitor context):\n' +
    '```\npnpm exec tsx ' + JOURNEY + ' --url ' + url + ' --visitor ' + v + ' --out ' + artifactsDir + '/' + v + '\n```\n' +
    'It captures ≥4 screenshots into that --out dir and prints a JSON result. Return ok (did it finish + write ≥4 shots?), ' +
    'the absolute (or repo-relative) screenshot file paths in step order, and a one-line detail. Do NOT judge the shots — just run + report paths.\n\nStructured output only.',
    { label: 'journey:' + v, phase: 'Journey', schema: RUN_SCHEMA }
  ).then(r => ({ visitor: v, ...(r || { ok: false, shots: [] }) }))
))
const goodRuns = runs.filter(r => r && r.ok && Array.isArray(r.shots) && r.shots.length >= 4)
const droppedVisitors = runs.filter(r => !goodRuns.includes(r)).map(r => r.visitor + ' (' + ((r && r.shots ? r.shots.length : 0)) + ' shots)')
log('Journeys: ' + goodRuns.length + '/' + nVisitors + ' produced ≥4 shots' + (droppedVisitors.length ? ' — dropped: ' + droppedVisitors.join(', ') : ''))

// ─── Judge: per (visitor × lens) adversarial vision votes, + a cross-visitor diversity judge ───
phase('Judge')
const judgePrompt = (v, shots, lens, voterIdx, total) =>
  '## Vision judge — visitor ' + v + ', lens "' + lens.key + '"' + (total > 1 ? ' (independent voter ' + (voterIdx + 1) + '/' + total + ')' : '') + '\n\n' +
  'READ these screenshots (they are the journey in order: 1=load, 2=after "add a Pricing section", 3=after "restyle playful/cat-themed", 4=after a click):\n' +
  shots.map((s, i) => (i + 1) + '. ' + s).join('\n') + '\n\n' +
  '## Assess ONLY this lens\n' + lens.focus + '\n\n' +
  'This is a NON-DETERMINISTIC LLM-drawn page — judge SEMANTICALLY and loosely (does it reasonably hold?), NOT against a golden image. ' +
  'Return verdict "pass"/"fail" (or "abstain" ONLY if a shot is missing/unreadable), and a one-line reason citing what you saw.\n\nStructured output only.'

// Each visitor's shots judged per lens with N adversarial votes → a flat votes array for verdict.ts.
const perVisitorVotes = await parallel(goodRuns.flatMap(run =>
  PER_VISITOR_LENSES.map(lens => () => {
    const n = lens.key === 'fidelity' ? VOTES_SOFT : VOTES_HARD
    return parallel(Array.from({ length: n }, (_, i) => () =>
      agent(judgePrompt(run.visitor, run.shots, lens, i, n), {
        label: 'judge:' + run.visitor + ':' + lens.key + (n > 1 ? ':' + i : ''), phase: 'Judge', schema: VOTE_SCHEMA,
      }).then(vote => vote ? { lens: lens.key, visitor: run.visitor, verdict: vote.verdict, reason: vote.reason }
        : { lens: lens.key, visitor: run.visitor, verdict: 'abstain', reason: 'judge returned nothing' })
    ))
  })
))

// Cross-visitor diversity (SOFT): one judge over the load-shots of all visitors.
let diversityVotes = []
if (goodRuns.length >= 2) {
  const loadShots = goodRuns.map(r => ({ v: r.visitor, shot: r.shots[0] }))
  const dv = await agent(
    '## Cross-visitor diversity judge (lens "diversity", SOFT)\n\n' +
    'READ the FIRST (load) screenshot of each visitor:\n' + loadShots.map(x => x.v + ': ' + x.shot).join('\n') + '\n\n' +
    'Are the visitors\' initial pages APPROPRIATELY distinct AND each a valid coherent page? (Some variation is expected — a real LLM drew each per-visitor. Byte-identical-looking is a soft concern, not a hard fail.) ' +
    'Return "pass" if each is valid and there is at least reasonable variation, "fail" if they are broken or suspiciously identical.\n\nStructured output only.',
    { label: 'judge:diversity', phase: 'Judge', schema: VOTE_SCHEMA }
  )
  // Diversity is one cross-visitor vote; attribute it to each visitor so verdict.ts's expectedMatrix is satisfied.
  if (dv) diversityVotes = goodRuns.map(r => ({ lens: 'diversity', visitor: r.visitor, verdict: dv.verdict, reason: dv.reason }))
}

const votes = perVisitorVotes.flat().concat(diversityVotes)
log('Judge: ' + votes.length + ' votes across ' + goodRuns.length + ' visitors × ' + (PER_VISITOR_LENSES.length + 1) + ' lenses')

// ─── Synthesize: delegate the HARD/SOFT/quorum decision to the tested verdict.ts (never re-implement) ───
phase('Synthesize')
if (goodRuns.length === 0) {
  return { verdict: 'FAIL', reason: 'No visitor produced ≥4 screenshots — the journey/browser failed before any judging.', runs, smoke, artifactsDir }
}
const votesJson = JSON.stringify({ votes, visitors: goodRuns.map(r => r.visitor) })
const synth = await agent(
  '## Synthesize the tier verdict via the tested verdict.ts\n\n' +
  'Write this votes JSON to `' + artifactsDir + '/votes.json` (create the dir if needed) and run:\n' +
  '```\npnpm exec tsx ' + VERDICT + ' ' + artifactsDir + '/votes.json\n```\n' +
  'It applies the HARD/SOFT/quorum rule (this is the SINGLE source of truth — do NOT compute the verdict yourself). ' +
  'The votes to write:\n```json\n' + votesJson + '\n```\n' +
  '(It expects the full lens×visitor matrix; a missing HARD row is treated as insufficient ⇒ FAIL.)\n' +
  'Optionally assemble a GIF from the per-visitor shots into `' + artifactsDir + '/journey.gif` for the human (best-effort; skip on failure).\n' +
  'Return the verdict PASS/FAIL, the process exit code, any warnings (SOFT-lens fails), any blocking reasons (HARD-lens fails/insufficient), and the raw verdict.ts output.\n\nStructured output only.',
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA }
)

// Fail-closed on partial visitor loss: a dropped visitor is never judged, so the
// judge panel could report PASS on the survivors alone — but DC-001 requires ALL
// requested visitors to render. Any drop ⇒ tier FAIL (never a silent pass).
const synthVerdict = (synth && synth.verdict) || 'FAIL'
const verdict = droppedVisitors.length > 0 ? 'FAIL' : synthVerdict
const blocking = [
  ...((synth && synth.blocking) || (synthVerdict === 'FAIL' ? ['verdict.ts reported FAIL — see raw'] : [])),
  ...(droppedVisitors.length > 0 ? ['visitor journey(s) dropped (crashed / <4 shots): ' + droppedVisitors.join(', ')] : []),
]
return {
  verdict, // PASS | FAIL (SKIP handled earlier)
  warnings: (synth && synth.warnings) || [],
  blocking,
  binSmoke: smoke ? { ok: smoke.ok, detail: smoke.detail } : { ok: false, detail: 'no result' },
  visitors: runs.map(r => ({ visitor: r.visitor, ok: r.ok, shots: (r.shots || []).length })),
  artifactsDir,
  raw: synth && synth.raw,
  stats: { visitors: nVisitors, goodRuns: goodRuns.length, votes: votes.length },
}
