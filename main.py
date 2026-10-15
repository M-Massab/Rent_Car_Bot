from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .llm import LLM, make_llm
from .rag.pipeline import RAGPipeline, build_pipeline
from .ratelimit import SlidingWindowLimiter
from .schemas import ChatRequest, ChatResponse

log = logging.getLogger("rentacar")

CSP = (
    "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; "
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://wa.me"
)


def create_app(settings: Settings | None = None, llm: LLM | None = None) -> FastAPI:
    settings = settings or Settings()
    limiter = SlidingWindowLimiter(settings.rate_limit_per_min)
    state: dict = {}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        state["pipeline"] = build_pipeline(settings, llm or make_llm(settings))
        state["business"] = state["pipeline"].business
        state["fleet"] = json.loads((settings.data_dir / "fleet.json").read_text(encoding="utf-8"))
        log.info("RAG pipeline ready, llm=%s, chunks=%d", state["pipeline"].llm.mode, len(state["pipeline"].retriever.chunks))
        yield

    app = FastAPI(title="Lahore Drive Rentals", lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        resp = await call_next(request)
        resp.headers.setdefault("Content-Security-Policy", CSP)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        return resp

    def client_key(request: Request) -> str:
        if settings.trust_proxy and (fwd := request.headers.get("x-forwarded-for")):
            return fwd.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def write_log(req_text: str, r) -> None:
        try:
            settings.log_dir.mkdir(parents=True, exist_ok=True)
            row = {
                "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "intent": r.intent, "grounded": r.grounded, "handoff": r.handoff,
                "retrieved": r.retrieved, "cited": [s["id"] for s in r.sources], "ms": r.latency_ms,
            }
            if settings.log_chat_text:  # off by default: customers type phone numbers and names
                row["question"], row["answer"] = req_text, r.answer
            with (settings.log_dir / "chats.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        except OSError:
            log.exception("could not write chat log")

    @app.get("/api/health")
    def health():
        p: RAGPipeline = state["pipeline"]
        return {"status": "ok", "llm": p.llm.mode, "chunks": len(p.retriever.chunks)}

    @app.get("/api/config")
    def config():
        return {**state["business"], "llm_mode": state["pipeline"].llm.mode}

    @app.get("/api/fleet")
    def fleet():
        return state["fleet"]

    @app.get("/api/faq")
    def faq():
        return [
            {"id": c.id, "question": c.section, "answer": c.body}
            for c in state["pipeline"].retriever.chunks
            if c.doc == "faq"
        ]

    @app.post("/api/chat", response_model=ChatResponse)
    def chat(body: ChatRequest, request: Request):
        if not limiter.allow(client_key(request)):
            raise HTTPException(status_code=429, detail="Too many messages. Please wait a minute and try again.")
        history = [t.model_dump() for t in body.history]
        result = state["pipeline"].answer(body.message, history)
        write_log(body.message, result)
        return ChatResponse(
            answer=result.answer, sources=result.sources, handoff=result.handoff,
            grounded=result.grounded, intent=result.intent,
        )

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("unhandled error")
        return JSONResponse({"detail": "Something went wrong. Please try again."}, status_code=500)

    if settings.site_dir.exists():
        app.mount("/", StaticFiles(directory=settings.site_dir, html=True), name="site")
    return app


app = create_app()
