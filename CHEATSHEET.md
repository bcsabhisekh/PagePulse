# PagePulse Ollama Cheatsheet

Project folder:

```powershell
C:\Users\Abhisekh\Music\webpage-rag-extension-ollama
```

Backend URL:

```text
http://127.0.0.1:8001
```

Ollama URL:

```text
http://127.0.0.1:11434
```

Chrome extension folder:

```text
C:\Users\Abhisekh\Music\webpage-rag-extension-ollama\extension
```

## Daily Start After Laptop Restart

1. Check installed Ollama models:

```powershell
ollama list
```

Expected models:

```text
llama3.2:3b
nomic-embed-text
```

2. Check if Ollama server is running:

```powershell
curl.exe http://127.0.0.1:11434/api/tags
```

If it returns JSON, Ollama is running.

3. If Ollama is not running, start it:

```powershell
ollama serve
```

Keep this PowerShell window open. If it says the port is already in use, Ollama is already running.

4. Start the PagePulse backend in another PowerShell window:

```powershell
cd "C:\Users\Abhisekh\Music\webpage-rag-extension-ollama"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir .\backend --reload --host 127.0.0.1 --port 8001
```

5. Check backend health:

```powershell
curl.exe http://127.0.0.1:8001/health
```

Expected:

```json
{"status":"ok"}
```

6. Open Chrome and use the PagePulse extension.

## First-Time Setup

Install Ollama:

```powershell
irm https://ollama.com/install.ps1 | iex
```

Pull the required models:

```powershell
ollama pull llama3.2:3b
ollama pull nomic-embed-text
```

Create/install backend environment:

```powershell
cd "C:\Users\Abhisekh\Music\webpage-rag-extension-ollama"
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
```

Load the Chrome extension:

1. Go to `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select:

```text
C:\Users\Abhisekh\Music\webpage-rag-extension-ollama\extension
```

## Reload After Code/UI Changes

Reload extension:

1. Open `chrome://extensions`
2. Find `PagePulse`
3. Click the reload icon
4. Reopen the popup

Restart backend:

```powershell
CTRL+C
cd "C:\Users\Abhisekh\Music\webpage-rag-extension-ollama"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir .\backend --reload --host 127.0.0.1 --port 8001
```

## Current Model Settings

File:

```text
C:\Users\Abhisekh\Music\webpage-rag-extension-ollama\backend\.env
```

Current values:

```text
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=llama3.2:3b
OLLAMA_EMBED_MODEL=nomic-embed-text
NO_PROXY=localhost,127.0.0.1,::1
no_proxy=localhost,127.0.0.1,::1
MAX_PAGE_CHARS=120000
```

## Change Chat Model

Pull a stronger model:

```powershell
ollama pull llama3.1:8b
```

Then edit `backend\.env`:

```text
OLLAMA_CHAT_MODEL=llama3.1:8b
```

Restart backend after changing `.env`.

## Common Troubleshooting

`ollama` command not found:

```powershell
irm https://ollama.com/install.ps1 | iex
```

Then close and reopen PowerShell.

Model missing:

```powershell
ollama pull llama3.2:3b
ollama pull nomic-embed-text
```

Backend cannot connect to Ollama:

```powershell
curl.exe http://127.0.0.1:11434/api/tags
```

If this fails, start Ollama:

```powershell
ollama serve
```

McAfee/proxy HTML error:

Make sure `backend\.env` has:

```text
NO_PROXY=localhost,127.0.0.1,::1
no_proxy=localhost,127.0.0.1,::1
```

Then restart the backend.

Extension cannot reach backend:

```powershell
curl.exe http://127.0.0.1:8001/health
```

If this fails, start the backend again.

Port already in use:

Something is already running on that port. For Ollama, this is often fine. For backend, stop the old backend with `CTRL+C` in its PowerShell window.

Chrome internal pages do not work:

Do not test on `chrome://` pages. Use a normal webpage.

## Important Files

```text
extension\manifest.json     Chrome extension config and icon paths
extension\popup.html        Popup layout
extension\popup.css         Popup styling
extension\popup.js          Popup logic and API calls
extension\contentScript.js  Extracts visible page text
backend\app\main.py         FastAPI routes
backend\app\rag.py          LangChain + Ollama RAG logic
backend\.env                Ollama model config
```

## What PagePulse Remembers

It remembers in backend RAM:

- Current page index
- Page chunks
- Page embeddings
- Cached summary for the page

It does not persist after backend restart.

It does not currently keep conversation memory across questions.
