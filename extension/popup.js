const API_BASE_URL = "http://127.0.0.1:8001";

const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chatForm");
const inputEl = document.getElementById("questionInput");
const statusEl = document.getElementById("status");
const pageMetaEl = document.getElementById("pageMeta");
const summaryButtonEl = document.getElementById("summaryButton");
const pipelineMetaEl = document.getElementById("pipelineMeta");
const pipelineStepsEl = document.getElementById("pipelineSteps");

const PIPELINE_STEPS = [
  { key: "read", label: "Read" },
  { key: "index", label: "Index" },
  { key: "embed", label: "Embed" },
  { key: "retrieve", label: "Retrieve" },
  { key: "generate", label: "Ollama" }
];

let currentPage = null;
let currentPageIndex = null;
let pendingIndexProcess = [];
let pipelineState = {
  active: null,
  done: new Set(),
  error: null
};

function setStatus(text, isBusy = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("busy", isBusy);
}

function renderPipeline() {
  pipelineStepsEl.textContent = "";

  for (const step of PIPELINE_STEPS) {
    const item = document.createElement("li");
    item.className = "pipelineStep";
    item.textContent = step.label;

    if (pipelineState.done.has(step.key)) {
      item.classList.add("done");
    }
    if (pipelineState.active === step.key) {
      item.classList.add("active");
    }
    if (pipelineState.error === step.key) {
      item.classList.add("error");
    }

    pipelineStepsEl.appendChild(item);
  }
}

function setPipeline({ active = null, done = [], error = null, meta = "" }) {
  pipelineState.active = active;
  pipelineState.error = error;
  for (const key of done) {
    pipelineState.done.add(key);
  }
  if (meta) {
    pipelineMetaEl.textContent = meta;
  }
  renderPipeline();
}

function resetPipeline(meta = "Idle") {
  pipelineState = {
    active: null,
    done: new Set(),
    error: null
  };
  pipelineMetaEl.textContent = meta;
  renderPipeline();
}

function appendInlineText(parent, text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      parent.appendChild(strong);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  }
}

function appendParagraph(parent, lines) {
  if (lines.length === 0) {
    return;
  }
  const paragraph = document.createElement("p");
  appendInlineText(paragraph, lines.join(" "));
  parent.appendChild(paragraph);
}

function appendList(parent, items, ordered = false) {
  if (items.length === 0) {
    return;
  }
  const list = document.createElement(ordered ? "ol" : "ul");
  for (const itemText of items) {
    const item = document.createElement("li");
    appendInlineText(item, itemText);
    list.appendChild(item);
  }
  parent.appendChild(list);
}

function renderRichText(parent, text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraphLines = [];
  let listItems = [];
  let orderedItems = [];

  function flushParagraph() {
    appendParagraph(parent, paragraphLines);
    paragraphLines = [];
  }

  function flushLists() {
    appendList(parent, listItems);
    appendList(parent, orderedItems, true);
    listItems = [];
    orderedItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const bulletMatch = line.match(/^[*-]\s+(.+)$/);
    const orderedMatch = line.match(/^\d+[.)]\s+(.+)$/);

    if (!line) {
      flushParagraph();
      flushLists();
      continue;
    }

    if (bulletMatch) {
      flushParagraph();
      appendList(parent, orderedItems, true);
      orderedItems = [];
      listItems.push(bulletMatch[1]);
      continue;
    }

    if (orderedMatch) {
      flushParagraph();
      appendList(parent, listItems);
      listItems = [];
      orderedItems.push(orderedMatch[1]);
      continue;
    }

    flushLists();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushLists();
}

function addMessage(text, kind = "assistant", sources = [], process = []) {
  const message = document.createElement("article");
  message.className = `message ${kind}`;

  const content = document.createElement("div");
  content.className = "messageContent";
  if (kind === "assistant") {
    renderRichText(content, text);
  } else {
    content.textContent = text;
  }
  message.appendChild(content);

  if (sources.length > 0) {
    const sourceBox = document.createElement("div");
    sourceBox.className = "sources";
    sourceBox.textContent = `Sources: ${sources.map((source) => `chunk ${source.id}`).join(", ")}`;
    message.appendChild(sourceBox);
  }

  if (process.length > 0) {
    const processBox = document.createElement("div");
    processBox.className = "processLog";

    const title = document.createElement("div");
    title.className = "processTitle";
    title.textContent = "Backend";
    processBox.appendChild(title);

    const list = document.createElement("ol");
    for (const step of process) {
      const item = document.createElement("li");
      item.textContent = step;
      list.appendChild(item);
    }
    processBox.appendChild(list);
    message.appendChild(processBox);
  }

  messagesEl.appendChild(message);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setLoading(isLoading, label = "Thinking") {
  inputEl.disabled = isLoading;
  summaryButtonEl.disabled = isLoading;
  formEl.querySelector("button[type='submit']").disabled = isLoading;
  setStatus(isLoading ? label : "Ready", isLoading);
}

function queryActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) {
        reject(new Error("No active Chrome tab was found."));
        return;
      }
      resolve(tab);
    });
  });
}

