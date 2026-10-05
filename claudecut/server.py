"""
ClaudeCut FastAPI Drop-In Proxy Server.
Intercepts Anthropic API requests, optimizes payloads, automatically switches models based on task,
and routes with automatic prompt caching.
"""

import json
from fastapi import FastAPI, Request, Response, Header
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
import httpx

from .config import settings
from .optimizer.cache_injector import inject_prompt_cache
from .optimizer.context_pruner import prune_payload
from .optimizer.smart_router import route_model
from .optimizer.response_cache import ResponseCache
from .analytics.tracker import CostTracker
from .analytics.dashboard import DASHBOARD_HTML

app = FastAPI(
    title="ClaudeCut Proxy",
    description="Drop-in Anthropic API optimizer reducing costs by 40%+",
    version="1.0.0"
)

tracker = CostTracker(db_path=settings.DATABASE_PATH)
response_cache = ResponseCache()

@app.get("/", response_class=HTMLResponse)
@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard():
    return HTMLResponse(content=DASHBOARD_HTML)

@app.get("/api/stats")
async def get_stats():
    return tracker.get_summary_stats()

@app.get("/health")
async def health_check():
    return {"status": "ok", "proxy": "ClaudeCut v1.0.0", "routing_mode": settings.ROUTING_MODE}

@app.post("/v1/messages")
async def proxy_messages(request: Request, x_api_key: str = Header(None)):
    raw_body = await request.body()
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        return Response(content=raw_body, status_code=400)

    # Resolve API Key
    api_key = x_api_key or settings.ANTHROPIC_API_KEY
    if not api_key:
        return JSONResponse(
            status_code=401,
            content={"error": {"type": "authentication_error", "message": "Missing Anthropic API Key."}}
        )

    # 1. Exact Cache Check (if enabled)
    if settings.ENABLE_RESPONSE_CACHE:
        cached_resp = response_cache.get(payload)
        if cached_resp:
            return JSONResponse(
                content=cached_resp,
                headers={"x-claudecut-cache": "HIT"}
            )

    # 2. Context Pruning / Minification
    if settings.ENABLE_CONTEXT_PRUNING:
        payload = prune_payload(payload)

    # 3. Dynamic Task-Based Automatic Model Switching
    force_override = request.headers.get("x-force-model", "false").lower() == "true"
    routing_mode = request.headers.get("x-routing-mode", settings.ROUTING_MODE)
    
    target_model, routing_reason = route_model(
        payload,
        light_model=settings.LIGHT_TIER_MODEL,
        standard_model=settings.STANDARD_TIER_MODEL,
        heavy_model=settings.HEAVY_TIER_MODEL,
        routing_mode=routing_mode,
        force_override=force_override
    )
    requested_model = payload.get("model", settings.STANDARD_TIER_MODEL)
    payload["model"] = target_model

    # 4. Automatic Ephemeral Prompt Caching Injection
    if settings.ENABLE_AUTO_PROMPT_CACHING:
        payload = inject_prompt_cache(payload, min_tokens_threshold=settings.PROMPT_CACHE_MIN_TOKENS)

    # Build upstream headers
    upstream_headers = {
        "x-api-key": api_key,
        "anthropic-version": request.headers.get("anthropic-version", settings.ANTHROPIC_VERSION),
        "content-type": "application/json",
    }
    
    if "anthropic-beta" in request.headers:
        upstream_headers["anthropic-beta"] = request.headers["anthropic-beta"]
    else:
        upstream_headers["anthropic-beta"] = "prompt-caching-2024-07-31"

    is_stream = payload.get("stream", False)
    target_url = f"{settings.ANTHROPIC_BASE_URL.rstrip('/')}/v1/messages"

    client = httpx.AsyncClient(timeout=180.0)

    claudecut_headers = {
        "x-claudecut-routed-model": target_model,
        "x-claudecut-routing-reason": routing_reason,
        "x-claudecut-requested-model": requested_model
    }

    if not is_stream:
        try:
            upstream_resp = await client.post(
                target_url,
                headers=upstream_headers,
                json=payload
            )
            data = upstream_resp.json()

            # Record usage analytics if present
            if upstream_resp.status_code == 200 and "usage" in data:
                tracker.record_usage(target_model, data["usage"], requested_model=requested_model)
                if settings.ENABLE_RESPONSE_CACHE:
                    response_cache.set(payload, data)

            await client.aclose()
            return JSONResponse(
                content=data,
                status_code=upstream_resp.status_code,
                headers=claudecut_headers
            )
        except Exception as e:
            await client.aclose()
            return JSONResponse(status_code=500, content={"error": {"type": "proxy_error", "message": str(e)}})
    else:
        # Handle SSE Streaming
        req = client.build_request("POST", target_url, headers=upstream_headers, json=payload)
        upstream_resp = await client.send(req, stream=True)

        async def stream_generator():
            accumulated_usage = {}
            try:
                async for chunk in upstream_resp.aiter_bytes():
                    chunk_str = chunk.decode("utf-8", errors="ignore")
                    for line in chunk_str.splitlines():
                        if line.startswith("data:"):
                            try:
                                json_part = json.loads(line[5:].strip())
                                if json_part.get("type") == "message_start" and "message" in json_part:
                                    accumulated_usage.update(json_part["message"].get("usage", {}))
                                elif json_part.get("type") == "message_delta" and "usage" in json_part:
                                    accumulated_usage.update(json_part.get("usage", {}))
                            except Exception:
                                pass
                    yield chunk
            finally:
                if accumulated_usage:
                    tracker.record_usage(target_model, accumulated_usage, requested_model=requested_model)
                await upstream_resp.aclose()
                await client.aclose()

        return StreamingResponse(
            stream_generator(),
            status_code=upstream_resp.status_code,
            headers=claudecut_headers,
            media_type="text/event-stream"
        )
