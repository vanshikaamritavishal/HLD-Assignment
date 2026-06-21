# Submission Checklist

Every requirement from the assignment PDF mapped to where it lives in
the code, plus a one-line "how to demonstrate" recipe for the viva.

## A · Functional requirements

| # | Requirement (from PDF)                                                    | Implemented | File location                                          | How to demonstrate                                                                                       |
|---|---------------------------------------------------------------------------|-------------|--------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| F1 | Show up to **10 suggestions** that match the typed prefix                 | ✅          | `backend/src/services/trie.js` (`suggest()`) + `backend/src/routes.js` (`GET /api/suggest`) | Type `iph` in the UI; observe ≤ 10 items in the dropdown.                                                |
| F2 | Suggestions sorted by **search count** desc                                | ✅          | `backend/src/services/trie.js` (`bumpTop()`)            | `curl "$API/api/suggest?q=mac"` — counts are non-increasing.                                              |
| F3 | UI **search box** + dropdown                                              | ✅          | `frontend/src/components/SearchBox.jsx`                | Visit the home page.                                                                                      |
| F4 | UI uses **debouncing** to avoid one call per keystroke                    | ✅          | `frontend/src/hooks/useDebounce.js` (150 ms)            | Type fast in the search box; observe a single network call after you stop.                                |
| F5 | **`POST /search`** dummy API returning `{"message":"Searched"}`            | ✅          | `backend/src/routes.js` (`POST /api/search`)            | `curl -X POST $API/api/search -d '{"q":"x"}' -H 'Content-Type: application/json'`                          |
| F6 | New query inserted with count 1; existing query **incremented**           | ✅          | `backend/src/services/batchWriter.js` (`onFlush` builds `$inc` upsert) | Submit a new query → wait 2 s → `curl "$API/api/suggest?q=<prefix>"` shows it with count 1.                |
| F7 | **Dataset ≥ 100 000 unique queries**                                       | ✅ (150 000) | `backend/src/services/queryStore.js` (`generateSyntheticDataset`) | `curl "$API/api/metrics" | jq '.trie.keys'` → `150000`.                                                  |
| F8 | Cache layer is **distributed**                                            | ✅          | `backend/src/services/cacheCluster.js` (3 LRU+TTL nodes) | `curl "$API/api/ring" | jq '.nodes'` → `["cache-node-A","cache-node-B","cache-node-C"]`.                  |
| F9 | **Consistent hashing** decides which cache node owns a prefix             | ✅          | `backend/src/services/consistentHash.js`                | `curl "$API/api/cache/debug?q=java" | jq '.ownerNode'` — same value every time, proving routing stability. |
| F10 | **Trending searches** support                                             | ✅          | `backend/src/services/trendingService.js` + `GET /api/trending` | Submit a query 3 × → `curl "$API/api/trending"` shows it.                                                |
| F11 | Trending blends **count + recency**                                       | ✅          | `trendingService.rerank()` + `routes.js` (`mode=trending`) | `curl "$API/api/suggest?q=trending&mode=trending" | jq '.suggestions[0]'` has a `score` field.            |
| F12 | **Batch writes** for count updates                                        | ✅          | `backend/src/services/batchWriter.js`                   | See Testing Guide §7 — `writesSaved ≥ 45` for 50 events on 5 queries.                                     |

## B · API contract

| API (from PDF)                                | Implemented | Endpoint                                | File                                |
|------------------------------------------------|-------------|-----------------------------------------|-------------------------------------|
| `GET /suggest?q=<prefix>`                      | ✅          | `GET /api/suggest`                       | `backend/src/routes.js`             |
| `POST /search`                                 | ✅          | `POST /api/search`                       | `backend/src/routes.js`             |
| `GET /cache/debug?q=<prefix>`                  | ✅          | `GET /api/cache/debug`                   | `backend/src/routes.js`             |
| *(bonus)* `GET /trending`                      | ✅          | `GET /api/trending`                      | `backend/src/routes.js`             |
| *(bonus)* `GET /metrics`                       | ✅          | `GET /api/metrics`                       | `backend/src/routes.js`             |
| *(bonus)* `GET /ring`                          | ✅          | `GET /api/ring`                          | `backend/src/routes.js`             |
| *(bonus)* `POST /admin/{flush,clear-cache,reset-metrics}` | ✅ | `POST /api/admin/...`                   | `backend/src/routes.js`             |

## C · Non-functional requirements

