/**
 * Prefix Trie used to serve typeahead suggestions.
 *
 * Why a Trie?
 *   For prefix queries, a Trie gives O(L) lookup of the subtree containing all
 *   matching strings, where L is the length of the prefix. We attach a small
 *   "topK" list at each node so we can return the top-10 suggestions for any
 *   prefix in O(L + k) time without scanning subtrees at query time.
 *
 * Tradeoffs we explicitly accept (and would explain in the viva):
 *   - In-memory only: rebuilt on startup from the primary store. Fine for
 *     ~150k queries (~10-20 MB).
 *   - topK is maintained per node — slightly more memory, much faster reads.
 */

const TOP_K = 10;

class TrieNode {
  constructor() {
    this.children = new Map();
    this.isWord = false;
    this.count = 0;         // count of THIS word if isWord
    this.top = [];          // sorted desc: [{query, count}, ...] of size <= TOP_K
  }
}

/** Maintain a sorted top-K list by count desc, then alpha asc. */
function bumpTop(top, query, newCount) {
  // remove existing entry with same query
  const idx = top.findIndex((e) => e.query === query);
  if (idx !== -1) top.splice(idx, 1);
  top.push({ query, count: newCount });
  top.sort((a, b) => (b.count - a.count) || (a.query < b.query ? -1 : 1));
  if (top.length > TOP_K) top.length = TOP_K;
}

class Trie {
  constructor() {
    this.root = new TrieNode();
    this.size = 0;
  }

  /** Insert or increment a query by delta. */
  insert(query, delta = 1) {
    if (!query) return;
    const word = query.toLowerCase();
    let node = this.root;
    const path = [node];
    for (const ch of word) {
      let next = node.children.get(ch);
      if (!next) {
        next = new TrieNode();
        node.children.set(ch, next);
      }
      node = next;
      path.push(node);
    }
    if (!node.isWord) {
      node.isWord = true;
      this.size += 1;
    }
    node.count += delta;
    // Update topK at every ancestor (prefix) including root.
    for (const n of path) bumpTop(n.top, word, node.count);
  }

  /** Return the topK entries for the given prefix. */
  suggest(prefix, k = TOP_K) {
    if (prefix === undefined || prefix === null) return [];
    const p = String(prefix).toLowerCase();
    let node = this.root;
    for (const ch of p) {
      node = node.children.get(ch);
      if (!node) return [];
    }
    return node.top.slice(0, k).map((e) => ({ ...e }));
  }
}

module.exports = Trie;
