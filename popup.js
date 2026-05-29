const fields = ["firstName","lastName","preferredName","email","phone","address","city","state","country","zip","linkedin","website","jobTitle","employer","salary","travelAvailability","relocationWillingness","familyWorksAtCompany","priorCompanyRelationship","workAuthorization","workEnvironment","gender","race","disability","veteran","educationLevel","startDate","coverLetter"];
const multiSelectFields = ["workEnvironment"];
const EXPECTED_CONTENT_VERSION = "required-state-sync-v1";
const SHOW_REQUIRED_MARKERS_KEY = "showRequiredMarkers";
let requiredFrameIds = [];
let requiredCountsByFrame = new Map();
let trackedTabId = null;

function setRequiredStatus(count) {
  const requiredStatus = document.getElementById("requiredStatus");
  const nextRequiredBtn = document.getElementById("nextRequiredBtn");
  if (typeof count !== "number") {
    requiredStatus.textContent = "Required left: --";
    nextRequiredBtn.disabled = true;
    return;
  }
  requiredStatus.textContent = `Required left: ${count}`;
  nextRequiredBtn.disabled = count <= 0;
}

function syncRequiredStatusFromFrames() {
  const total = [...requiredCountsByFrame.values()].reduce((sum, count) => sum + count, 0);
  requiredFrameIds = [...requiredCountsByFrame.entries()]
    .filter(([, count]) => count > 0)
    .map(([frameId]) => frameId);
  setRequiredStatus(total);
}

function applyRequiredResponses(responses, onlyIfSyncFlag = false) {
  const okResponses = (responses || []).filter(r => {
    if (!r?.ok) return false;
    if (!onlyIfSyncFlag) return true;
    return Boolean(r.debug?.shouldSyncPopup);
  });
  if (!okResponses.length) return false;
  requiredCountsByFrame = new Map(
    okResponses.map(r => [r.frameId, r.debug?.requiredRemaining ?? 0])
  );
  syncRequiredStatusFromFrames();
  return true;
}

function syncRequiredFromActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab.url || tab.url.startsWith("chrome:") || tab.url.startsWith("edge:")) return;
    trackedTabId = tab.id;
    ensureContentScript(tab.id, (err) => {
      if (err) return;
      messageAllFrames(tab.id, { action: "getRequiredState" }, (err2, responses) => {
        if (err2) return;
        applyRequiredResponses(responses, true);
      });
    });
  });
}

// Load saved settings
chrome.storage.sync.get(fields, (data) => {
  fields.forEach(f => {
    const el = document.getElementById(f);
    if (!el) return;
    if (multiSelectFields.includes(f)) {
      const values = String(data[f] || "").split(",").map(v => v.trim()).filter(Boolean);
      [...el.options].forEach(opt => { opt.selected = values.includes(opt.value); });
      return;
    }
    if (data[f]) el.value = data[f];
  });
});

chrome.storage.sync.get({ [SHOW_REQUIRED_MARKERS_KEY]: true }, (data) => {
  document.getElementById("showRequiredMarkers").checked = Boolean(data[SHOW_REQUIRED_MARKERS_KEY]);
});

// Save
document.getElementById("saveBtn").addEventListener("click", () => {
  const data = {};
  fields.forEach(f => {
    const el = document.getElementById(f);
    if (multiSelectFields.includes(f)) {
      data[f] = [...el.selectedOptions].map(opt => opt.value).join(",");
      return;
    }
    data[f] = el.value;
  });
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
    { target: { tabId, allFrames: true }, files: ["state-aliases.js", "area-code-aliases.js", "content.js"] },
    callback
  );
}

function ensureContentScript(tabId, callback) {
  messageAllFrames(tabId, { action: "ping" }, (err, responses) => {
    const hasMatchingVersion = !err && responses.some(r => r?.ok && r.version === EXPECTED_CONTENT_VERSION);
    if (hasMatchingVersion) {
      callback(null);
      return;
    }
    injectContentScript(tabId, () => {
      if (chrome.runtime.lastError) {
        callback(chrome.runtime.lastError);
        return;
      }
      setTimeout(() => callback(null), 150);
    });
  });
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
          if (!chrome.runtime.lastError && response) responses.push({ ...response, frameId: r.frameId });
          if (--pending === 0) callback(null, responses);
        });
      });
    }
  );
}

function messageFrame(tabId, frameId, message, callback) {
  chrome.tabs.sendMessage(tabId, message, { frameId }, (response) => {
    callback(chrome.runtime.lastError, response);
  });
}

function getShowRequiredMarkers() {
  return document.getElementById("showRequiredMarkers").checked;
}

function sendMarkerPreferenceToTab(tabId, enabled) {
  messageAllFrames(tabId, { action: "setRequiredMarkers", enabled }, () => {});
}

function sendFillToTab(tabId, data, retriesLeft = 2) {
  messageAllFrames(tabId, { action: "fill", data, showRequiredMarkers: getShowRequiredMarkers() }, (err, responses) => {
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
    applyRequiredResponses(okResponses);
    const frames = okResponses.length;
    if (filled) {
      setStatus(`Filled ${filled} field(s) in ${frames} frame(s)`);
    } else {
      setStatus(`Filled (${frames} frame(s), 0 matched)`);
    }
  });
}

function jumpRequiredInFrames(tabId, frameIds, index = 0) {
  if (index >= frameIds.length) {
    requiredCountsByFrame.clear();
    requiredFrameIds = [];
    setRequiredStatus(0);
    return;
  }
  messageFrame(tabId, frameIds[index], { action: "jumpRequired" }, (err, response) => {
    if (err || !response?.ok) {
      jumpRequiredInFrames(tabId, frameIds, index + 1);
      return;
    }
    const requiredRemaining = response.debug?.requiredRemaining || 0;
    requiredCountsByFrame.set(frameIds[index], requiredRemaining);
    if (response.debug?.jumped) {
      syncRequiredStatusFromFrames();
      return;
    }
    requiredCountsByFrame.set(frameIds[index], 0);
    syncRequiredStatusFromFrames();
    jumpRequiredInFrames(tabId, frameIds, index + 1);
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
      trackedTabId = tab.id;
      ensureContentScript(tab.id, (err) => {
        if (err) {
          setStatus("Can't fill this page - refresh it and try again.", true);
          return;
        }
        sendFillToTab(tab.id, data);
      });
    });
  });
});

document.getElementById("showRequiredMarkers").addEventListener("change", () => {
  const enabled = getShowRequiredMarkers();
  chrome.storage.sync.set({ [SHOW_REQUIRED_MARKERS_KEY]: enabled });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab.url || tab.url.startsWith("chrome:") || tab.url.startsWith("edge:")) return;
    ensureContentScript(tab.id, (err) => {
      if (err) {
        setStatus("Can't update markers on this page - refresh it and try again.", true);
        return;
      }
      sendMarkerPreferenceToTab(tab.id, enabled);
    });
  });
});

document.getElementById("nextRequiredBtn").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !requiredFrameIds.length) {
      requiredCountsByFrame.clear();
      setRequiredStatus(0);
      return;
    }
    trackedTabId = tab.id;
    jumpRequiredInFrames(tab.id, [...requiredFrameIds]);
  });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action !== "requiredStateUpdated") return;
  if (sender.tab?.id == null) return;
  if (trackedTabId != null && sender.tab.id !== trackedTabId) return;
  trackedTabId = sender.tab.id;
  requiredCountsByFrame.set(sender.frameId ?? 0, msg.requiredRemaining ?? 0);
  syncRequiredStatusFromFrames();
});

syncRequiredFromActiveTab();
