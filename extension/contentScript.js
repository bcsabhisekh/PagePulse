function cleanText(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, 120000);
}

function getReadablePageText() {
  const candidates = [
    document.querySelector("article"),
    document.querySelector("main"),
    document.body
  ].filter(Boolean);

  const best = candidates.reduce((selected, candidate) => {
    const selectedLength = selected.innerText ? selected.innerText.length : 0;
    const candidateLength = candidate.innerText ? candidate.innerText.length : 0;
    return candidateLength > selectedLength ? candidate : selected;
  }, document.body);

  return cleanText(best.innerText || document.body.innerText || "");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GET_PAGE_TEXT") {
    return false;
  }

  sendResponse({
    title: document.title,
    url: window.location.href,
    text: getReadablePageText()
  });

  return true;
});

