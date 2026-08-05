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
The markup parser, component catalog validation, authorized patch fold, and
`StageRenderer` form the display safety boundary: model output is data, not
code. Only registered component tags with declared props, validated bindings,
and trusted host-provided React implementations reach the DOM. Unknown tags,
invalid props, malformed/cyclic/overly deep documents, and failed trusted
component subtrees degrade to bounded safe output instead of crashing the page.
Model output is untrusted and is treated as such here.

**`@facet/server` — a reference transport, not a hardened multi-tenant server.**
It is designed for local/self-hosted, single-operator use where the page is
public or anonymous. In its default configuration it does **not** authenticate:

- The `/agent/*` control channel on the reference server is unauthenticated
  unless you set `agentToken` and configure external agents to send the matching
  `x-facet-token` header, for example from `FACET_AGENT_TOKEN`. Set it whenever
  the server is reachable by anything other than a trusted local process.
- The browser channel trusts `sessionKey` as-is — it is not verified. The
  default browser helper stores a 128-bit random UUID as the local session key,
  which is correct for anonymous pages. If you key sessions by a
  guessable/enumerable id, or your pages carry per-user sensitive data, you
  **must** add your own authentication in front of the server; otherwise one
  visitor can read another's page and history.

If you build a hosted / multi-tenant product on top of `@facet/server`, treat the
above as required work, not optional — add authentication, per-tenant isolation,
and rate limiting at your edge.

`@facet/quickstart` is the reference local server: it composes `@facet/server`
and `@facet/reference-agent` behind a zero-setup CLI. It binds loopback by
default, hides `/agent/*` on the public wrapper, and uses a random internal
agent token for the loopback server. Its browser routes still remain
unauthenticated and `/event`/`/message` can spend the operator's provider key,
so expose Quickstart beyond your own machine only after adding authentication,
rate limiting, and spend controls in front. Treat visitor sessions as
anonymous-only unless that outer layer authenticates them.

Two in-memory server structures are bounded, best-effort caches under that same
trust model: the per-session frame log backing `Last-Event-ID` resume (session
churn evicts it — resume then degrades to a full rehydrate, nothing is lost)
and the remote-agent pending window keyed by opaque transport correlations
(bounded FIFO; on an unauthenticated port it is one more reason to set
`agentToken`).

[gh-report]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability
