# Memoria Architecture Review

<executive_summary>
- Overall architecture assessment: Memoria is a pragmatic, lightweight memory-service architecture that fits early-stage and prototype workloads well, with a clean API/MCP boundary and a simple storage abstraction. Its main weaknesses are production hardening gaps around security, horizontal scale, resilience, and operations.
- Top 3 strengths:
  - Clear separation between API surface, embedding generation, storage abstraction, and MCP integration.
  - Cost-efficient default path: local JSON storage plus compressed embeddings keeps the entry cost low.
  - Strong product fit for AI agents through MCP tooling, semantic retrieval, and user-scoped memory boundaries.
- Top 3 risks:
  - Security posture is weak for internet-facing deployment because auth can be fully bypassed when keys are unset, `fetch-url` enables SSRF risk, and `parse-file` is unauthenticated.
  - Reliability depends heavily on external Gemini embeddings with no circuit breaker, fallback path, or durable distributed controls.
  - Scalability is constrained by in-memory rate limiting, synchronous local file persistence, and linear scan retrieval without a true vector index.
- Recommended priority focus: Harden security and operational controls before scaling traffic or multi-tenant usage.
- Overall confidence level: Medium
</executive_summary>

<system_overview>
- Core business purpose and key requirements:
  - Provide persistent semantic memory for AI applications and agents.
  - Support store, retrieve, update, delete, and import flows for user-scoped memories.
  - Expose the capability through both REST APIs and an MCP server.
- System boundaries and external dependencies:
  - Internal: Next.js app, API routes, playground UI, local file store, storage adapter, MCP server.
  - External: Google Gemini embedding API, optional ClickHouse, deployment environment, optional downstream blob storage for media pointers.
- Major components and responsibilities:
  - `app/api/...`: REST endpoints for memory CRUD, context search, import, health, file parsing, and URL fetch.
  - `/home/runner/work/memoria/memoria/lib/gemini.ts`: embedding generation wrapper.
  - `/home/runner/work/memoria/memoria/lib/memory-store.ts`: local JSON store and TurboQuant compression.
  - `/home/runner/work/memoria/memoria/lib/store.ts`: runtime switch between local storage and ClickHouse.
  - `/home/runner/work/memoria/memoria/lib/auth.ts` and `/home/runner/work/memoria/memoria/lib/rate-limit.ts`: access control and request throttling.
  - `/home/runner/work/memoria/memoria/mcp-server.ts`: MCP tool adapter over the HTTP API.
- Key interfaces and integration points:
  - REST API for application integration.
  - MCP stdio interface for AI clients.
  - Gemini embeddings API for vector generation.
  - ClickHouse for scaled persistence.
- Primary data flows:
  - Store flow: request → auth → rate limit → embedding generation → storage adapter → local JSON or ClickHouse.
  - Search flow: request → auth → rate limit → query embedding → storage search → scored text results.
  - MCP flow: tool request → local HTTP call into API.
- Technology choices and likely rationale:
  - Next.js App Router for quick full-stack delivery.
  - Gemini embeddings to avoid self-hosting vectorization.
  - ClickHouse as an optional scale-up path.
  - Local JSON persistence to minimize setup cost.
</system_overview>

<architectural_patterns>
- Patterns identified:
  - Backend-for-frontend / monolithic full-stack app: UI and API live in one Next.js deployment.
  - Adapter pattern: `lib/store.ts` hides whether storage is local JSON or ClickHouse.
  - Gateway-wrapper pattern: `mcp-server.ts` presents the same capabilities through MCP by calling the HTTP API.
  - Shared-nothing user partitioning: all memory access is keyed by `userId`.
  - Compression-at-write pattern: local storage compresses embeddings before persistence.
- Why each pattern appears to have been chosen:
  - To keep developer setup minimal while preserving a path to larger deployments.
  - To expose one core product capability across both app integrations and AI tooling.
  - To reduce storage costs for local persistence.
- Benefits delivered by each pattern:
  - Faster delivery and low operational overhead for a small codebase.
  - Lower migration cost between dev and scaled deployments.
  - Good product accessibility for agent ecosystems.
- Pattern conflicts or overlap:
  - The dual-store abstraction simplifies deployment but also creates inconsistent behavior: local mode stores compressed embeddings, ClickHouse stores raw float arrays.
  - The monolithic Next.js model conflicts with strong horizontal scale expectations because rate limiting and local storage are instance-local.
- Better-fit alternatives worth considering:
  - Managed vector store or ClickHouse vector index support for higher-scale retrieval.
  - Distributed rate limiting and caching with Redis.
  - Stronger service boundary between public API, ingestion, and search workers if usage grows materially.
- Technical debt implications:
  - Security and reliability shortcuts are manageable in prototype mode but become blocking debt for production.
</architectural_patterns>

<scalability_analysis>
- Horizontal scalability rating (1-5): 2
- Vertical scalability rating (1-5): 3
- Stateless vs. stateful component analysis:
  - API handlers are mostly stateless.
  - Rate limiting is stateful in-process.
  - Local JSON persistence is single-instance state.
  - MCP server is lightweight but still tied to the HTTP app.
- Load balancing and service discovery assessment:
  - Standard HTTP load balancing is feasible only when using shared storage and distributed rate limiting.
  - No service discovery mechanism is needed in the current monolith, but no distributed coordination exists either.
- Caching and data partitioning assessment:
  - No embedding cache, query cache, or result cache is present.
  - Logical partitioning by `userId` is clear and useful.
  - Physical partitioning/sharding is not implemented.
- Current bottlenecks:
  - Gemini embedding latency on every write and search.
  - Local store full-scan cosine search.
  - Synchronous file persistence in local mode.
  - In-memory rate limiter per process.
- Probable future bottlenecks:
  - ClickHouse search cost without a dedicated vector indexing strategy.
  - API cost and throughput limits from Gemini.
  - Multi-instance inconsistency in throttling and local data access.
- Third-party and network scaling constraints:
  - External dependence on Google APIs adds latency and availability coupling.
  - Build/runtime also depends on Google Fonts configured in `/home/runner/work/memoria/memoria/app/layout.tsx`, which increases fragility in network-restricted environments.
</scalability_analysis>

<reliability_review>
- Fault tolerance rating (1-5): 2
- Failure mode analysis:
  - If Gemini is unavailable, both store and search paths fail.
  - If local disk access fails, no local write fallback exists.
  - If ClickHouse is misconfigured or unavailable, requests fail at runtime.
  - If an instance restarts, in-memory rate-limit state is lost.
- Retry, timeout, and circuit breaker posture:
  - No explicit retry or timeout policy is visible around Gemini or ClickHouse access.
  - No circuit breaker or bulkhead isolation is implemented.
- Fallback and graceful degradation posture:
  - There is no fallback embedding provider or deferred-ingestion queue.
  - Search does not degrade to lexical search when embeddings fail.
- Backup and restore assessment:
  - Local JSON mode has no evident backup strategy.
  - ClickHouse persistence exists, but backup and restore procedures are not documented in the codebase.
- RTO / RPO assessment:
  - RTO: likely manual and environment-dependent; not defined.
  - RPO: unclear in both local and ClickHouse modes; no documented backup frequency.
- Disaster recovery and multi-region considerations:
  - No multi-region architecture or disaster recovery mechanism is evident.
  - Single-region / single-node operation appears to be the default assumption.
- Monitoring, alerting, and incident response gaps:
  - Logging is console-based only.
  - No metrics, tracing, dashboards, or alerting hooks are visible.
  - No runbook or incident workflow artifacts are evident.
</reliability_review>

<security_assessment>
- Security posture rating (1-5): 2
- Authentication and authorization assessment:
  - Bearer-token checks exist for memory routes and `fetch-url`.
  - Authorization is coarse-grained and depends on possession of a shared key.
  - `checkAuth` allows all access when no keys are configured, which is unsafe unless strictly limited to local development.
  - `parse-file` does not perform authentication.
