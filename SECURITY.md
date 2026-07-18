# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report them privately using GitHub's [private vulnerability reporting][gh-report]
— open the repository's **Security** tab and click **Report a vulnerability**.

Please include:

- the affected package(s) and version(s),
- a description of the issue and its impact,
- steps to reproduce (a minimal repro is ideal).

We aim to acknowledge a report within a few days and will keep you updated on
progress toward a fix. Once a fix is released, we're happy to credit you unless
you prefer to remain anonymous.

## Supported Versions

Facet has not published an npm release yet; security fixes currently target
`main`. After the first release, only the latest published version of each
`@facet/*` package will receive security fixes.

## Trust model

Different parts of Facet assume different trust levels — know which you're in.

**Core validation and the React renderer — fail-safe, untrusted input.**
`validateTree` and `StageRenderer` form the display safety boundary: only the
closed, validated native Brick vocabulary reaches the DOM (no raw HTML/JS),
unsafe media URL schemes are dropped, and malformed, cyclic, or overly deep
input is sanitized or skipped without crashing the page. Model output is
untrusted and is treated as such here.

**`@facet/server` — a reference transport, not a hardened multi-tenant server.**
It is designed for local/self-hosted, single-operator use where the page is
public or anonymous. In its default configuration it does **not** authenticate:

- The `/agent/*` control channel is unauthenticated unless you set `agentToken`
  (and have the bridge send `FACET_AGENT_TOKEN`). Set it whenever the server is
  reachable by anything other than your own bridge.
- The browser channel trusts `visitorId` as the session key — it is not verified.
  The default browser id is a 128-bit random UUID (unguessable), which is correct
  for anonymous pages. If you key sessions by a guessable/enumerable id, or your
  pages carry per-user sensitive data, you **must** add your own authentication in
  front of the server; otherwise one visitor can read another's page and history.

If you build a hosted / multi-tenant product on top of `@facet/server`, treat the
above as required work, not optional — add authentication, per-tenant isolation,
and rate limiting at your edge.

Two in-memory server structures are bounded, best-effort caches under that same
trust model: the per-session frame log backing `Last-Event-ID` resume (session
churn evicts it — resume then degrades to a full rehydrate, nothing is lost)
and the late-result window keyed by sequential request ids (bounded FIFO; on an
unauthenticated port it is one more reason to set `agentToken`).

**Facet Lab — loopback-only maintainer tooling.** `apps/facet-lab` binds only to
an explicit numeric loopback address and rejects non-loopback binds, unexpected
`Host`/`Origin` values, ambiguous request targets, direct `/agent` access, and
oversized bodies before proxying or reading files. Provider keys stay in the
Node process and provider authorization headers; the browser receives only a
safe capability projection and never a key value.

Run evidence and screenshots may still contain model-authored or operator
content. Lab therefore stores them in an external platform application-data
directory (or an explicit `FACET_LAB_DATA_DIR` outside the repository), applies
size and retention bounds, redacts on capture/export, scans configured secret
canaries, and validates schema, digest, artifact identity, and size again on
import. Corrupt or unsupported records are isolated instead of becoming stage
input. Imported assets are validated and detached; they remain data, not code.

Loopback is not an authentication boundary if another process, port forward, or
reverse proxy exposes it. Do not publish the Lab port directly. An operator who
needs remote access must keep Lab on loopback and place an authenticated,
authorized, rate-limited, TLS-terminating boundary in front of it, isolate the
data directory and provider environment, and define retention/audit policy for
the deployment. Facet Lab itself is not a hardened multi-user or multi-tenant
service.

[gh-report]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability
