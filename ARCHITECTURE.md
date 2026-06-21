# Architecture

This document explains the design of the Search Typeahead system.
All diagrams are inline ASCII so they can be copied straight into a
viva slide deck or re-drawn from memory.

---

## 1 · High-level architecture

```
                       ┌─────────────────┐
       ┌──── debounced ─┤  React frontend │
       │   /suggest     │  (search box,   │
       │   /search      │   trending list)│
       │                └──────┬──────────┘
       │                       │ HTTPS (REACT_APP_BACKEND_URL)
       ▼                       ▼
 ┌──────────────────────────────────────┐
 │  Python FastAPI gateway  (port 8001) │  ← thin proxy
 └────────────────┬─────────────────────┘
                  │ HTTP  127.0.0.1:8002
                  ▼
 ┌──────────────────────────────────────┐
 │      Node.js + Express server        │
 │  ┌─────────┐  ┌────────────────────┐ │
 │  │  Trie   │  │  Trending service  │ │
 │  │ (in-mem)│  │  (decay + blend)   │ │
 │  └────┬────┘  └────────┬───────────┘ │
 │       │                │             │
 │  ┌────▼────────────────▼──────────┐  │
 │  │  Distributed cache cluster    │  │
 │  │  3 LRU+TTL nodes  on  RING    │  │  ← consistent hashing
 │  └────┬──────────────────────────┘  │
 │       │ on /search                  │
 │  ┌────▼──────────────────────────┐  │
 │  │  Batch writer (in-mem buffer) │  │  ← flushes every 2s
 │  └────┬──────────────────────────┘  │
 └───────┼──────────────────────────────┘
         │ bulkWrite
         ▼
 ┌──────────────────────────────────────┐
 │             MongoDB                  │
 │  collection: queries  { query, cnt } │
 └──────────────────────────────────────┘
```

### Why this split?

| Layer            | Responsibility                                                       |
|------------------|----------------------------------------------------------------------|
| FastAPI gateway  | Adapts the supervisor-mandated Python entry point to our Node backend. Pure proxy — no business logic. |
| Node + Express   | All HLD logic: Trie, consistent hashing, cache, batch writer, trending. |
| MongoDB          | The authoritative `query → count` store. Survives restarts.          |
| In-memory Trie   | Hot read path for `/suggest`. Rebuilt from MongoDB on every boot.    |
| Cache cluster    | 3 in-process LRU+TTL "nodes". Routed by consistent hashing so the routing logic is identical to a real distributed cache. |

---

## 2 · Request flow — `/suggest?q=iph`

```
User types "iph"
   │
   ▼  (debounced 150 ms)
GET /api/suggest?q=iph&mode=basic
   │
   ▼
FastAPI gateway forwards to Node
   │
   ▼
Express router → cacheCluster.route("basic:iph")
                              │
                              ▼  consistent hash
                    cache-node-B owns "basic:iph"
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
            HIT (TTL valid)              MISS
                │                           │
                ▼                           ▼
        return cached top-10        Trie.suggest("iph", 10)
                                            │
                                            ▼
                              cacheCluster.set("basic:iph", top10)
                                            │
                                            ▼
                                       return top-10
```

A **basic-mode** hit costs `O(log V) + O(1)` (V = total virtual nodes on the ring).
A **basic-mode** miss costs `O(L + K)` (L = prefix length, K = 10), because every Trie node stores its top-K children list pre-sorted.

**Trending mode** does the same flow but re-ranks the top-K with the trending score (see §5) before returning.

---

## 3 · Cache flow

```
                     ┌────────────────────────────┐
                     │  GET /suggest?q=<prefix>   │
                     └────────────┬───────────────┘
                                  │
                                  ▼
                       cacheKey = mode + ":" + prefix
                                  │
                                  ▼
                      consistentHash.getNode(cacheKey)
                                  │
                          ┌───────┴──────┐
                          ▼              ▼
                     cache-node-A   cache-node-B   cache-node-C
                       (LRU+TTL)     (LRU+TTL)      (LRU+TTL)
                          │              │              │
                          └───────┬──────┘              │
                                  ▼ on miss            …
                              Trie lookup
                                  │
                                  ▼
                              SET cacheKey → top-10
                              (TTL 60s)

Mutations (on /search → batch flush):
   - For every prefix p of the updated query q,
     drop cache[p] on whichever node currently owns p.
```

### Cache key & invalidation rules

- **Key**: `<mode>:<prefix>` → so `basic:iph` and `trending:iph` cannot collide.
- **TTL**: 60s — bounds staleness even without explicit invalidation.
- **Eviction**: per-node LRU capped at 500 entries.
- **Explicit invalidation**: on every batch flush, the system iterates over every prefix of an updated query (`"i", "ip", "iph", "ipho", …`) and deletes that key from its owning node. This guarantees that submitting a search is reflected in the next suggestion request.

---

## 4 · Consistent hashing

```
                ┌── 2^32 ─ ring ──┐
       hash A1 ●                  ● hash C2
           ╲                       ╱
          A2 ●                     ● B1
              ╲                   ╱
               ●  (prefix "iph") ●
              ╱   hashes to here ╲
       hash B2                    ● A3
           ╱                       ╲
           ●  ←── walk clockwise   ● C1
       cache-node-A owns "iph"
```

