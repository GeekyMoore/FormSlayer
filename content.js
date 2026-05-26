const fieldMap = {
  firstName:   ["first name", "first_name", "fname", "given name"],
  preferredName: ["preferred name", "preferred first name", "goes by", "nickname"],
  lastName:    ["last name", "last_name", "lname", "surname", "family name"],
  email:       ["email", "e-mail"],
  phone:       ["phone", "mobile", "cell", "telephone"],
  address:     ["address", "street", "addr"],
  city:        ["city", "town"],
  state:       ["state", "province", "region"],
  zip:         ["zip", "postal", "postcode"],
  linkedin:    ["linkedin", "linkedin profile", "linkedin url", "linkedin profile url"],
  website:     ["website", "portfolio", "url", "personal site", "share your portfolio"],
  jobTitle:    ["job title", "current title", "recent job title", "position", "current position"],
  employer:    ["employer", "company", "recent employer", "current employer", "current company", "organization"],
  salary:      ["salary", "compensation", "expected salary", "salary expectation", "pay expectation", "salary expectations"],
  startDate:   ["start date", "available to start", "when can you start", "availability", "available start"],
  coverLetter: ["cover letter", "coverletter", "cover_letter", "message", "additional info", "additional information"]
};

function getLabel(el) {
  // Try associated <label>
  if (el.id) {
    const lbl = document.querySelector(`label[for="${el.id}"]`);
    if (lbl) return lbl.innerText.toLowerCase().trim();
  }
  // Try parent <label>
  const parentLabel = el.closest("label");
  if (parentLabel) return parentLabel.innerText.toLowerCase().trim();
  // Try aria-label
  if (el.getAttribute("aria-label")) return el.getAttribute("aria-label").toLowerCase();
  // Try placeholder
  if (el.placeholder) return el.placeholder.toLowerCase();
  // Try name or id
  return (el.name || el.id || "").toLowerCase().replace(/[-_]/g, " ");
}

function matchField(el) {
  const label = getLabel(el);
  for (const [key, keywords] of Object.entries(fieldMap)) {
    if (keywords.some(k => label.includes(k))) return key;
  }
  return null;
}

function fillInput(el, value) {
  const stringValue = value == null ? "" : String(value).trim();
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;

  el.focus();
  if (valueSetter) {
    valueSetter.call(el, stringValue);
  } else {
    el.value = stringValue;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.blur();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== "fill") return;
  const { data } = msg;

  const inputs = document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=file]), textarea, select");

  // "Do you have at least X years of..." — click Yes
  document.querySelectorAll("input[type=radio], input[type=checkbox]").forEach(el => {
    const label = getLabel(el);
    const parentText = (el.closest("fieldset, div, li, p") || el.parentElement)?.innerText?.toLowerCase() || "";
    if (/at least \d+ years?/.test(parentText) || /\d+\+ years? of experience/.test(parentText)) {
      if (label.includes("yes") || el.value?.toLowerCase() === "yes") {
        el.click();
      }
    }
  });

  // Visa sponsorship — find any radio/checkbox near "sponsorship" and click "No"
  document.querySelectorAll("input[type=radio], input[type=checkbox]").forEach(el => {
    const label = getLabel(el);
    const parentText = (el.closest("fieldset, div, li, p") || el.parentElement)?.innerText?.toLowerCase() || "";
    if (parentText.includes("sponsor") || label.includes("sponsor")) {
      if (label.includes("no") || el.value?.toLowerCase() === "no") {
        el.click();
      }
    }
  });

  inputs.forEach(el => {
    const key = matchField(el);
    if (key && data[key]) {
      if (el.tagName === "SELECT") {
        const opt = [...el.options].find(o => o.text.toLowerCase().includes(data[key].toLowerCase()));
        if (opt) { el.value = opt.value; el.dispatchEvent(new Event("change", { bubbles: true })); }
      } else {
        fillInput(el, data[key]);
      }
    }
  });
});
