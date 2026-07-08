# Step By Step Learning Path

## Milestone 1: Understand The Moving Parts

The Chrome extension cannot safely run a large local language model inside the popup. So the browser extension only handles UI and page extraction. The local backend handles LangChain, embeddings, retrieval, and model calls.

Core idea:

- Chrome extension = frontend
- FastAPI backend = API layer
- LangChain = RAG orchestration
- Ollama = local open chat and embedding models

## Milestone 2: Chrome Extension Basics

Start with these files:

- `extension/manifest.json`
- `extension/popup.html`
- `extension/popup.js`
- `extension/contentScript.js`

Key concepts:

- `manifest.json` tells Chrome what your extension can do.
- The popup is the small window that opens when you click the extension icon.
- A content script runs inside the current webpage and can read visible page text.
- Chrome messaging lets the popup ask the content script for that page text.

## Milestone 3: Backend Basics

Start with:

- `backend/app/main.py`

Key concepts:

- FastAPI exposes `/health`, `/pages/index`, `/pages/{page_id}/ask`, and `/pages/{page_id}/summary`.
- The extension calls `/pages/index` only when the current page needs an index.
- Later questions use the returned `page_id` instead of resending the whole page.
- CORS is enabled so Chrome can call your local backend.

## Milestone 4: LangChain RAG

Start with:

- `backend/app/rag.py`

RAG steps:

1. Clean the webpage text.
2. Split it into chunks.
3. Create embeddings for each chunk.
4. Store chunks in an in-memory vector store.
5. Cache that vector store under a `page_id`.
6. For QnA, retrieve chunks similar to the question.
7. For summary, return the cached summary if one already exists.
8. For the first summary, pass all cached chunks to the summarizer prompt.
9. Store that generated summary on the `PageIndex`.
10. Ask the local Ollama chat model to answer using the selected context.

The embedding model and chat model are both configured in `backend/.env`:

```text
OLLAMA_CHAT_MODEL=llama3.2:3b
OLLAMA_EMBED_MODEL=nomic-embed-text
```

## Milestone 5: Improve It

Once the first version works, good next upgrades are:

- add streaming responses
- show source chunk previews in the popup
- persist embeddings with Chroma or FAISS
- add a settings page for model/backend URL
- support selected text
- support PDF/document pages
- add tests for text extraction and RAG prompts