- Data protection in transit and at rest:
  - In-transit security is assumed to come from the hosting platform; the app does not enforce HTTPS itself.
  - At-rest encryption is not evident for local JSON files or ClickHouse data.
- API and network security review:
  - `fetch-url` accepts arbitrary URLs and fetches them server-side, creating SSRF risk.
  - `parse-file` and `fetch-url` lack visible size, destination, and abuse controls beyond simple content truncation.
  - Rate limiting is absent on `fetch-url` and `parse-file`.
- Auditability and traceability assessment:
  - There is no audit log for key usage, access, data mutation, or admin events.
- Likely attack surfaces:
  - Public memory APIs.
  - MCP server calling the app API.
  - URL fetch endpoint.
  - File parsing endpoint.
  - Environment-variable based secret handling.
- Privacy and compliance concerns:
  - User memory content may contain sensitive data, but retention, deletion policy, encryption, and compliance posture are not defined.
  - Multi-tenant keys are allowed, but tenant isolation is path-based and not tied to key identity.
- Third-party and supply-chain risks:
  - External dependency on Google Gemini for embeddings.
  - Docker image and npm package dependencies expand the supply-chain surface and should be monitored continuously.
</security_assessment>

<data_architecture_review>
- Data ownership and boundaries:
  - Data is logically owned per `userId`.
  - The platform acts as both ingestion service and primary query path.
- Consistency and transaction model:
  - Local mode is effectively single-node, last-write-wins.
  - ClickHouse writes and deletes are not wrapped in business-level transactions.
  - Consistency expectations are not documented.
- Schema evolution considerations:
  - Memory objects are flexible, but no migration/versioning strategy is evident.
  - Dual-store divergence could complicate future schema changes.
- Retention, backup, and recovery implications:
  - No retention policy, archival strategy, or compaction approach is documented.
  - Local JSON storage can become an operational liability as data grows.
- Reporting and analytics implications:
  - ClickHouse offers a path for analytics, but the current design is optimized more for operational search than governed reporting.
- Data governance risks:
  - Lack of documented lifecycle controls for potentially sensitive memories.
  - No tenant-bound encryption, audit controls, or policy enforcement.
</data_architecture_review>

<operational_readiness>
- Deployability assessment:
  - Good for developer and small-team setup through Next.js, Docker Compose, and optional ClickHouse.
  - Production readiness is limited by missing operational controls.
- Observability maturity:
  - Low. Console logging exists, but no structured telemetry stack is visible.
- Capacity planning readiness:
  - Low to moderate. README claims scaling paths, but concrete throughput, storage, and SLO guidance is absent.
- Runbook and support model gaps:
  - No explicit runbooks for Gemini outage, ClickHouse outage, storage corruption, key rotation, or abuse response.
- Change management and rollback readiness:
  - Standard application rollback is possible via deployment platform, but data rollback procedures are not evident.
</operational_readiness>

<cost_efficiency>
- Resource efficiency rating (1-5): 4
- Compute, storage, and network cost observations:
  - The architecture is very cost-efficient for low-volume use because it avoids always-on distributed infrastructure.
  - Local JSON plus compression is inexpensive.
  - Costs rise with Gemini call volume and ClickHouse adoption.
- Operational overhead drivers:
  - ClickHouse administration, secret handling, and abuse prevention become the main non-code costs.
  - Troubleshooting costs will increase without observability and runbooks.
- Immediate optimization opportunities:
  - Add embedding result caching for repeated content and frequent queries.
  - Keep local mode for dev/test only; use a shared data plane in any multi-instance environment.
  - Reduce dependency on remote fonts for build portability.
- Medium-term architecture optimizations for cost:
  - Introduce batch ingestion and background embedding for large imports.
  - Add cache layers before expensive embedding and retrieval operations.
  - Reassess whether ClickHouse alone is the right long-term search engine versus a managed vector platform.