### Implementation summary (`backend/src/services/consistentHash.js`)

1. We choose **64 virtual positions per physical node** (192 vnodes total for 3 nodes).
2. For each vnode we compute `hash = MD5("<nodeId>#<vIndex>")` and read the first 4 bytes as an unsigned 32-bit integer — that's its position on the ring.
3. The ring is just a **sorted array** of `(hash, nodeId)` tuples.
4. To find the owner of a key, we hash the key the same way and **binary-search** the sorted array for the first slot whose hash ≥ the key's hash. If we fall off the end we wrap to the first slot (the ring is circular).

### Why virtual nodes?

With only 3 real nodes placed naively on the ring, one node would typically end up "owning" 60–70 % of the keyspace because the gaps between hash positions are wildly uneven. Spreading 64 virtual positions per real node smooths the gaps and gives ≈33 / 33 / 33 in practice.

### Why consistent hashing (not `hash % N`)?

If you go from 3 → 4 nodes with `hash % N`, **every key** gets a new owner — the cache empties overnight. With consistent hashing only about **1/N of keys** move on each topology change, so the cache stays warm.

---

## 5 · Trending searches

Trending score blends historical popularity with recent activity:

```
trending(q) = α · normHistorical(q) + β · normRecency(q)

normHistorical(q) = count(q)        / max_count_in_topK
normRecency(q)    = decayedCount(q) / max_decayed_in_topK

decay(t) = exp( -ln(2) · age / halfLife )      ; halfLife = 5 min
α = 0.6      β = 0.4
```

### How "recent" is tracked

- Each query has a single floating "decayed counter" in memory.
- On every `/search` submission for query `q`:
  1. Refresh `q.decayed *= exp(-λ · Δt)` where `Δt` is the time since we last touched the entry.
  2. Then `q.decayed += 1`.

That's the entire data structure. **No per-event list, no fixed window.** Memory stays `O(Q)` even under a billion events.

### Why the blend (and not pure recency)?

- Pure recency would let an obscure query searched 4 times in 30 seconds bury "iphone" with millions of historical searches. That's bad UX.
- Pure popularity is what the basic mode already does; trending mode exists specifically to surface things that became popular *recently*.
- A 60/40 split keeps the long-term hits dominant but lets a fresh surge override a similar-popularity competitor.

### Cache interaction

Because the same prefix produces *different* lists in basic vs trending mode, the cache key is `<mode>:<prefix>`. On every batch flush we invalidate **both** prefixes, so trending lists stay fresh without a separate eviction pipeline.

---

## 6 · Batch writes

```
POST /api/search { q: "iphone" }
   │
   ▼
batch.submit("iphone", +1)         ──►  buffer = Map{ iphone:+1, ... }
                                        trending.record("iphone")
                                        (no DB write yet)

Every 2s  OR  buffer.size >= 500:
   │
   ▼
flush(snapshot)
   │
   ▼
mongo.bulkWrite([
   { updateOne: { filter:{query:'iphone'}, update:{$inc:{count:1}}, upsert:true } },
   ...
])
   │
   ▼
trie.insert(q, delta)              (in-mem index now matches DB)
cache.invalidatePrefixes(q)        (next /suggest forces a re-rank)
```

### Reduction example

If 1 000 users search "iphone" in a 2-second window:

- Without batching → **1 000** individual `updateOne` calls to Mongo.
- With batching   → **1** bulk `updateOne` with `$inc: +1000`.

That's a **1000× write reduction** for a single hot query. Across hundreds of queries the savings stack up, which is the whole point.

### Crash trade-off

If the process crashes between two flush ticks we lose up to ~2 s of count
updates that were sitting in the in-memory `Map`. For a typeahead workload
that under-counting is harmless. For stricter durability we would:

1. Persist the buffer to a write-ahead log (or Kafka topic) before acking the client, **then** flush to Mongo asynchronously, **or**
2. Make the buffer crash-safe with `fsync` on every write.

We deliberately chose the simplest of these because the assignment explicitly asks us to *discuss* the trade-off.

---

## 7 · Scaling strategy (sketch)

- **Read scale**: add more cache nodes → ring re-shuffles ~1/N keys → warm-up cost stays bounded.
- **Compute scale**: stateless Express servers behind a load balancer. Trie can be rebuilt from Mongo on startup. For very large datasets the Trie can be partitioned by first 1–2 characters and sharded across N suggestion servers.
- **Write scale**: shard the primary store on `hash(query)`; batch writer becomes per-shard. Place Kafka in front of the buffer to make it durable + horizontally scalable.
- **Trending scale**: per-server decayed counters are eventually consistent. For globally accurate trending, periodically merge counters via gossip or aggregate them in a stream processor (Flink / Kinesis).

---

## 8 · Time complexity (cheat sheet)

| Operation                | Complexity                                |
|--------------------------|-------------------------------------------|
| `/suggest` cache hit     | `O(log V) + O(1)` (V = total vnodes)      |
| `/suggest` cache miss    | `O(L + K)` (L = prefix length, K = 10)    |
| `/search` submission     | `O(1)` amortised                          |
| Batch flush              | `O(B · L)` (B = batch size)               |
| Cache invalidation       | `O(L · log V)`                            |
| Consistent-hash route    | `O(log V)`                                |
