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
- **Backend**  — Node.js + Express
- **Storage**  — MongoDB
- **Cache**    — In-memory cache nodes (LRU + TTL), routed via consistent hashing

---

## 3 · Setup on a fresh machine

### 3.1 Prerequisites

Install these once on the host:

| Tool      | Version       | Where to get it                                |
|-----------|---------------|------------------------------------------------|
| Node.js   | 18 or 20      | <https://nodejs.org/en/download>               |
| Yarn      | 1.22+         | `npm i -g yarn`  (after Node is installed)     |
| MongoDB   | 6.x or 7.x    | <https://www.mongodb.com/try/download/community> |

Verify:
```bash
node -v        # v18 or v20
yarn -v        # 1.22.x
mongod --version
```

### 3.2 Start MongoDB

If you installed MongoDB as a service it's already running on the default port `27017`. Otherwise start it manually:

```bash
# Linux / macOS — start mongod in the foreground
mongod --dbpath /tmp/mongo-data --bind_ip 127.0.0.1
```

Quick sanity check (in another terminal):

```bash
mongosh --eval 'db.runCommand({ping:1})'
# → { ok: 1 }
```

### 3.3 Clone the project

```bash
git clone <repository-url> search-typeahead
cd search-typeahead
```

### 3.4 Backend — install and run

```bash
cd backend
cp .env.example .env          # adjust MONGO_URL / PORT if you want
yarn install                  # install Node dependencies
node server.js                # starts the Express server
```

On the very first boot you'll see:

```
[dataset] generating synthetic dataset (~150k queries)...
[dataset] wrote 150000 rows to src/data/dataset.json
[dataset] inserting 150000 rows into Mongo...
[boot] dataset ready: 150000 unique queries
[boot] trie built (150000 keys)
[ready] Express listening on 127.0.0.1:8001
```

This generation step takes about 10–15 seconds and only runs once — subsequent boots reuse the data in MongoDB.

Leave this terminal running. Keep it open for the rest of the steps.

### 3.5 Frontend — install and run

In a **second terminal**:

```bash
cd frontend
cp .env.example .env          # REACT_APP_BACKEND_URL=http://localhost:8001
yarn install
yarn start
```

The dev server prints `Compiled successfully` and opens
<http://localhost:3000> in your browser. Type a prefix in the search box —
you should see top-10 suggestions appear immediately.

### 3.6 Quick health check

```bash
curl -s http://localhost:8001/api/health
# → {"ok":true,"ts":...}

curl -s "http://localhost:8001/api/suggest?q=iph" | head -c 200
# → {"suggestions":[{"query":"iphone ...","count":...}, ...]}
```

If both calls return data, the system is fully working.

---

## 4 · How to run (TL;DR)

After the one-time install in §3:

```bash
# terminal 1
mongod --dbpath /tmp/mongo-data --bind_ip 127.0.0.1   # if not already running

# terminal 2
cd backend && node server.js

# terminal 3
cd frontend && yarn start
```

Open <http://localhost:3000>.

---

## 5 · About `server.py`

You'll notice a `backend/server.py` file alongside `server.js`. It is **not** part of the HLD design — it's a thin FastAPI proxy that exists only because the **online preview container** this project was built in has its supervisor locked to a Python entry point. The proxy forwards every `/api/*` request to the Node server.

**On a normal machine you can ignore `server.py` completely** and run `node server.js` directly, as shown above. Everything that matters for grading (Trie, consistent hashing, cache cluster, batch writer, trending) lives entirely in Node.

---

## 6 · Regenerating the dataset

The Node server generates `backend/src/data/dataset.json` on first boot. To regenerate it manually:

```bash
cd backend
node scripts/generateDataset.js 150000
```

Then either drop the Mongo collection so the next backend boot re-loads from the JSON:

```bash
mongosh typeahead --eval 'db.queries.deleteMany({})'
```

or change `DB_NAME` in `.env` to a fresh name.

---

## 7 · Folder structure

```
search-typeahead/
├── README.md                  # this file
├── ARCHITECTURE.md            # diagrams + design explanation
├── PROJECT_REPORT.md          # full report (problem, design, results)
├── PROJECT_REPORT.pdf         # printable submission report
│
├── backend/
│   ├── server.js              # Node + Express (the actual backend)
│   ├── server.py              # Sandbox-only proxy — IGNORE on a normal machine
│   ├── package.json
│   ├── .env.example
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
    ├── package.json
    ├── .env.example
    └── src/
        ├── App.js
        ├── pages/SearchPage.jsx         # Only user-facing page
        ├── components/
        │   ├── SearchBox.jsx            # Debounced typeahead input
        │   ├── TrendingSearches.jsx     # Live trending list
        │   └── SearchAnalytics.jsx      # 3 small counters
        ├── hooks/useDebounce.js
        └── lib/api.js                   # axios wrapper
```

---

## 8 · API at a glance

| Method | Endpoint                                       | Purpose                                |
|--------|------------------------------------------------|-----------------------------------------|
| GET    | `/api/suggest?q=<prefix>&mode=basic\|trending` | Top-10 prefix suggestions               |
| POST   | `/api/search`  body: `{ q }`                   | Record a search (batched to Mongo)      |
| GET    | `/api/trending?limit=10`                       | Globally trending queries               |
| GET    | `/api/cache/debug?q=<prefix>`                  | Owner node + hit/miss for a prefix      |
| GET    | `/api/metrics`                                  | Cache / latency / batch stats           |

Full request/response details are in `PROJECT_REPORT.pdf` §4 (API Documentation).

---

## 9 · Where the architecture lives

This README intentionally stays focused on getting the project running. The
full design is in:

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — diagrams (system, request, cache, batch), CH explanation, scaling notes
- **[PROJECT_REPORT.md](./PROJECT_REPORT.md)** — problem statement, requirements, design decisions, implementation, results
- **[PROJECT_REPORT.pdf](./PROJECT_REPORT.pdf)** — the printable submission report (16 pages, all the above + screenshots)

---

## 10 · Troubleshooting

| Symptom                                              | Likely cause / fix                                                                  |
|-------------------------------------------------------|--------------------------------------------------------------------------------------|
| `MongoServerSelectionError` on backend startup        | MongoDB isn't running. Start `mongod` and recheck with `mongosh`.                    |
| Frontend opens but no suggestions ever appear         | `REACT_APP_BACKEND_URL` in `frontend/.env` doesn't match the backend's host/port.    |
| First boot hangs at "generating synthetic dataset…"   | Normal — wait 10–15 s. The progress is printed line by line.                          |
| Port 8001 already in use                              | Change `PORT` in `backend/.env` **and** `REACT_APP_BACKEND_URL` in `frontend/.env`.   |
| `yarn install` fails with peer-dependency errors      | Use Node 18 or 20 (not 16, not 22).                                                  |
