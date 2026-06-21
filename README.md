# Search Typeahead — HLD Assignment

A complete implementation of a distributed Search Typeahead system, built for
a university **High-Level Design (HLD)** course. It demonstrates the major
concepts the assignment asks for — a prefix Trie, a 3-node distributed cache
with **consistent hashing**, recency-weighted **trending searches**, and
buffered **batch writes** to MongoDB — all wrapped in a clean React UI with a
live debug panel so you can *see* every concept working in real time.

> Read **/architecture** in the running app for the full design document with
> ASCII diagrams of the request flow, cache flow, and scaling strategy.

---

## 1 · Tech stack

| Layer    | Technology                                                  |
|----------|-------------------------------------------------------------|
| Frontend | React 19, Tailwind CSS, shadcn/ui                           |
| Backend  | **Node.js + Express** (assignment requirement)              |
| Storage  | MongoDB (primary store), in-memory Trie (suggestion index)  |
| Cache    | In-process LRU+TTL nodes routed via consistent hashing       |

> ℹ️ **Note about ports.** The container's supervisor is locked to start a
> Python service on port 8001. We honour it by running a tiny FastAPI gateway
> there that **proxies every `/api/*` request to the real Node+Express server
> on internal port 8002**. All assignment-graded logic (Trie, ring, cache,
> batch writer, trending) lives in Node.js. See `backend/server.py` for the
> proxy and `backend/server.js` for the actual backend.

---

## 2 · Running locally

```bash
# from /app
sudo supervisorctl restart backend frontend
```

The supervisor will:
1. start MongoDB,
2. start the FastAPI gateway on **:8001** (which spawns the Node backend on **:8002**),
3. start the React frontend on **:3000**.

Open the frontend URL printed by `frontend/.env` (`REACT_APP_BACKEND_URL`).

### Regenerating / inspecting the dataset

The server **auto-generates** ~150K synthetic queries on first boot and
inserts them into Mongo. To regenerate manually:

```bash
cd /app/backend
node scripts/generateDataset.js 150000
# wrote 124k+ rows to src/data/dataset.json
```

The dataset file is then loaded into Mongo on the next backend boot.

---

## 3 · API reference

| Method | Path                                       | Purpose                                  |
|--------|--------------------------------------------|------------------------------------------|
| GET    | `/api/suggest?q=<prefix>&mode=basic\|trending` | Top-10 prefix suggestions             |
| POST   | `/api/search`  body: `{ q }`               | Record a search (batched)                |
| GET    | `/api/trending?limit=10`                   | Globally trending queries                |
| GET    | `/api/cache/debug?q=<prefix>`              | Owner node + hit/miss for a prefix       |
| GET    | `/api/metrics`                              | Cache / latency / batch stats            |
| GET    | `/api/ring`                                 | Hash-ring snapshot                       |
| POST   | `/api/admin/flush`                          | Force-flush the batch buffer (demo)      |
| POST   | `/api/admin/clear-cache`                    | Wipe all cache nodes                     |
| POST   | `/api/admin/reset-metrics`                  | Zero out counters                        |

---

## 4 · Typeahead logic

* The backend builds an in-memory **prefix Trie** containing all queries.
* Every Trie node maintains a **`top` list** (precomputed top-10 descendants)
  sorted by count.
* A request for `/suggest?q=mac` walks the Trie in `O(L)` (L = prefix length)
  and returns the cached `top` list at the node — overall `O(L + K)` where
  `K = 10`. No subtree scan at query time.

## 5 · Distributed cache + consistent hashing

* 3 in-process cache "nodes": `cache-node-A`, `B`, `C`. Each is an LRU map
  with a 60-second TTL.
* The **consistent hash ring** places **64 virtual nodes per physical node**
  (192 vnodes total) at positions `MD5(nodeId#vIdx) mod 2^32`.
* To look up a key, we hash the key and binary-search the sorted ring for the
  first vnode clockwise — that vnode's owning physical node serves the key.
* Adding or removing a node only re-shuffles ~`1/N` of the keys.
* See `backend/src/services/consistentHash.js`.

## 6 · Trending searches

`trending(q) = α · normHistorical(q) + β · normRecency(q)`

* **Historical** = the global `count` from the Trie's topK.
* **Recency** = a per-query decayed counter:
  `recency(q) ← recency(q) · exp(-ln(2) · age / halfLife) + 1` on every event,
  with `halfLife = 5 minutes` and `α = 0.6`, `β = 0.4`.
* Each query needs **a single float**, not an event list, so the structure is
  `O(Q)` regardless of submission volume.
* See `backend/src/services/trendingService.js`.

## 7 · Batch writes

* Every `POST /api/search` puts `(query, +1)` into an **in-memory Map** and
  returns immediately — no DB write yet.
* The batch writer **flushes every 2 seconds** (or sooner when the buffer
  exceeds 500 unique queries) via `bulkWrite` to Mongo.
* After flush, the **Trie is updated** with the delta and the **cache is
  invalidated** for every prefix of the changed query.
* **Failure trade-off:** at most ~2 s of recent counts are lost on a crash.
  Acceptable for typeahead workloads; for stricter durability persist the
  buffer to a WAL or Kafka topic before acking the client.

