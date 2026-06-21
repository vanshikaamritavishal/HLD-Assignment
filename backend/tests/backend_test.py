"""Backend API tests for the Search Typeahead HLD app.

Covers:
- Health check
- Typeahead suggestions (basic & trending mode)
- Cache hit / miss & consistent hashing
- Search submission & trending
- Batch writes
- Admin endpoints (clear-cache, reset-metrics, flush)
- Metrics
- Ring debug
"""

import os
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://typeahead-search-hld.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Health ----------
class TestHealth:
    def test_health(self, client):
        r = client.get(f"{API}/health", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        assert "ts" in data


# ---------- Suggest ----------
class TestSuggest:
    def test_suggest_basic_prefix(self, client):
        r = client.get(f"{API}/suggest", params={"q": "mac"}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "suggestions" in data
        assert isinstance(data["suggestions"], list)
        assert len(data["suggestions"]) <= 10
        # All suggestions must start with the prefix
        for s in data["suggestions"]:
            text = s if isinstance(s, str) else s.get("query") or s.get("text") or s.get("value")
            assert text is not None
            assert text.lower().startswith("mac")
        # count desc check if count exposed
        counts = [s.get("count") for s in data["suggestions"] if isinstance(s, dict) and "count" in s]
        if counts and len(counts) > 1:
            assert counts == sorted(counts, reverse=True)

    def test_suggest_empty_prefix(self, client):
        r = client.get(f"{API}/suggest", params={"q": ""}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("suggestions") == [] or data.get("suggestions") is not None
        assert isinstance(data["suggestions"], list)
        assert len(data["suggestions"]) == 0

    def test_suggest_nonexistent_prefix(self, client):
        r = client.get(f"{API}/suggest", params={"q": "zzzzzzzqqq"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data["suggestions"], list)
        assert len(data["suggestions"]) == 0

    def test_cache_hit_on_repeat(self, client):
        # Clear cache first to ensure deterministic state
        client.post(f"{API}/admin/clear-cache", timeout=10)
        r1 = client.get(f"{API}/suggest", params={"q": "mac"}, timeout=15)
        r2 = client.get(f"{API}/suggest", params={"q": "mac"}, timeout=15)
        assert r1.status_code == 200 and r2.status_code == 200
        d1, d2 = r1.json(), r2.json()
        assert "cache" in d1 and "cache" in d2
        assert d1["cache"].get("hit") is False
        assert d2["cache"].get("hit") is True
        assert d1["cache"].get("nodeId") == d2["cache"].get("nodeId")
        assert d2["cache"]["nodeId"] in ("cache-node-A", "cache-node-B", "cache-node-C")


# ---------- Search & Trending ----------
class TestSearchAndTrending:
    def test_search_submission_appears_in_trending(self, client):
        q = "iphone 17 pro max"
        # submit several times to boost trending score
        for _ in range(3):
            r = client.post(f"{API}/search", json={"q": q}, timeout=15)
            assert r.status_code == 200
            data = r.json()
            assert data.get("message") == "Searched"
            assert data.get("query") == q
        time.sleep(1.0)
        tr = client.get(f"{API}/trending", timeout=15)
        assert tr.status_code == 200
        td = tr.json()
        items = td.get("trending") or td.get("items") or td
        # find query in any nested list
        flat_text = str(td).lower()
        assert q in flat_text

    def test_trending_mode_returns_score(self, client):
        # Boost some prefix
        for _ in range(4):
            client.post(f"{API}/search", json={"q": "java programming"}, timeout=15)
        time.sleep(1.0)
        r = client.get(f"{API}/suggest", params={"q": "java", "mode": "trending"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        suggestions = data.get("suggestions", [])
        # At least one suggestion should have a 'score' field
        has_score = any(isinstance(s, dict) and "score" in s for s in suggestions)
        assert has_score, f"Expected 'score' in trending suggestions, got: {suggestions[:3]}"


# ---------- Batch writes ----------
class TestBatchWrites:
    def test_batch_flush_increases_writes(self, client):
        # Reset metrics first for clean baseline
        client.post(f"{API}/admin/reset-metrics", timeout=10)
        m0 = client.get(f"{API}/metrics", timeout=10).json()
        writes_before = m0.get("batch", {}).get("writesIssued", 0)

        queries = ["batchtest alpha", "batchtest beta", "batchtest gamma", "batchtest delta"]
        for q in queries:
            r = client.post(f"{API}/search", json={"q": q}, timeout=15)
            assert r.status_code == 200

        fr = client.post(f"{API}/admin/flush", timeout=15)
        assert fr.status_code == 200
        fdata = fr.json()
        assert "batch" in fdata or "writesIssued" in str(fdata)

        m1 = client.get(f"{API}/metrics", timeout=10).json()
        writes_after = m1.get("batch", {}).get("writesIssued", 0)
        assert writes_after >= writes_before
        # writesSaved should be reported (key exists)
        assert "writesSaved" in m1.get("batch", {})


# ---------- Consistent Hashing / Ring ----------
class TestConsistentHash:
    def test_cache_debug_returns_owner_node(self, client):
        r = client.get(f"{API}/cache/debug", params={"q": "java"}, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data.get("ownerNode") in ("cache-node-A", "cache-node-B", "cache-node-C")
        assert data.get("ringSize") == 192

    def test_ring_endpoint(self, client):
        r = client.get(f"{API}/ring", timeout=10)
        assert r.status_code == 200
        data = r.json()
        nodes = data.get("nodes", [])
        # nodes can be list of strings or objects
        node_ids = [n if isinstance(n, str) else n.get("id") for n in nodes]
        for expected in ["cache-node-A", "cache-node-B", "cache-node-C"]:
            assert expected in node_ids
        assert data.get("virtualNodes") == 64
        sample = data.get("sample", [])
        assert isinstance(sample, list)
        assert len(sample) >= 24


# ---------- Admin endpoints ----------
class TestAdmin:
    def test_clear_cache(self, client):
        # Populate
        client.get(f"{API}/suggest", params={"q": "apple"}, timeout=10)
        r = client.post(f"{API}/admin/clear-cache", timeout=10)
        assert r.status_code == 200
        # Next request should be a miss
        r2 = client.get(f"{API}/suggest", params={"q": "apple"}, timeout=10)
        assert r2.json()["cache"]["hit"] is False

    def test_reset_metrics(self, client):
        # Generate some
        client.get(f"{API}/suggest", params={"q": "test"}, timeout=10)
        r = client.post(f"{API}/admin/reset-metrics", timeout=10)
        assert r.status_code == 200
        m = client.get(f"{API}/metrics", timeout=10).json()
        total = m["cache"].get("totalHits", 0) + m["cache"].get("totalMisses", 0)
        # After reset, should be 0 or very small (from this one call below already happened)
        assert total <= 1


# ---------- Metrics ----------
class TestMetrics:
    def test_metrics_structure(self, client):
        r = client.get(f"{API}/metrics", timeout=15)
        assert r.status_code == 200
        data = r.json()
        # cache section
        assert "cache" in data
        cache = data["cache"]
        for k in ["nodes", "totalHits", "totalMisses", "hitRate"]:
            assert k in cache, f"missing cache.{k}"
        # latency - accept either p50/p95 or p50LatencyMs/p95LatencyMs
        assert "latency" in data
        lat = data["latency"]
        has_p50 = "p50" in lat or "p50LatencyMs" in lat
        has_p95 = "p95" in lat or "p95LatencyMs" in lat
        assert has_p50 and has_p95, f"missing p50/p95 in latency: {lat}"
        # batch
        assert "batch" in data
        # trie keys
        assert "trie" in data
        assert data["trie"].get("keys", 0) >= 100000, f"trie keys too few: {data['trie']}"
