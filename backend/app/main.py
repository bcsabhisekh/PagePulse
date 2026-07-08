from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .rag import (
    PageNotIndexedError,
    PageRagError,
    answer_page_question,
    index_page,
    summarize_page,
)


class IndexPageRequest(BaseModel):
    page_text: str = Field(min_length=1)
    page_title: str = ""
    page_url: str = ""


class IndexPageResponse(BaseModel):
    page_id: str
    chunk_count: int
    cached: bool
    process: list[str] = Field(default_factory=list)


class AskPageRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


class SourceChunk(BaseModel):
    id: int
    preview: str


class AskResponse(BaseModel):
    answer: str
    sources: list[SourceChunk]
    mode: str
    model: str
    process: list[str] = Field(default_factory=list)


app = FastAPI(title="PagePulse")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/pages/index", response_model=IndexPageResponse)
def create_page_index(payload: IndexPageRequest) -> dict[str, object]:
    try:
        return index_page(
            page_text=payload.page_text,
            page_title=payload.page_title,
            page_url=payload.page_url,
        )
    except PageRagError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/pages/{page_id}/ask", response_model=AskResponse)
def ask_page(page_id: str, payload: AskPageRequest) -> dict[str, object]:
    try:
        return answer_page_question(page_id=page_id, question=payload.question)
    except PageNotIndexedError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PageRagError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/pages/{page_id}/summary", response_model=AskResponse)
def summarize_indexed_page(page_id: str) -> dict[str, object]:
    try:
        return summarize_page(page_id=page_id)
    except PageNotIndexedError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PageRagError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
