# T23: real Qdrant verification

## Required MANUAL acceptance

T23 is required before acceptance and must run against real Qdrant; mocks and health
checks do not satisfy it. The PR author runs the explicit integration suite below
against the proposed changes before acceptance and records the command, Qdrant version,
actual output, and exit code. The reviewer checks those results before acceptance.
A failed or unrun T23 blocks acceptance; historical results do not replace this run.
This is a manual acceptance requirement, not a CI job.

Run from the existing checkout. Docker commands run at repository root:

```shell
docker run --detach --rm --name roo-vector-t23 -p 127.0.0.1:16333:6333 qdrant/qdrant:v1.17.0
```

Once Qdrant is ready, run from `src`:

```shell
npx vitest run --config services/code-index/vector-store/vitest.integration.config.ts
```

Stop only the container created for this run:

```shell
docker stop roo-vector-t23
```

The harness uses unique workspace-derived collections and deletes them after each case.
It holds actual delete HTTP requests in a local proxy until after a retry's writes and
verification, then forwards the original request to Qdrant. No Qdrant calls are mocked.
Only translation is stubbed. Tests assert legacy cleanup, exact current/other counts,
exact file matching, generation index creation, delayed cleanup/removal fencing, and
visibility of a late old upsert without loss of current points.

`QDRANT_INTEGRATION_URL` overrides the default `http://127.0.0.1:16333`; the delay proxy
requires an HTTP endpoint. An unavailable server fails the suite, never skips it.
The `.integration.ts` suffix is intentionally outside default Vitest unit discovery;
only the explicit integration configuration includes these tests.

## Observed compatibility limitation

Verified on 2026-10-30 with the installed client 1.14.0:

- `npx vitest run --config services/code-index/vector-store/vitest.integration.config.ts`
  against the Docker `qdrant/qdrant:v1.17.0` image reported `4 passed`.
  The client emitted its version-compatibility warning; that check was not disabled.
- The same command against `qdrant/qdrant:v1.14.1` failed intermittently: after an
  awaited fenced delete, exact counts sometimes reported `current: 2, other: 1`.
  A diagnostic scroll showed the retained point had no `generation` field.
  This is a failed real-server premise, not acceptance evidence for that version.
  No retries or weakened assertions conceal the failure.

The local late-upsert measurement is only one completed local request, not evidence
that arbitrary abandoned writes settle within the late-write grace period.
