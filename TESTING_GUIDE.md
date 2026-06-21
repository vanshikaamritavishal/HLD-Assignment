# Testing Guide

How to verify every feature manually. Each test lists the **command**
and the **expected output** so you can replicate it in front of an
examiner.

> Set the base URL once:
>
> ```bash
> export API=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d= -f2)
> echo $API
> # e.g. https://typeahead-search-hld.preview.emergentagent.com
> ```

---

## 1 · Health check

```bash
curl -s $API/api/health
```

**Expected**: `{"ok":true,"ts":<unix-ms>}`

---

## 2 · Typeahead — top 10 sorted by count

```bash
curl -s "$API/api/suggest?q=iph" | jq '.suggestions | length, .[0:3]'
```

**Expected**:
- Length is **10** (cap from the spec).
- The first 3 suggestions all start with `iph` and counts decrease
  monotonically.

---

## 3 · Cache hit / miss visibility

Call the same prefix twice. The first call is a miss; the second is a hit.

```bash
curl -s "$API/api/admin/clear-cache" -X POST > /dev/null   # start clean
curl -s "$API/api/suggest?q=mac" | jq '{hit:.cache.hit, node:.cache.nodeId}'
curl -s "$API/api/suggest?q=mac" | jq '{hit:.cache.hit, node:.cache.nodeId}'
```

**Expected**:
- First → `{"hit": false, "node": "cache-node-X"}`
- Second → `{"hit": true,  "node": "cache-node-X"}` (same node — proves
  consistent hashing returns the same owner)

---

## 4 · Search submission updates the store

```bash
# pick a new query that doesn't currently exist
curl -s -X POST "$API/api/search" -H "Content-Type: application/json" \
     -d '{"q":"viva demo query"}'
```

**Expected**: `{"message":"Searched","query":"viva demo query"}`

Wait ≥ 2 seconds (so the batch writer flushes) and then:

```bash
curl -s "$API/api/suggest?q=viva" | jq '.suggestions[] | select(.query=="viva demo query")'
```

**Expected**: an object `{ "query": "viva demo query", "count": 1 }`.

---

## 5 · Trending — count + recency

```bash
# submit the same query 5 times in quick succession
for i in 1 2 3 4 5; do
  curl -s -X POST "$API/api/search" \
       -H "Content-Type: application/json" \
       -d '{"q":"trending demo"}' > /dev/null
done

curl -s "$API/api/trending?limit=5" | jq
```

**Expected**: `trending demo` appears with a `recency` value close to 5
(slightly less because each event decays a tiny bit between submissions).

Then compare basic vs trending mode for a hot prefix:

```bash
curl -s "$API/api/suggest?q=trending&mode=basic"     | jq '.suggestions[0]'
curl -s "$API/api/suggest?q=trending&mode=trending"  | jq '.suggestions[0]'
```

**Expected**: the trending response carries a `score` field; the basic
response does not.

---

## 6 · Consistent hashing — routing is stable

```bash
curl -s "$API/api/cache/debug?q=java"   | jq '{prefix, ownerNode, ringSize}'
curl -s "$API/api/cache/debug?q=python" | jq '{prefix, ownerNode}'
curl -s "$API/api/ring"                  | jq '{nodes, virtualNodes, sample: (.sample | length)}'
```

**Expected**:
- `ownerNode` is one of `cache-node-A | cache-node-B | cache-node-C`.
- `ringSize == 192` (3 nodes × 64 vnodes).
- `nodes` has 3 entries, `virtualNodes == 64`, sample length ≥ 24.
- Re-running these calls returns the **same owner** for the same prefix
  every time — that's the "consistent" in consistent hashing.

---

## 7 · Batch writes — count reduction

```bash
# 1. Reset counters for a clean measurement.
curl -s -X POST "$API/api/admin/reset-metrics" > /dev/null

# 2. Submit 50 events spread across only 5 unique queries.
for q in alpha beta gamma delta epsilon; do
  for i in 1 2 3 4 5 6 7 8 9 10; do
    curl -s -X POST "$API/api/search" \
         -H "Content-Type: application/json" \
         -d "{\"q\":\"$q\"}" > /dev/null
  done
done

# 3. Force a flush and read the batch counters.
curl -s -X POST "$API/api/admin/flush" \
  | jq '{submissions, writesIssued, writesSaved, flushes}'
```

**Expected**:
- `submissions == 50`
- `writesIssued <= 5` (one bulk op per unique query)
- `writesSaved >= 45` (50 − 5)

That's a **10× write reduction** for this micro-test. Real workloads
typically see 50–100×.

---

## 8 · Empty / non-existent prefixes — graceful handling

```bash
curl -s "$API/api/suggest?q="              | jq
curl -s "$API/api/suggest?q=zzzzzqqqqqxxx" | jq '.suggestions | length'
```

**Expected**:
- Empty prefix → `{"suggestions": [], "cache": {"hit": false, "nodeId": null}, "mode": "basic"}`
- Non-existent prefix → `0`

No 500, no exception.

---

## 9 · Frontend smoke test

1. Open `https://<your-frontend-url>/` in a browser.
2. Type `iph` — a dropdown of 10 suggestions appears.
3. Press **Enter** — a toast confirms the search; the **Trending Now** list
   updates within ~3 s.
4. Click **Trending (count + recency)** — the same prefix now shows a
   re-ranked list that prioritises recently-submitted queries.
5. Look at the small text strip at the bottom: it shows
   `Searches submitted · Cache hits / misses · DB writes saved`. Those
   counters update as you keep searching.

---

## 10 · Performance / p95 latency

```bash
curl -s "$API/api/metrics" | jq '.latency'
```

**Expected** (after a few searches):

```json
{
  "samples": 7,
  "avgLatencyMs": 0.4,
  "p50LatencyMs": 0.3,
  "p95LatencyMs": 1.2,
  "p99LatencyMs": 2.1,
  ...
}
```

Sub-millisecond p50 latency on a cache hit, low-single-digit ms on a miss.
