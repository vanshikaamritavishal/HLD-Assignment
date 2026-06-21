# Search Typeahead — HLD Assignment

A working **Search Typeahead** system built for the High-Level Design (HLD) course assignment. It returns the top-10 popularity-ranked suggestions for any prefix from a dataset of **150,000+ unique queries**, supports trending searches (count + recency), a distributed cache routed via **consistent hashing**, and **batch writes** to the primary store.

## 1 · Features

| Area              | Feature                                                            |
|-------------------|--------------------------------------------------------------------|
| Typeahead         | Top-10 suggestions per prefix, sorted by overall search count       |
| Trending          | Combined ranking using historical count + recency (time-decay)      |
| Storage           | MongoDB primary store + in-memory Trie for the suggestion index     |
| Cache             | 3-node in-process distributed cache simulation (LRU + 60s TTL)      |
| Routing           | Consistent hashing with 64 virtual nodes per physical node          |
| Writes            | Batched submissions flushed to Mongo every 2s (or 500 unique items) |
| Analytics         | Tracks searches submitted, cache hits/misses, DB writes saved       |
| UI                | React + Tailwind; search box, suggestion dropdown, trending list    |

## 2 · Tech stack

- **Frontend** — React 19, Tailwind, shadcn/ui
- **Backend**  — Node.js + Express *(the actual implementation)*
- **Storage**  — MongoDB
- **Cache**    — In-memory cache nodes (LRU + TTL), routed via consistent hashing

> ℹ️ The supervisor in this container is locked to start a Python process
> on port 8001. We honour that by running a thin **FastAPI gateway** on
> 8001 that simply forwards every `/api/*` request to the real
> **Node + Express** server running on the internal port 8002. All the HLD
> logic is in Node — the Python file is a 90-line proxy.

## 3 · Setup instructions

The container already has Node 20, Python 3.11, MongoDB and Yarn pre-installed. Bootstrap dependencies are installed automatically by the supervisor; the only command you ever need is a restart:

```bash
# from /app
sudo supervisorctl restart backend frontend
```

That starts (in order):

1. MongoDB on the default port,
2. the FastAPI gateway on **:8001**, which spawns…
3. the Node + Express backend on **:8002**, which on first boot…
4. generates a **synthetic dataset of ~150,000 queries** and bulk-inserts them into Mongo (this takes ~10–15 s the very first time),
5. the React frontend on **:3000**.

Open the URL set in `frontend/.env` as `REACT_APP_BACKEND_URL`.

### Regenerating the dataset manually

```bash
cd /app/backend
node scripts/generateDataset.js 150000          # → src/data/dataset.json
```

The next backend boot will load that file into Mongo if the collection is empty.

## 4 · How to run (TL;DR)

```bash
sudo supervisorctl restart backend frontend
# wait ~15s on first boot, then visit the frontend URL
```

Then:

1. Type a prefix in the search box — see the **top-10 suggestions** drop down.
2. Switch the tab from **Basic** to **Trending** to see the count + recency ranking.
3. Press **Enter** to submit a search — observe the count update in the **Trending Now** list and the analytics counters at the bottom.

## 5 · Folder structure

```
/app/
├── README.md                  # this file
├── ARCHITECTURE.md            # diagrams + design explanation
├── PROJECT_REPORT.md          # full report (problem, design, results)
├── TESTING_GUIDE.md           # how to test each feature
├── SUBMISSION_CHECKLIST.md    # assignment requirement → code mapping
│
├── backend/
│   ├── server.py              # FastAPI gateway (proxies /api/* → Node)
│   ├── server.js              # Node + Express bootstrap
│   ├── package.json
│   ├── requirements.txt       # Python deps (gateway only)
│   ├── src/
│   │   ├── routes.js          # All /api endpoints
│   │   ├── services/
│   │   │   ├── trie.js                 # Prefix Trie + per-node topK
│   │   │   ├── consistentHash.js       # 2^32 ring + virtual nodes
│   │   │   ├── cacheCluster.js         # 3-node LRU+TTL cache simulation
│   │   │   ├── batchWriter.js          # Buffer + periodic bulkWrite
│   │   │   ├── trendingService.js      # Exp-decay recency scorer
│   │   │   ├── metrics.js              # Hit-rate + latency counters
│   │   │   └── queryStore.js           # Synthetic dataset + Mongo bootstrap
│   │   └── data/dataset.json           # Generated on first run
│   └── scripts/generateDataset.js      # Standalone generator
│
└── frontend/
    └── src/
        ├── App.js
        ├── pages/SearchPage.jsx         # Only user-facing page
        ├── components/
        │   ├── SearchBox.jsx            # Debounced typeahead input
        │   ├── TrendingSearches.jsx     # Live trending list
        │   └── SearchAnalytics.jsx      # 3 small counters (cache, batch)
        ├── hooks/useDebounce.js
        └── lib/api.js                   # axios wrapper
```

## 6 · Where the architecture lives

This README intentionally stays short. The full system design is in:

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — diagrams (system, request, cache), data flow, scaling strategy
- **[PROJECT_REPORT.md](./PROJECT_REPORT.md)** — problem statement, requirements, design decisions, implementation details, results
- **[TESTING_GUIDE.md](./TESTING_GUIDE.md)** — how to test each feature manually
- **[SUBMISSION_CHECKLIST.md](./SUBMISSION_CHECKLIST.md)** — every assignment requirement mapped to the implementation
