const fields = ["firstName","lastName","preferredName","email","phone","address","city","state","zip","linkedin","website","jobTitle","employer","salary","travelAvailability","relocationWillingness","familyWorksAtCompany","priorCompanyRelationship","workAuthorization","gender","race","disability","veteran","educationLevel","startDate","coverLetter"];

// Load saved settings
chrome.storage.sync.get(fields, (data) => {
  fields.forEach(f => {
    if (data[f]) document.getElementById(f).value = data[f];
  });
});

// Save
document.getElementById("saveBtn").addEventListener("click", () => {
  const data = {};
  fields.forEach(f => data[f] = document.getElementById(f).value);
  chrome.storage.sync.set(data, () => {
    document.getElementById("status").textContent = "Saved!";
    setTimeout(() => document.getElementById("status").textContent = "", 2000);
  });
});

function setStatus(text, isError) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.style.color = isError ? "#b91c1c" : "green";
  if (text) setTimeout(() => { status.textContent = ""; status.style.color = "green"; }, 3000);
}

function injectContentScript(tabId, callback) {
  chrome.scripting.executeScript(
    { target: { tabId, allFrames: true }, files: ["content.js"] },
    callback
  );
}

function messageAllFrames(tabId, message, callback) {
  chrome.scripting.executeScript(
    { target: { tabId, allFrames: true }, func: () => true },
    (results) => {
      if (chrome.runtime.lastError || !results?.length) {
        callback(chrome.runtime.lastError, []);
        return;
      }
      const responses = [];
      let pending = results.length;
      results.forEach((r) => {
        chrome.tabs.sendMessage(tabId, message, { frameId: r.frameId }, (response) => {
          if (!chrome.runtime.lastError && response) responses.push(response);
          if (--pending === 0) callback(null, responses);
        });
      });
    }
  );
}

function sendFillToTab(tabId, data, retriesLeft = 2) {
  messageAllFrames(tabId, { action: "fill", data }, (err, responses) => {
    const okResponses = responses.filter(r => r?.ok);
    if (err || !okResponses.length) {
      if (retriesLeft > 0) {
        injectContentScript(tabId, () => {
          if (chrome.runtime.lastError) {
            setStatus("Can't fill this page - refresh it and try again.", true);
            return;
          }
          setTimeout(() => sendFillToTab(tabId, data, retriesLeft - 1), 150);
        });
        return;
      }
      setStatus("Can't fill this page - refresh it and try again.", true);
      return;
    }
    const filled = okResponses.reduce((sum, r) => sum + (r.debug?.mainLoopFilled || 0), 0);
    const frames = okResponses.length;
    if (filled) {
      setStatus(`Filled ${filled} field(s) in ${frames} frame(s)`);
    } else {
      setStatus(`Filled (${frames} frame(s), 0 matched)`);
    }
  });
}

// Fill form on active tab
document.getElementById("fillBtn").addEventListener("click", () => {
  chrome.storage.sync.get(fields, (data) => {
    const hasProfile = fields.some(f => data[f]);
    if (!hasProfile) {
      setStatus("Save your settings first.", true);
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        setStatus("No active tab.", true);
        return;
      }
      if (!tab.url || tab.url.startsWith("chrome:") || tab.url.startsWith("edge:")) {
        setStatus("Open the job application page, then try again.", true);
        return;
      }
      messageAllFrames(tab.id, { action: "ping" }, (err, responses) => {
        if (!err && responses.some(r => r?.ok)) {
          sendFillToTab(tab.id, data);
          return;
        }
        injectContentScript(tab.id, () => {
          if (chrome.runtime.lastError) {
            setStatus("Can't fill this page - refresh it and try again.", true);
            return;
          }
          setTimeout(() => sendFillToTab(tab.id, data), 150);
        });
      });
    });
  });
});
