from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from textwrap import shorten

from dotenv import load_dotenv
from langchain_core.documents import Document
from langchain_core.prompts import PromptTemplate
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter


BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env", override=True)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_CHAT_MODEL = os.getenv("OLLAMA_CHAT_MODEL", "llama3.2:3b")
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
MAX_PAGE_CHARS = int(os.getenv("MAX_PAGE_CHARS", "120000"))


def _ensure_ollama_bypasses_proxy() -> None:
    proxy_bypass_hosts = {
        "localhost",
        "127.0.0.1",
        "::1",
        "host.docker.internal",
    }
    for env_name in ("NO_PROXY", "no_proxy"):
        existing = {
            item.strip()
            for item in os.getenv(env_name, "").split(",")
            if item.strip()
        }
        os.environ[env_name] = ",".join(sorted(existing | proxy_bypass_hosts))


_ensure_ollama_bypasses_proxy()


class PageRagError(RuntimeError):
    """Raised when the local RAG backend cannot produce an answer."""


class PageNotIndexedError(PageRagError):
    """Raised when a question references a page_id that is not cached."""


@dataclass
class PageIndex:
    page_id: str
    title: str
    url: str
    text_hash: str
    chunks: list[Document]
    vector_store: InMemoryVectorStore
    summary: str | None = None


PAGE_INDEXES: dict[str, PageIndex] = {}
PAGE_IDS_BY_FINGERPRINT: dict[str, str] = {}


QA_SYSTEM_PROMPT = """You are a webpage assistant.
Answer only from the provided webpage context.
If the context does not contain the answer, say that the page does not provide enough information.
Keep answers clear and concise.
"""

SUMMARY_SYSTEM_PROMPT = """You are a webpage summarizer.
Summarize only from the provided webpage context.
Include the main idea, key points, and important caveats.
Prefer concise bullets when the page contains several distinct points.
"""


def _safe_error_detail(exc: Exception) -> str:
    detail = f"{exc.__class__.__name__}: {exc}"
    return shorten(detail.replace("\n", " "), width=420, placeholder="...")


def _clean_text(text: str) -> str:
    lines = [line.strip() for line in text.splitlines()]
    cleaned = "\n".join(line for line in lines if line)
    return cleaned[:MAX_PAGE_CHARS]


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _fingerprint(url: str, page_text: str) -> str:
    cleaned = _clean_text(page_text)
    return _hash_text(f"{url}\n\n{cleaned}")


def _split_page(page_text: str, page_title: str, page_url: str) -> list[Document]:
    root_doc = Document(
        page_content=_clean_text(page_text),
        metadata={"title": page_title, "url": page_url},
    )
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=900,
        chunk_overlap=150,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    chunks = splitter.split_documents([root_doc])
    for index, chunk in enumerate(chunks, start=1):
        chunk.metadata["chunk_id"] = index
    return chunks


def _format_context(chunks: list[Document]) -> str:
    formatted = []
    for chunk in chunks:
        chunk_id = chunk.metadata.get("chunk_id", "?")
        formatted.append(f"[Chunk {chunk_id}]\n{chunk.page_content}")
    return "\n\n".join(formatted)


def _source_payload(chunks: list[Document]) -> list[dict[str, object]]:
    return [
        {
            "id": int(chunk.metadata.get("chunk_id", index)),
            "preview": shorten(chunk.page_content.replace("\n", " "), width=220),
        }
        for index, chunk in enumerate(chunks, start=1)
    ]


def _chat_model() -> ChatOllama:
    return ChatOllama(
        model=OLLAMA_CHAT_MODEL,
        base_url=OLLAMA_BASE_URL,
        temperature=0,
        num_predict=700,
    )


def _embedding_model() -> OllamaEmbeddings:
    return OllamaEmbeddings(
        model=OLLAMA_EMBED_MODEL,
        base_url=OLLAMA_BASE_URL,
    )


def _response_text(response: object) -> str:
    content = getattr(response, "content", response)
    return str(content).strip()


