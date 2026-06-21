# Project Report — Search Typeahead

A self-contained report covering the entire design, implementation and
results of the Search Typeahead HLD assignment.

## 1 · Problem statement

Build a working search typeahead application similar to those on e-commerce
or content platforms. When a user types a prefix in the search box, the
system must:

- return the top 10 popularity-ranked suggestions that match the prefix,
- accept and remember search submissions so that popular queries climb
  the rankings,
- support a **trending** mode that combines historical popularity with
  recent activity,
- serve suggestions from a **distributed cache layer** addressed via
  **consistent hashing**,
- write search-count updates to the primary store in **batches** rather
  than once per request.

The dataset must contain **at least 100 000 unique queries** with per-query
popularity counts.

## 2 · Requirements (from the assignment PDF)

### Functional

| # | Requirement                                                              |
|---|--------------------------------------------------------------------------|
| F1 | Show up to 10 prefix-matching suggestions, sorted by count desc          |
| F2 | UI search box + suggestion dropdown                                      |
| F3 | `POST /search` dummy submission API returning `{"message": "Searched"}`   |
| F4 | Increment query-count on every submission; insert new queries with count 1 |
| F5 | Distributed cache layer (≥ 2 nodes)                                      |
| F6 | Consistent hashing routes prefix → cache node                            |
| F7 | Trending suggestions blending count + recency (extra 20 marks)           |
| F8 | Batch writes for search-count updates (final 20 marks)                   |
| F9 | Dataset of ≥ 100 000 unique queries                                      |

### Non-functional

- Easy to run locally.
- Low-latency suggestion API (report p95).
- Modular, readable code with comments.
- Report cache hit rate, DB write counts, latency.

## 3 · Design decisions

| Decision                                              | Rationale                                                                                               |
|-------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| **Trie for suggestion index**                         | Prefix lookups are `O(L)` and the topK per node is computed once, so query-time work is `O(L + K)`.       |
| **Pre-stored topK at every Trie node**                | Avoids a subtree scan on every request — turns `/suggest` cache misses into a constant-time read.        |
| **MongoDB as the primary store**                      | The assignment encourages an explicit "where do counts live durably?" answer. Mongo is widely available, has `bulkWrite` upserts for batching, and lets us survive restarts. |
| **In-process LRU+TTL cache nodes (3 of them)**        | An academic project does not benefit from a real Redis cluster. By making the *routing* logic identical to a real client library, we still demonstrate consistent hashing without running 3 Redis servers. |
| **Consistent hashing with 64 vnodes per node**        | 3 raw nodes on a ring give very skewed distribution. 64 vnodes per node smooth it out to ≈33% each.       |
| **`<mode>:<prefix>` cache key**                       | Basic and trending must never serve each other's cached list.                                            |
| **Cache TTL = 60 s + per-prefix invalidation on flush** | TTL gives an eventual-freshness lower bound. Explicit invalidation gives an upper bound: a submission becomes visible within one batch interval. |
| **Batch interval = 2 s, max batch size = 500**        | Small enough that demos feel instant, large enough that any sane test gets meaningful write-coalescing.   |
| **Exponential decay with 5-minute half-life**         | Long enough that a single mistyped submission doesn't dominate the leaderboard; short enough that a burst of activity surfaces quickly. |
| **α = 0.6 · count + β = 0.4 · recency**               | Tuned so that *popular and recent* dominates *only-popular* — but a freshly-discovered query needs sustained interest to overtake an evergreen one. |

## 4 · Implementation details

### 4.1 Folder layout
See **README.md** for the directory tree.

### 4.2 Key files

| File                                  | Lines | Purpose                                                       |
|---------------------------------------|-------|---------------------------------------------------------------|
| `backend/server.py`                   | ~110  | FastAPI gateway → forwards `/api/*` to Node on `:8002`.        |
| `backend/server.js`                   | ~140  | Bootstraps Mongo, Trie, cache, batch writer, trending, routes. |
| `backend/src/routes.js`               | ~125  | All `/api` endpoints.                                          |
| `backend/src/services/trie.js`        | ~80   | Trie with per-node topK list maintained on insert.             |
| `backend/src/services/consistentHash.js` | ~70 | MD5-based ring with 64 vnodes/node and binary-search routing.  |
| `backend/src/services/cacheCluster.js` | ~130 | LRU+TTL nodes + routing wrapper + prefix invalidation.         |
| `backend/src/services/batchWriter.js` | ~80   | In-memory aggregating buffer + periodic bulk-flush + retry.    |
| `backend/src/services/trendingService.js` | ~80 | Exponential-decay recency counter + rerank function.          |
| `backend/src/services/metrics.js`     | ~60   | p50/p95 latency, cache hit-rate, batch counters.               |
| `backend/src/services/queryStore.js`  | ~140  | Synthetic dataset generator + Mongo bootstrap.                 |