function sendPageTextMessage(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_TEXT" }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["contentScript.js"]
      },
      () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      }
    );
  });
}

async function getCurrentPage() {
  const tab = await queryActiveTab();

  try {
    return await sendPageTextMessage(tab.id);
  } catch (_firstError) {
    await injectContentScript(tab.id);
    return sendPageTextMessage(tab.id);
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const responseBody = await response.json().catch(() => ({}));
    throw new Error(responseBody.detail || `Backend request failed with ${response.status}.`);
  }

  return response.json();
}

async function postWithoutBody(url) {
  const response = await fetch(url, { method: "POST" });

  if (!response.ok) {
    const responseBody = await response.json().catch(() => ({}));
    throw new Error(responseBody.detail || `Backend request failed with ${response.status}.`);
  }

  return response.json();
}

async function ensurePageIndexed() {
  if (currentPageIndex) {
    setPipeline({
      done: ["read", "index", "embed"],
      meta: "Page indexed"
    });
    return currentPageIndex;
  }

  if (!currentPage || !currentPage.text) {
    throw new Error("This page did not provide readable text.");
  }

  setPipeline({
    active: "index",
    done: ["read"],
    meta: "Indexing page"
  });

  currentPageIndex = await postJson(`${API_BASE_URL}/pages/index`, {
    page_title: currentPage.title,
    page_url: currentPage.url,
    page_text: currentPage.text
  });

  pendingIndexProcess = currentPageIndex.process || [];
  pageMetaEl.textContent = `${currentPage.title || "Untitled page"} - ${currentPageIndex.chunk_count} chunks`;
  setPipeline({
    active: null,
    done: ["read", "index", "embed"],
    meta: currentPageIndex.cached ? "Cached index" : "Index ready"
  });

  return currentPageIndex;
}

function consumeProcess(process = []) {
  const combined = [...pendingIndexProcess, ...process];
  pendingIndexProcess = [];
  return combined;
}

async function askBackend(question) {
  const pageIndex = await ensurePageIndexed();

  setPipeline({
    active: "retrieve",
    done: ["read", "index", "embed"],
    meta: "Retrieving context"
  });

  const result = await postJson(`${API_BASE_URL}/pages/${pageIndex.page_id}/ask`, { question });
  result.process = consumeProcess(result.process || []);

  setPipeline({
    active: null,
    done: ["read", "index", "embed", "retrieve", "generate"],
    meta: "Answer ready"
  });

  return result;
}

async function summarizeBackend() {
  const pageIndex = await ensurePageIndexed();

  setPipeline({
    active: "generate",
    done: ["read", "index", "embed"],
    meta: "Summarizing"
  });

  const result = await postWithoutBody(`${API_BASE_URL}/pages/${pageIndex.page_id}/summary`);
  result.process = consumeProcess(result.process || []);

  setPipeline({
    active: null,
    done: ["read", "index", "embed", "generate"],
    meta: "Summary ready"
  });

  return result;
}

async function submitQuestion(question) {
  const trimmed = question.trim();
  if (!trimmed) {
    return;
  }

  addMessage(trimmed, "user");
  setLoading(true, currentPageIndex ? "Thinking" : "Indexing");

  try {
    const result = await askBackend(trimmed);
    addMessage(result.answer, "assistant", result.sources || [], result.process || []);
  } catch (error) {
    setPipeline({
      active: null,
      error: pipelineState.active || "generate",
      meta: "Blocked"
    });
    addMessage(error.message, "error");
  } finally {
    setLoading(false);
    inputEl.focus();
  }
}

async function submitSummary() {
  addMessage("Summarize this webpage.", "user");
  setLoading(true, currentPageIndex ? "Thinking" : "Indexing");

  try {
    const result = await summarizeBackend();
    addMessage(result.answer, "assistant", result.sources || [], result.process || []);
  } catch (error) {
    setPipeline({
      active: null,
      error: pipelineState.active || "generate",
      meta: "Blocked"
    });
    addMessage(error.message, "error");
  } finally {
    setLoading(false);
    inputEl.focus();
  }
}

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = inputEl.value;
  inputEl.value = "";
  submitQuestion(question);
});

summaryButtonEl.addEventListener("click", () => {
  submitSummary();
});

async function init() {
  resetPipeline("Starting");
  setStatus("Loading", true);
  setPipeline({
    active: "read",
    meta: "Reading tab"
  });

  try {
    currentPage = await getCurrentPage();
    const title = currentPage.title || "Untitled page";
    const textLength = currentPage.text ? currentPage.text.length : 0;
    pageMetaEl.textContent = `${title} - ${textLength.toLocaleString()} chars`;
    addMessage("Ask a question about this page, or click Summarize. I will index it on the first request.", "assistant");
    setPipeline({
      active: null,
      done: ["read"],
      meta: "Ready"
    });
    setStatus("Ready");
  } catch (error) {
    pageMetaEl.textContent = "Could not read this tab";
    setPipeline({
      active: null,
      error: "read",
      meta: "Blocked"
    });
    addMessage(error.message, "error");
    setStatus("Blocked");
  }
}

renderPipeline();
init();
