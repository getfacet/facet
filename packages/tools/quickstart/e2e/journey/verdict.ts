/**
 * WU-1 (Decision A) — the ONE pure rule that decides the live-journey tier.
 *
 * Lenses are judged per (lens × visitor) with multiple adversarial votes each.
 * `aggregateVerdict` collapses those votes into a single tier verdict under a
 * HARD/SOFT/quorum policy:
 *
 *   - HARD lenses (safety, render, responsiveness): a (lens × visitor) row FAILS
 *     when the majority of its valid votes fail. If the valid votes are BELOW
 *     quorum (too many abstentions, or a missing row entirely) the row is
 *     `insufficient` — NEVER a silent pass. Any HARD fail/insufficient on any
 *     visitor ⇒ tier FAIL.
 *   - SOFT lenses (fidelity, diversity): a fail/insufficient ⇒ a WARNING only,
 *     never a tier FAIL.
 *   - Happy: every HARD row passes and no SOFT row fails ⇒ PASS (no warnings).
 *
 * The rule is PURE and deterministic — no I/O. The only I/O is `main()`, guarded
 * by an `import.meta` entry check so importing this module runs nothing. The
 * live-journey workflow (WU-4) writes the collected votes to JSON and runs
 * `node verdict.js votes.json`, so this tested function is what actually gates.
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export type LensId = "safety" | "render" | "responsiveness" | "fidelity" | "diversity";
export type Severity = "hard" | "soft";
export type VoteVerdict = "pass" | "fail" | "abstain";

export interface Vote {
  readonly lens: LensId;
  readonly visitor: string;
  readonly verdict: VoteVerdict;
}

export interface LensPolicy {
  readonly lens: LensId;
  readonly severity: Severity;
  readonly quorum: number;
}

export type LensOutcome = "pass" | "fail" | "insufficient";

export interface LensRow {
  readonly lens: LensId;
  readonly visitor: string;
  readonly outcome: LensOutcome;
}

export interface TierVerdict {
  readonly result: "PASS" | "FAIL";
  /** one entry per failed/insufficient SOFT (lens × visitor). */
  readonly warnings: readonly string[];
  /** one entry per failed/insufficient HARD (lens × visitor) — names the visitor. */
  readonly blocking: readonly string[];
  readonly perLens: readonly LensRow[];
}

export interface ExpectedRow {
  readonly lens: LensId;
  readonly visitor: string;
}

/**
 * Default HARD/SOFT/quorum policy. Quora match the workflow's per-lens vote
 * counts (Decision Lock: "adjustable" — pass a custom policy to override).
 */
export const DEFAULT_LENS_POLICY: readonly LensPolicy[] = [
  { lens: "safety", severity: "hard", quorum: 2 }, // 3 adversarial votes, need ≥2 valid
  { lens: "render", severity: "hard", quorum: 2 }, // 3 functional votes (VOTES_HARD), need ≥2 valid
  { lens: "responsiveness", severity: "hard", quorum: 2 }, // 3 functional votes (VOTES_HARD), need ≥2 valid
  { lens: "fidelity", severity: "soft", quorum: 2 }, // 2 votes (VOTES_SOFT)
  { lens: "diversity", severity: "soft", quorum: 1 }, // 1 cross-visitor vote
];

const LENS_IDS: readonly LensId[] = ["safety", "render", "responsiveness", "fidelity", "diversity"];
const VOTE_VERDICTS: readonly VoteVerdict[] = ["pass", "fail", "abstain"];

/** Fail-closed element guard for main()'s external votes JSON — a stray element
 * (e.g. a `verdict` of "FAIL" instead of "fail") is DROPPED, never scored as a
 * pass on a HARD lens. */
export function isVote(x: unknown): x is Vote {
  if (typeof x !== "object" || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    (LENS_IDS as readonly string[]).includes(v.lens as string) &&
    typeof v.visitor === "string" &&
    (VOTE_VERDICTS as readonly string[]).includes(v.verdict as string)
  );
}

/**
 * The expected (lens × visitor) rows for a run — the cartesian product of every
 * policy lens with every judged visitor. `aggregateVerdict` evaluates this whole
 * set so a MISSING vote row is `insufficient` (below quorum), never silently
 * dropped. Exported (P3#2 refinement) so the workflow can build the same matrix
 * explicitly rather than have it buried inside the aggregator.
 */