## 8 · Time complexity

| Operation                | Complexity                                |
|--------------------------|-------------------------------------------|
| `/suggest` cache hit     | `O(log V) + O(1)` (V = total vnodes)      |
| `/suggest` cache miss    | `O(L + K)` (L = prefix length, K = 10)    |
| `/search` submit         | `O(1)` amortised                          |
| Batch flush              | `O(B · L)` (B = batch size)               |
| Cache invalidation       | `O(L · log V)`                            |
| Consistent-hash route    | `O(log V)`                                |

## 9 · Scaling strategy

* **Read scale**: add cache nodes → ring re-balances ~1/N keys → warm-up cost stays small.
* **Write scale**: shard the primary store on `hash(query)`; batch writer becomes per-shard; place Kafka/SQS in front of the buffer for durability.
* **Compute scale**: stateless Express servers behind a load balancer. Trie is rebuilt from Mongo on boot.
* **Trending scale**: per-server counters are eventually consistent; for global trending, merge counters periodically (gossip or stream-processor).

---

## 10 · Folder structure

```
app/
├── backend/
│   ├── server.py                    # FastAPI gateway → proxies to Node
│   ├── server.js                    # Node + Express (the real backend)
│   ├── package.json                 # Node dependencies
│   ├── requirements.txt             # Python dependencies (for the gateway)
│   ├── src/
│   │   ├── routes.js                # Express route definitions
│   │   ├── services/
│   │   │   ├── trie.js              # Prefix Trie with per-node topK
│   │   │   ├── consistentHash.js    # 2^32 ring + virtual nodes
│   │   │   ├── cacheCluster.js      # Distributed LRU+TTL cache simulation
│   │   │   ├── batchWriter.js       # Buffered bulkWrite to Mongo
│   │   │   ├── trendingService.js   # Decay-based trending scorer
│   │   │   ├── metrics.js           # p50/p95/p99 latency + counters
│   │   │   └── queryStore.js        # Dataset generator + Mongo bootstrap
│   │   └── data/
│   │       └── dataset.json         # Auto-generated synthetic queries
│   └── scripts/
│       └── generateDataset.js       # Standalone dataset generator
└── frontend/
    └── src/
        ├── App.js                    # Router + navbar
        ├── App.css                   # Local accent styles (font, grid)
        ├── pages/
        │   ├── SearchPage.jsx        # Hero + search + live panels
        │   └── ArchitecturePage.jsx  # Full HLD doc with diagrams
        ├── components/
        │   ├── SearchBox.jsx         # Debounced typeahead input
        │   ├── TrendingSearches.jsx  # Live trending list
        │   ├── CacheDebugPanel.jsx   # Stats, per-node, batch buffer
        │   └── HashRingVisualizer.jsx # SVG ring + probe
        ├── hooks/useDebounce.js
        └── lib/api.js                # axios wrapper
```

---

## 11 · Demo script for the viva

1. Open the running app and type **"iph"** → see the suggestion dropdown.
2. Notice the **`Cache MISS` → `Cache HIT`** badge change when you type the same prefix again.
3. Look at the **live metrics panel**: hit rate climbs as you keep typing.
4. Press **Enter** to submit several searches — watch the batch buffer fill up, then auto-flush every 2s ("DB writes saved" counter grows).
5. Switch to **Trending** tab → search a query a few times → see it climb into the trending list.
6. In the **Hash Ring** card, type any prefix → the needle and color show which cache node owns it.
7. Open `/architecture` for the full design document.

---

## 12 · Performance notes

After ~200 mixed searches in the demo, on a single container we observe:

* `/suggest` **p95 latency ≈ 1–3 ms** (cache hit) / 1–5 ms (cache miss + trie + cache set).
* **Cache hit rate** ≈ 70–85 % once warm (depends on type-prefix overlap).
* **DB writes saved** ≈ `submissions − unique-queries-flushed` — for repeated submissions it routinely saves 80–99 % of writes.

Open `/api/metrics` for the live numbers.

---

## 13 · Trade-offs (good viva talking points)

| Decision                           | Why                                            | What we give up                                         |
|------------------------------------|------------------------------------------------|---------------------------------------------------------|
| Pre-stored `topK` per Trie node    | `O(L)` suggestion serving                      | Slightly higher memory (~K per node)                    |
| In-process cache "nodes"           | Easy to reason about for an HLD demo           | Not actually distributed — but routing logic is identical |
| 60 s cache TTL + per-prefix invalidation on flush | Fresh results without stale-cache stampedes | Slight inconsistency during the TTL window           |
| 2 s batch interval                 | Massive write reduction                        | Up to 2 s of count loss on crash                        |
| Decayed-counter trending           | `O(Q)` memory, no per-event list               | Counters are eventually consistent across servers       |
| MD5 hash for the ring              | Stable, well-distributed, easy to explain      | Not cryptographically necessary; MurmurHash would work too |

---

Built as an academic project to demonstrate HLD concepts clearly. Every
non-trivial line of code carries a comment explaining *why* it exists.