def index_page(*, page_text: str, page_title: str, page_url: str) -> dict[str, object]:
    fingerprint = _fingerprint(page_url, page_text)
    existing_page_id = PAGE_IDS_BY_FINGERPRINT.get(fingerprint)
    if existing_page_id:
        cached = PAGE_INDEXES[existing_page_id]
        return {
            "page_id": cached.page_id,
            "chunk_count": len(cached.chunks),
            "cached": True,
            "process": [
                "Matched this page to an existing in-memory index.",
                f"Reused {len(cached.chunks)} cached chunks.",
            ],
        }

    chunks = _split_page(page_text, page_title, page_url)
    if not chunks:
        raise PageRagError("No readable webpage text was found.")

    try:
        embeddings = _embedding_model()
        vector_store = InMemoryVectorStore.from_documents(chunks, embeddings)
    except Exception as exc:
        raise PageRagError(
            "Could not create the page index with Ollama embeddings. Make sure "
            "`ollama serve` is running and run `ollama pull "
            f"{OLLAMA_EMBED_MODEL}`. Provider error: {_safe_error_detail(exc)}"
        ) from exc

    page_id = fingerprint[:16]
    PAGE_INDEXES[page_id] = PageIndex(
        page_id=page_id,
        title=page_title,
        url=page_url,
        text_hash=fingerprint,
        chunks=chunks,
        vector_store=vector_store,
    )
    PAGE_IDS_BY_FINGERPRINT[fingerprint] = page_id

    return {
        "page_id": page_id,
        "chunk_count": len(chunks),
        "cached": False,
        "process": [
            "Cleaned the rendered webpage text.",
            f"Split the page into {len(chunks)} chunks.",
            f"Created local embeddings with {OLLAMA_EMBED_MODEL}.",
            "Stored the page index in memory.",
        ],
    }


def _get_page_index(page_id: str) -> PageIndex:
    page_index = PAGE_INDEXES.get(page_id)
    if not page_index:
        raise PageNotIndexedError("This page is not indexed yet. Reopen the extension to index it.")
    return page_index


def answer_page_question(*, page_id: str, question: str) -> dict[str, object]:
    page_index = _get_page_index(page_id)
    retrieved = page_index.vector_store.similarity_search(
        question,
        k=min(5, len(page_index.chunks)),
    )

    try:
        prompt = PromptTemplate.from_template(
            "{system_prompt}\n\n"
            "Page title: {page_title}\n"
            "Page URL: {page_url}\n\n"
            "Question: {question}\n\n"
            "Relevant webpage context:\n{context}\n\n"
            "Answer:"
        )
        response = (prompt | _chat_model()).invoke(
            {
                "system_prompt": QA_SYSTEM_PROMPT,
                "page_title": page_index.title or "Untitled page",
                "page_url": page_index.url or "Unknown URL",
                "question": question,
                "context": _format_context(retrieved),
            }
        )
    except Exception as exc:
        raise PageRagError(
            "Could not run the Ollama chat model. Make sure `ollama serve` is "
            f"running and run `ollama pull {OLLAMA_CHAT_MODEL}`. "
            f"Provider error: {_safe_error_detail(exc)}"
        ) from exc

    return {
        "answer": _response_text(response),
        "sources": _source_payload(retrieved),
        "mode": "qa",
        "model": OLLAMA_CHAT_MODEL,
        "process": [
            f"Retrieved {len(retrieved)} relevant chunks from the page index.",
            f"Sent the grounded prompt to {OLLAMA_CHAT_MODEL}.",
            "Returned the answer with source chunk references.",
        ],
    }


def summarize_page(*, page_id: str) -> dict[str, object]:
    page_index = _get_page_index(page_id)
    if page_index.summary:
        return {
            "answer": page_index.summary,
            "sources": _source_payload(page_index.chunks),
            "mode": "summary",
            "model": OLLAMA_CHAT_MODEL,
            "process": [
                "Loaded the cached summary from memory.",
                "Skipped a second Ollama generation call.",
            ],
        }

    try:
        prompt = PromptTemplate.from_template(
            "{system_prompt}\n\n"
            "Page title: {page_title}\n"
            "Page URL: {page_url}\n\n"
            "Full webpage context:\n{context}\n\n"
            "Summary:"
        )
        response = (prompt | _chat_model()).invoke(
            {
                "system_prompt": SUMMARY_SYSTEM_PROMPT,
                "page_title": page_index.title or "Untitled page",
                "page_url": page_index.url or "Unknown URL",
                "context": _format_context(page_index.chunks),
            }
        )
    except Exception as exc:
        raise PageRagError(
            "Could not run the Ollama summary model. Make sure `ollama serve` is "
            f"running and run `ollama pull {OLLAMA_CHAT_MODEL}`. "
            f"Provider error: {_safe_error_detail(exc)}"
        ) from exc

    page_index.summary = _response_text(response)

    return {
        "answer": page_index.summary,
        "sources": _source_payload(page_index.chunks),
        "mode": "summary",
        "model": OLLAMA_CHAT_MODEL,
        "process": [
            f"Loaded all {len(page_index.chunks)} cached chunks.",
            f"Sent the summary prompt to {OLLAMA_CHAT_MODEL}.",
            "Cached the generated summary for this page.",
        ],
    }
