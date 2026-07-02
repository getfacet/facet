# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report them privately using GitHub's [private vulnerability reporting][gh-report]
— open the repository's **Security** tab and click **Report a vulnerability**.
(Alternatively, email **[INSERT CONTACT — e.g. security@facet.run]**.)

Please include:

- the affected package(s) and version(s),
- a description of the issue and its impact,
- steps to reproduce (a minimal repro is ideal).

We aim to acknowledge a report within a few days and will keep you updated on
progress toward a fix. Once a fix is released, we're happy to credit you unless
you prefer to remain anonymous.

## Supported Versions

Facet is pre-1.0; only the latest published version of each `@facet/*` package
receives security fixes.

## Trust model

Different parts of Facet assume different trust levels — know which you're in.

**`@facet/core` renderer/validator — fail-safe, untrusted input.** The renderer
and `validateTree` are the safety boundary: only the four declarative bricks ever
reach the DOM (no raw HTML/JS), unsafe image URL schemes are dropped, and
malformed/cyclic/too-deep input renders as "plain", never a crash. Model output
is untrusted and is treated as such here.

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

[gh-report]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability
