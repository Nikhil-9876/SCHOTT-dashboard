# Agent Instructions — SCHOTT Dashboard

This project uses [Graphify](https://github.com/Graphify-Labs/graphify) to maintain a
queryable AST knowledge graph of the entire codebase. The files below are always kept
fresh (updated automatically on every commit via git hooks):

```
graphify-out/
├── GRAPH_REPORT.md   ← architecture communities, god nodes, surprising connections
└── graph.json        ← full traversable dependency graph (389 nodes, 684 edges)
```

---

## Mandatory Protocol (enforce before every feature or refactor)

### 1. Inspect before you navigate
> **Before navigating raw source files or planning any feature or refactor, read
> `graphify-out/GRAPH_REPORT.md` to identify module boundaries, God nodes, and
> detected community clusters.**

Use it to understand which subsystems are involved before touching any code.

### 2. Trace blast radius before changing shared interfaces
> **Before altering any exported function, hook, type, or shared utility, trace all
> downstream consumers using:**
> ```
> graphify explain <symbol>
> graphify path <source-module> <target-module>
> graphify query '<plain language question about dependencies>'
> ```
> Verify the full blast radius — every file that imports or calls the changed symbol —
> before making cross-file changes.

### 3. Respect community boundaries
> **Do not touch files outside the targeted module community (as identified in
> `GRAPH_REPORT.md`) without an explicit confirmation and a migration plan.**
> Never break interfaces connecting detected graph communities without documenting
> the migration path first.

---

## Quick CLI Reference

| Command | Purpose |
|---|---|
| `graphify explain <symbol>` | Show all connections for a function / type / component |
| `graphify path <A> <B>` | Trace the shortest path between two modules |
| `graphify query '<question>'` | Ask a plain-language question against the graph |
| `graphify . --code-only` | Rebuild the graph locally (no API key required) |
| `npm run graph:update` (from `app/`) | Same as above, via npm script |

---

## Architecture Snapshot (auto-generated 2026-09-24)

**God Nodes** (highest connectivity — touch these last):
1. `TOFUPage()` — 21 edges (Top-of-Funnel page, hub of chart + formatter imports)
2. `BOFUPage()` — 19 edges (Bottom-of-Funnel, heavy queries consumer)
3. `MOFUPage()` — 18 edges (Mid-Funnel, mirrors TOFU/BOFU patterns)
4. `formatEURCompact()` — 12 edges (shared across all 5 pages + Dashboard)
5. `useIngestionLog()` — 12 edges (data freshness hook consumed everywhere)

**Key Communities** (detected module clusters):
- **TOFUPage community** — UI components, chart containers, badge/asset UI primitives
- **queries.ts community** — all Supabase data hooks, ingestion triggers, QUERY_KEYS
- **App.tsx community** — routing, layout, NavBar, SafetyContext, Footer
- **DemographicsPage community** — chart configs, BarChart, ScatterChart, fetch logic
- **ingest-linkedin-data community** — Edge Function constants, pivot maps, CORS headers

**No import cycles detected.**