export function expectedMatrix(
  visitors: readonly string[],
  policy: readonly LensPolicy[] = DEFAULT_LENS_POLICY,
): readonly ExpectedRow[] {
  return policy.flatMap((p) => visitors.map((visitor) => ({ lens: p.lens, visitor })));
}

/** Distinct visitors across all votes, in first-seen order. */
function visitorsOf(votes: readonly Vote[]): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const { visitor } of votes) {
    if (!seen.has(visitor)) {
      seen.add(visitor);
      ordered.push(visitor);
    }
  }
  return ordered;
}

/**
 * Collapse per-(lens × visitor) votes into a single tier verdict under `policy`.
 * PURE — no I/O. Below quorum / a missing row ⇒ `insufficient` (never a silent
 * pass); a HARD fail/insufficient blocks; a SOFT fail/insufficient only warns.
 */
export function aggregateVerdict(
  votes: readonly Vote[],
  policy: readonly LensPolicy[] = DEFAULT_LENS_POLICY,
): TierVerdict {
  // Fail closed on no evidence: an empty run is never a silent pass.
  if (votes.length === 0) {
    return {
      result: "FAIL",
      warnings: [],
      blocking: ["(no votes): insufficient evidence — failing closed"],
      perLens: [],
    };
  }

  const visitors = visitorsOf(votes);
  const expected = expectedMatrix(visitors, policy);
  const policyByLens = new Map(policy.map((p) => [p.lens, p]));

  const warnings: string[] = [];
  const blocking: string[] = [];
  const perLens: LensRow[] = [];

  for (const { lens, visitor } of expected) {
    const pol = policyByLens.get(lens);
    if (pol === undefined) continue; // expected is built from policy — unreachable

    const valid = votes.filter(
      (vote) => vote.lens === lens && vote.visitor === visitor && vote.verdict !== "abstain",
    );

    let outcome: LensOutcome;
    if (valid.length < pol.quorum) {
      outcome = "insufficient";
    } else {
      const fails = valid.filter((vote) => vote.verdict === "fail").length;
      const passes = valid.length - fails;
      // A tie is conservative: it counts as a fail.
      outcome = passes > fails ? "pass" : "fail";
    }

    perLens.push({ lens, visitor, outcome });
    if (outcome === "pass") continue;

    const label = `${lens}×${visitor}: ${outcome}`;
    if (pol.severity === "hard") blocking.push(label);
    else warnings.push(label);
  }

  return {
    result: blocking.length > 0 ? "FAIL" : "PASS",
    warnings,
    blocking,
    perLens,
  };
}

/**
 * CLI entry (the ONLY I/O in this module). Reads a votes JSON from argv[0] (a
 * file path, or `-`/absent for stdin), aggregates, prints the verdict, and exits
 * 0 on PASS/PASS-with-warnings, 1 on FAIL. Fail-closed on unreadable/garbage
 * input. Guarded by an `import.meta` entry check — importing this module runs
 * nothing.
 */
async function main(argv: readonly string[]): Promise<void> {
  const source = argv[0];

  let raw: string;
  try {
    if (source !== undefined && source !== "-") {
      raw = await readFile(source, "utf8");
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      raw = Buffer.concat(chunks).toString("utf8");
    }
  } catch (error) {
    process.stderr.write(`verdict: could not read votes (${String(error)}) — failing closed\n`);
    process.exit(1);
  }

  let votes: readonly Vote[];
  try {
    const parsed: unknown = JSON.parse(raw);
    const candidate = Array.isArray(parsed)
      ? parsed
      : (parsed as { votes?: unknown } | null)?.votes;
    votes = Array.isArray(candidate) ? candidate.filter(isVote) : [];
  } catch {
    process.stderr.write("verdict: could not parse votes JSON — failing closed\n");
    process.exit(1);
  }

  const verdict = aggregateVerdict(votes);
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  process.exit(verdict.result === "FAIL" ? 1 : 0);
}

// Run main() only when executed directly (node verdict.js …), never on import.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void main(process.argv.slice(2));
}