</cost_efficiency>

<recommendations>
- P0: Require authentication everywhere and remove the open-access fallback
  - What should change: Remove permissive auth when no API key is configured, add auth to `parse-file`, and bind access decisions more explicitly to deployment mode.
  - Why it matters: Current behavior can expose the service unintentionally.
  - Expected benefit: Immediate reduction in unauthorized access risk.
  - Main trade-off or implementation consideration: Local developer ergonomics become slightly less convenient and should be replaced with an explicit dev-only configuration path.

- P0: Constrain or redesign `fetch-url`
  - What should change: Add destination allow/deny rules, protocol checks, private-network blocking, request size/time limits, and rate limiting.
  - Why it matters: The current design creates a material SSRF and abuse surface.
  - Expected benefit: Lower infrastructure and data-exposure risk.
  - Main trade-off or implementation consideration: Some legitimate arbitrary-URL workflows may need a safer proxy or allowlist model.

- P1: Replace in-memory throttling with a distributed rate limiter
  - What should change: Move rate limiting to Redis or an equivalent managed service and key it by API identity plus user context.
  - Why it matters: Current limits do not hold across instances or restarts.
  - Expected benefit: Predictable abuse control in scaled deployments.
  - Main trade-off or implementation consideration: Adds an external dependency and operating cost.

- P1: Add resilience around external embedding generation
  - What should change: Introduce timeouts, retries with backoff, circuit breaking, and optional asynchronous ingestion for write-heavy flows.
  - Why it matters: Gemini is on the critical path for both ingestion and search.
  - Expected benefit: Better availability and more controlled degradation during provider incidents.
  - Main trade-off or implementation consideration: More state management and possible eventual-consistency behavior.

- P2: Standardize the storage model for production
  - What should change: Treat local JSON as dev-only, define the production data plane explicitly, and align compression/indexing behavior across storage backends.
  - Why it matters: Dual behavior increases operational ambiguity and migration risk.
  - Expected benefit: Cleaner scaling story and simpler governance.
  - Main trade-off or implementation consideration: Reduces flexibility for hobby deployments unless both modes remain clearly separated.

- P2: Add observability and operational controls
  - What should change: Add structured logging, metrics, tracing, health checks for dependencies, and deployment/runbook documentation.
  - Why it matters: The system is difficult to operate safely at scale without visibility.
  - Expected benefit: Faster incident detection and recovery, better capacity planning.
  - Main trade-off or implementation consideration: Additional tooling and instrumentation overhead.

- P3: Revisit retrieval architecture for higher-scale search
  - What should change: Add vector indexing, hybrid retrieval, and possibly a dedicated search service if usage grows.
  - Why it matters: Linear or near-linear similarity search will eventually dominate latency and cost.
  - Expected benefit: Better search quality and scale economics.
  - Main trade-off or implementation consideration: Increases system complexity and may reduce the simplicity that is currently a product advantage.
</recommendations>

<architecture_metrics>
- Performance posture: 2.5/5
- Reliability posture: 2/5
- Security posture: 2/5
- Cost posture: 4/5
- Maintainability posture: 3.5/5
- Future-proofing posture: 2.5/5
- Team capability alignment: 4/5 for a small, product-oriented team; lower for a compliance-heavy or high-scale enterprise environment
</architecture_metrics>

## Assumptions and evidence notes

- This review is based only on repository-visible evidence, especially:
  - `/home/runner/work/memoria/memoria/app/api`
  - `/home/runner/work/memoria/memoria/lib`
  - `/home/runner/work/memoria/memoria/mcp-server.ts`
  - `/home/runner/work/memoria/memoria/README.md`
  - `/home/runner/work/memoria/memoria/docker-compose.yml`
  - `/home/runner/work/memoria/memoria/next.config.ts`
- No production traffic patterns, SLOs, real incident history, or deployment telemetry were available.
- README marketing claims such as compression ratios and scale were treated as product claims, not independently validated performance results.
