# PRD — Search Typeahead (HLD Assignment)

## Original problem statement
University HLD assignment: Build a Search Typeahead system. Requirements:
- React frontend + Node.js + Express backend
- Typeahead (top-10 suggestions, popularity-ranked, ≥100k unique queries)
- Distributed cache with consistent hashing
- Trending searches (count + recency)
- Batch writes for search-count updates
- Modular, well-commented code; full HLD documentation
- Grading: 60 basic / 20 trending / 20 batch writes

## Architecture
- React 19 + shadcn/ui frontend (search box, trending list, cache debug panel, hash ring viz, architecture doc page)
- FastAPI gateway on :8001 (supervisor-locked) → proxies /api/* to internal Node Express on :8002
- Node services: Trie, ConsistentHashRing (64 vnodes × 3 nodes), CacheCluster (LRU+TTL), BatchWriter, TrendingService (exp decay halfLife=5min), Metrics
- MongoDB primary store; queryStore.js auto-generates ~150k synthetic queries on first boot

## What's implemented (Feb 2026)
- [x] Synthetic dataset generator (~124k–150k queries, Zipf-ish counts)
- [x] In-memory Trie with per-node topK (O(L+K) suggest)
- [x] 3-node distributed cache simulation + consistent-hash ring routing
- [x] Cache hit/miss reporting, TTL, LRU eviction, per-node stats
- [x] Batch writer: in-memory aggregate Map, 2s/500-item flush, bulkWrite, prefix invalidation, retry-on-fail
- [x] Trending: per-query decayed counter, blend with historical count, rerank
- [x] /api/suggest, /search, /trending, /cache/debug, /metrics, /ring, /admin/{flush,clear-cache,reset-metrics}
- [x] Frontend: debounced search box, suggestion dropdown, mode tabs, live metrics panel, hash-ring SVG, full architecture page with ASCII diagrams
- [x] README with setup, API docs, complexity table, scaling strategy, demo script

## User personas
- University student presenting to professor in viva (primary)
- Professor / evaluator checking the rubric items

## Backlog (P1/P2)
- P1: Add keyboard navigation hints in the UI (mostly there)
- P2: Server-Sent Events for live trending/metrics (currently polled every 1.5–3s)
- P2: Persist batch buffer to disk WAL for crash safety
- P2: Graph of latency p50/p95 over time
- P2: Real distributed cache (Redis cluster) instead of in-process simulation

## Next tasks
- Run testing_agent_v3 for backend + frontend end-to-end verification
- Capture screenshots for the submission report
