"""
Python ASGI gateway that forwards every /api/* request to the real
Node.js + Express backend running on internal port 8002.

Why this exists?
----------------
The supervisor in this environment is locked to start uvicorn on port 8001
(see /etc/supervisor/conf.d/supervisord.conf). The HLD assignment, however,
requires the backend to be Node.js + Express. We therefore:

  1. Boot a Node.js child process (server.js) on port 8002.
  2. Run a tiny FastAPI app on port 8001 that proxies every request to it.

From the outside (frontend, k8s ingress) everything still talks to port 8001
with the mandatory `/api` prefix. All real HLD logic (Trie, consistent hashing,
distributed cache, batch writer, trending scorer) lives in Node.js — exactly as
the assignment requires.
"""

import os
import subprocess
import atexit
import asyncio
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from pathlib import Path

BACKEND_DIR = Path(__file__).parent
NODE_PORT = int(os.environ.get("NODE_PORT", "8002"))
NODE_URL = f"http://127.0.0.1:{NODE_PORT}"

app = FastAPI(title="Typeahead Gateway")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

_node_proc: subprocess.Popen | None = None
_client: httpx.AsyncClient | None = None


def _spawn_node():
    """Start the Express server as a child process."""
    global _node_proc
    env = os.environ.copy()
    env["PORT"] = str(NODE_PORT)
    _node_proc = subprocess.Popen(
        ["node", "server.js"],
        cwd=str(BACKEND_DIR),
        env=env,
        stdout=subprocess.DEVNULL,   # logs go to its own stream; we keep python clean
        stderr=subprocess.STDOUT,
    )


def _shutdown_node():
    if _node_proc and _node_proc.poll() is None:
        _node_proc.terminate()
        try:
            _node_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _node_proc.kill()


atexit.register(_shutdown_node)


@app.on_event("startup")
async def _startup():
    global _client
    _spawn_node()
    _client = httpx.AsyncClient(base_url=NODE_URL, timeout=30.0)
    # Wait for Node to become reachable (max ~10s).
    for _ in range(50):
        try:
            r = await _client.get("/api/health")
            if r.status_code == 200:
                break
        except Exception:
            pass
        await asyncio.sleep(0.2)


@app.on_event("shutdown")
async def _shutdown():
    if _client:
        await _client.aclose()
    _shutdown_node()


@app.get("/api/__gateway")
async def gateway_info():
    return {"gateway": "fastapi", "upstream": NODE_URL}


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy(path: str, request: Request):
    """Forward the request to the Node backend and stream the response back."""
    url = f"/api/{path}"
    method = request.method
    body = await request.body()

    # Strip headers that should not be forwarded.
    excluded = {"host", "content-length", "connection", "accept-encoding"}
    headers = {k: v for k, v in request.headers.items() if k.lower() not in excluded}

    try:
        upstream = await _client.request(
            method,
            url,
            params=dict(request.query_params),
            content=body,
            headers=headers,
        )
    except httpx.ConnectError:
        return JSONResponse({"error": "node backend not reachable"}, status_code=502)

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers={k: v for k, v in upstream.headers.items()
                 if k.lower() not in {"content-encoding", "transfer-encoding", "connection"}},
        media_type=upstream.headers.get("content-type"),
    )
