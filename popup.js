const fields = ["firstName","lastName","preferredName","email","phone","address","city","state","zip","linkedin","website","jobTitle","employer","salary","startDate","coverLetter"];

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

// Fill form on active tab
document.getElementById("fillBtn").addEventListener("click", () => {
  chrome.storage.sync.get(fields, (data) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "fill", data });
    });
  });
});
