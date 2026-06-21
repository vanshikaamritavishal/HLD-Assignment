# PRD — Search Typeahead (HLD Assignment)

## Current state (post-simplification, Feb 2026)

UI simplified for university submission:
- Removed: /architecture page, live metrics dashboard, hash ring visualizer
- Kept: search box, suggestion dropdown, basic/trending mode tabs, trending list, minimal 3-counter analytics strip

Backend untouched — all HLD logic preserved in services/.

## Documentation deliverables (root of /app)
- README.md — overview, features, setup, folder structure, how to run
- ARCHITECTURE.md — diagrams (system, request, cache), CH explanation, batch-write explanation, complexity, scaling
- PROJECT_REPORT.md — problem statement, requirements, design decisions, implementation, results, future scope
- TESTING_GUIDE.md — how to test each feature with curl + expected output
- SUBMISSION_CHECKLIST.md — requirement → file mapping table (+ grading-rubric map)

## Implementation files (unchanged)
- backend/server.py — FastAPI gateway → Node :8002 proxy
- backend/server.js — Express bootstrap (Trie, ring, cache, batch, trending)
- backend/src/services/{trie,consistentHash,cacheCluster,batchWriter,trendingService,metrics,queryStore}.js
- backend/src/routes.js — all /api endpoints
- frontend/src/pages/SearchPage.jsx — single page
- frontend/src/components/{SearchBox,TrendingSearches,SearchAnalytics}.jsx
- frontend/src/lib/api.js, hooks/useDebounce.js

## Removed files
- frontend/src/pages/ArchitecturePage.jsx
- frontend/src/components/CacheDebugPanel.jsx
- frontend/src/components/HashRingVisualizer.jsx

## Verification
- Backend smoke tests pass (suggest, submit, trending, cache/debug, metrics)
- Dataset: 150,000 unique queries
- 13/13 backend pytest from iteration_1 still applies (code paths unchanged)

## Next tasks
- (Optional) Capture screenshots into /app/screenshots/ for the GitHub submission
- (Optional) Add a SETUP_VIDEO_SCRIPT.md if user wants a recorded demo