| # | Requirement                                                | Where it's covered                                                                       |
|---|------------------------------------------------------------|------------------------------------------------------------------------------------------|
| N1 | Easy to run locally (one command)                          | `sudo supervisorctl restart backend frontend` — see **README §3**.                       |
| N2 | Suggestions API optimised for low latency (report p95)     | `GET /api/metrics` returns `latency.p95LatencyMs`. Trie pre-stores topK so reads are O(L+K). |
| N3 | Report cache hit rate, DB read/write counts                | `/api/metrics → cache.hitRate, batch.writesIssued, batch.writesSaved`.                   |
| N4 | Modular, readable, documented code                         | Each service file is < 150 lines with a block comment explaining purpose + trade-offs.   |
| N5 | Logs / explanation of consistent-hashing behaviour          | `ARCHITECTURE.md §4` plus `GET /api/cache/debug` (live), and `GET /api/ring` (snapshot). |

## D · Expected submission artefacts

| Item (PDF §12)                                  | Where it lives                                                |
|--------------------------------------------------|----------------------------------------------------------------|
| GitHub repo / source                             | This entire `/app` directory.                                  |
| README with **setup instructions**               | `README.md`                                                    |
| **Dataset source + loading instructions**        | `README.md §3` and `backend/scripts/generateDataset.js`        |
| **Architecture diagram / explanation**           | `ARCHITECTURE.md`                                              |
| **API documentation**                            | `ARCHITECTURE.md §"API reference"` table + `SUBMISSION_CHECKLIST.md §B` |
| **Screenshots or demo video**                    | Take from the running app — see Testing Guide.                 |
| **Performance report** (latency, cache hit rate, write reduction) | `PROJECT_REPORT.md §5.2`                                       |
| **Explanation of design choices and trade-offs** | `PROJECT_REPORT.md §3` and "Crash trade-off" section in `ARCHITECTURE.md §6` |

## E · Grading rubric mapping

| Component             | Marks | Where it is implemented                                                            | Where it is explained                                          |
|-----------------------|-------|------------------------------------------------------------------------------------|----------------------------------------------------------------|
| Basic Implementation  | **60** | `trie.js`, `cacheCluster.js`, `consistentHash.js`, `routes.js`, `queryStore.js`     | `ARCHITECTURE.md §1–4`, `PROJECT_REPORT.md §4`                  |
| Trending Searches     | **20** | `trendingService.js`, `routes.js` (`mode=trending`), `frontend/.../SearchBox.jsx`   | `ARCHITECTURE.md §5`, `PROJECT_REPORT.md §3 (decay rationale)`  |
| Batch Writes          | **20** | `batchWriter.js`, `routes.js` (`POST /api/search`)                                  | `ARCHITECTURE.md §6`, `PROJECT_REPORT.md §3 (crash trade-off)`  |

## F · One-glance summary

| Requirement                                | Implemented | File Location                                                | How To Demonstrate                                                  |
|--------------------------------------------|-------------|--------------------------------------------------------------|---------------------------------------------------------------------|
| Typeahead top-10 by count                  | ✅          | `backend/src/services/trie.js` + `routes.js`                  | Type `iph` in UI                                                    |
| ≥ 100 000 query dataset                    | ✅          | `backend/src/services/queryStore.js`                          | `curl /api/metrics`  → `trie.keys = 150000`                          |
| POST /search updates count                 | ✅          | `routes.js` + `batchWriter.js`                                | submit a new query → wait 2 s → `/suggest` shows it                  |
| Distributed cache                          | ✅          | `backend/src/services/cacheCluster.js`                        | `curl /api/ring`                                                    |
| Consistent hashing                         | ✅          | `backend/src/services/consistentHash.js`                      | `curl /api/cache/debug?q=java`                                      |
| Cache hit / miss visibility                | ✅          | `cacheCluster.js` + `routes.js`                               | Call `/suggest` twice; first MISS, second HIT                       |
| Trending (count + recency)                 | ✅          | `backend/src/services/trendingService.js`                     | UI tab "Trending"; `/api/suggest?...&mode=trending`                  |
| Batch writes (write-reduction)             | ✅          | `backend/src/services/batchWriter.js`                         | Testing Guide §7 — `writesSaved ≥ 45`                                |
| Search analytics counters                  | ✅          | `frontend/src/components/SearchAnalytics.jsx` + `/api/metrics` | Bottom of UI shows hits / misses / writes saved                     |
| Setup README                               | ✅          | `README.md`                                                    | Open the file                                                      |
| Architecture document                      | ✅          | `ARCHITECTURE.md`                                              | Open the file                                                      |
| Project report                             | ✅          | `PROJECT_REPORT.md`                                            | Open the file                                                      |
| Testing guide                              | ✅          | `TESTING_GUIDE.md`                                             | Open the file                                                      |
| Submission mapping                         | ✅          | `SUBMISSION_CHECKLIST.md` (this file)                          | Open the file                                                      |