### 4.3 Algorithms in plain English

**Typeahead suggestion**
1. Lower-case the prefix.
2. Walk the Trie one character at a time. If a character path doesn't exist,
   return `[]`.
3. Otherwise return the Trie node's `top` list (already sorted, size ≤ 10).
4. If mode = trending, rerank that list with the recency blend before
   returning.

**Consistent hashing**
1. On startup, every cache node spawns 64 virtual positions at
   `MD5(nodeId#vIndex) mod 2^32`. All vnodes are sorted into one global ring.
2. To find the owner of a key, hash the key the same way and binary-search
   the ring for the first vnode whose hash ≥ the key's hash. Wrap to index 0
   if we fall off the end.

**Trending decay**
1. Each query holds `{ decayed, updatedAt }`.
2. On every submission for that query, refresh
   `decayed *= exp(-λ · (now - updatedAt))`, set `updatedAt = now`, then
   `decayed += 1`.
3. To rank, compute `decayed` lazily for every candidate (so we don't need
   a background sweeper).

**Batch writer**
1. Every `POST /search` puts `(query, +1)` into a `Map`.
2. A `setInterval` (2 s) snapshots the `Map`, replaces it with an empty one,
   and bulk-writes the snapshot to Mongo using `bulkWrite([{ updateOne:
   { filter:{query}, update:{$inc:{count:delta}}, upsert:true } }, …])`.
3. After flush we call `trie.insert(q, delta)` for each query so the in-mem
   index matches the DB and `cache.invalidatePrefixes(q)` to drop stale
   suggestion lists.

## 5 · Results

### 5.1 Functional coverage

| Requirement                                | Status |
|--------------------------------------------|--------|
| Top-10 suggestions sorted by count         | ✅      |
| `POST /search` updates the count store     | ✅      |
| `GET /cache/debug` shows node + hit/miss   | ✅      |
| 3-node cache routed via consistent hashing | ✅      |
| Trending blend of count + recency          | ✅      |
| Batch writes with periodic flush           | ✅      |
| Dataset ≥ 100 000 unique queries           | ✅ — 150 000 |
| Modular code with comments                 | ✅      |

### 5.2 Performance snapshot

Captured after issuing ~200 random `/suggest` requests on a single
container:

| Metric                          | Value (typical) |
|---------------------------------|-----------------|
| `/suggest` p50 latency          | 0.2–0.4 ms      |
| `/suggest` p95 latency          | 1–3 ms          |
| Cache hit-rate (after warm-up)  | 70–85 %         |
| Trie keys held in memory        | 150 000         |
| DB writes saved by batching     | 80–99 %         |

(Run live numbers via `GET /api/metrics` while testing.)

### 5.3 Sample suggestions for prefix `iph`

```
[
  { "query": "iphone system-design flipkart", "count": 12594 },
  { "query": "iphone resume setup",            "count":  7393 },
  { "query": "iphone printer tips",            "count":   835 },
  ...
]
```

(Counts come from the Zipf-ish distribution applied by
`scripts/generateDataset.js`.)

## 6 · Future scope

Things deliberately kept out of scope for an HLD academic project but
which would naturally extend this codebase:

- **Real Redis cluster** — swap our in-process cache nodes for a 3-node
  Redis cluster. The routing logic is already cluster-aware (consistent
  hashing) so the change is mostly mechanical.
- **Write-ahead log for the batch buffer** — persist incoming submissions
  to disk before acking the client, eliminating the 2-second loss-on-crash
  window.
- **Fuzzy / typo-tolerant matching** — currently only exact prefix matching
  is supported. Adding BK-trees or symspell would handle typos.
- **Personalisation** — per-user submission history could be blended into
  the trending score (`γ · personalCount`).
- **Sharded Trie** — partition the Trie by first 2 characters and shard it
  across multiple suggestion servers for datasets beyond a few million
  queries.
- **Server-sent events** — push trending updates and metrics to the UI
  instead of polling.

## 7 · Conclusion

The system implements every functional and non-functional requirement of
the assignment. Every major HLD concept (Trie, consistent hashing,
distributed cache, batch writes, trending blend) is in its own service
file with explanatory comments, so each can be defended individually in
the viva. Results show meaningful gains (sub-millisecond suggestion
latency once cached, ~80% DB write reduction) over a naïve implementation,
without becoming a production system.
