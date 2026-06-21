/**
 * Trending Service.
 *
 * We compute a "trending score" that blends two signals:
 *
 *   trending(q) = α * historicalCount(q) + β * recencyBoost(q)
 *
 * where recencyBoost decays exponentially with a configurable half-life:
 *
 *   recencyBoost(q) = Σ_i  exp(- ln(2) * (now - t_i) / halfLife)
 *
 * Properties (good for viva):
 *   - A query searched many times long ago contributes mostly to historical
 *     count and only a tiny recency boost.
 *   - A query searched a few times in the last minute spikes the recency
 *     boost but its impact wears off quickly (after a few half-lives).
 *   - The blend means popular-AND-recent queries dominate trending lists,
 *     not just whatever was searched 1 second ago.
 *
 * Memory: for each query we keep a single floating "decayed" counter that we
 * lazily refresh when touched. No per-event list, so the structure is O(Q)
 * total regardless of how many submissions we receive.
 */

class TrendingService {
  constructor({ halfLifeMs = 5 * 60_000, historicalWeight = 0.6, recentWeight = 0.4 } = {}) {
    this.halfLifeMs = halfLifeMs;
    this.lambda = Math.log(2) / halfLifeMs; // decay rate
    this.alpha = historicalWeight;
    this.beta = recentWeight;
    // q -> { decayed: number, updatedAt: number }
    this.state = new Map();
  }

  _refresh(entry, now) {
    const dt = now - entry.updatedAt;
    if (dt > 0) entry.decayed *= Math.exp(-this.lambda * dt);
    entry.updatedAt = now;
  }

  /** Record a fresh submission. */
  record(query) {
    if (!query) return;
    const q = String(query).toLowerCase();
    const now = Date.now();
    let e = this.state.get(q);
    if (!e) {
      e = { decayed: 0, updatedAt: now };
      this.state.set(q, e);
    }
    this._refresh(e, now);
    e.decayed += 1;
  }

  /** Return the current recency score for a query (decayed to now). */
  recencyScore(query) {
    const q = String(query).toLowerCase();
    const e = this.state.get(q);
    if (!e) return 0;
    this._refresh(e, Date.now());
    return e.decayed;
  }

  /**
   * Combine historical counts (passed in from caller — usually the Trie's
   * topK) with our recency score and return a re-ranked list.
   */
  rerank(candidates) {
    // Normalize so weights are meaningful regardless of scale.
    const maxHist = Math.max(1, ...candidates.map((c) => c.count || 0));
    const maxRec  = Math.max(1, ...candidates.map((c) => this.recencyScore(c.query)));
    return candidates
      .map((c) => {
        const hist = (c.count || 0) / maxHist;
        const rec = this.recencyScore(c.query) / maxRec;
        const score = this.alpha * hist + this.beta * rec;
        return { ...c, score: +score.toFixed(4), recency: this.recencyScore(c.query) };
      })
      .sort((a, b) => b.score - a.score);
  }

  /** Top trending queries globally. */
  topTrending(k = 10) {
    const now = Date.now();
    const arr = [];
    for (const [q, e] of this.state) {
      this._refresh(e, now);
      if (e.decayed > 0.01) arr.push({ query: q, recency: +e.decayed.toFixed(3) });
    }
    arr.sort((a, b) => b.recency - a.recency);
    return arr.slice(0, k);
  }
}

module.exports = TrendingService;
