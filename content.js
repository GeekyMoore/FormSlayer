(() => {
const fieldMap = {
  firstName:   ["first name", "first_name", "fname", "given name", "legal first", "preferred first"],
  preferredName: ["preferred name", "preferred first name", "goes by", "nickname", "full name", "fullname"],
  lastName:    ["last name", "last_name", "lname", "surname", "family name", "legal last"],
  email:       ["email", "e-mail"],
  phone:       ["phone", "phone number", "mobile number", "cell", "telephone"],
  address:     ["address", "street"],
  city:        ["city", "town", "location"],
  state:       ["state", "province", "region"],
  zip:         ["zip", "zip code", "postal", "postcode"],
  linkedin:    ["linkedin", "linkedin profile", "linkedin url", "linkedin profile url"],
  website:     ["personal website", "portfolio", "personal site", "share your portfolio"],
  jobTitle:    ["job title", "current title", "recent job title", "position", "current position"],
  employer:    ["employer", "company", "recent employer", "current employer", "current company", "organization"],
  salary:      ["salary", "compensation", "expected salary", "salary expectation", "pay expectation", "salary expectations", "desired annual base salary", "annual base salary", "desired base salary", "base salary"],
  travelAvailability: ["travel availability", "willingness to travel", "travel requirement", "travel percentage", "percent travel", "% travel", "travel (percent)", "travel up to"],
  educationLevel: ["education", "education level", "highest education", "degree", "highest degree"],
  startDate:   ["start date", "available to start", "when can you start", "availability", "available start"],
  coverLetter: ["cover letter"],
  familyWorksAtCompany: ["anyone in your family", "in your family currently work", "family member employed", "family member work", "know anyone who works", "relative employed", "related to an employee", "former employee at", "currently employed by a company who uses", "employed by a company who uses", "affiliated brands"],
  priorCompanyRelationship: ["have you ever worked at", "have you ever worked for", "do you currently work at", "do you currently work for", "have you ever applied", "ever applied to", "ever applied at", "previously applied", "worked here before", "prior employment with"]
};

function normalizeTravelBucket(value) {
  if (!value) return null;
  const str = String(value).toLowerCase();
  if (str.includes("0-25")) return "0-25%";
  if (str.includes("25-50")) return "25-50%";
  if (str.includes("50-75")) return "50-75%";
  if (str.includes("75-100")) return "75-100%";
  // Fallback: parse any percentages/ranges and use the highest % mentioned.
  const matches = [...str.matchAll(/(\d+)\s*%?/g)];
  if (!matches.length) return null;
  const nums = matches
    .map(m => parseInt(m[1], 10))
    .filter(n => !Number.isNaN(n));
  if (!nums.length) return null;
  const max = Math.max(...nums);
  if (max <= 25) return "0-25%";
  if (max <= 50) return "25-50%";
  if (max <= 75) return "50-75%";
  return "75-100%";
}

function bucketFromText(text) {
  if (!text) return null;
  const str = text.toLowerCase();
  // Capture up to two percentage-like numbers
  const matches = [...str.matchAll(/(\d+)\s*%?/g)];
  if (!matches.length) return null;
  let min = 0;
  let max = 0;
  if (matches.length === 1) {
    max = parseInt(matches[0][1], 10);
  } else {
    min = parseInt(matches[0][1], 10);
    max = parseInt(matches[1][1], 10);
  }
  if (Number.isNaN(max)) return null;
  // Use the upper bound to decide bucket; treat 0-5, 0-10, 0-20, 0-25 all as 0-25%
  if (max <= 25) return "0-25%";
  if (max <= 50) return "25-50%";
  if (max <= 75) return "50-75%";
  return "75-100%";
}

function cleanLabelText(text) {
  if (!text) return "";
  const cleaned = String(text).toLowerCase().replace(/\s+/g, " ").trim();
  if (!/[a-z0-9]/.test(cleaned)) return "";
  if (/^(required|\*|required \*)$/.test(cleaned)) return "";
  return cleaned;
}

function getLabel(el) {
  // Try associated <label>
  if (el.id) {
    const lbl = document.querySelector(`label[for="${el.id}"]`);
    const text = cleanLabelText(lbl?.innerText);
    if (text) return text;
  }
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = cleanLabelText(labelledBy
      .split(/\s+/)
      .map(id => document.getElementById(id)?.innerText?.trim())
      .filter(Boolean)
      .join(" "));
    if (text) return text;
  }
  // Try parent <label>
  const parentLabel = el.closest("label");
  const parentLabelText = cleanLabelText(parentLabel?.innerText);
  if (parentLabelText) return parentLabelText;
  // Gem / SPA forms: question text in a sibling block (span may be nested, not a direct child)
  let node = el;
  for (let depth = 0; depth < 5 && node; depth++) {
    const parent = node.parentElement;
    if (!parent) break;
    const fieldBlock = [...parent.children].find(c => c.contains(el));
    if (fieldBlock) {
      for (const sibling of parent.children) {
        if (sibling === fieldBlock) continue;
        const directText = cleanLabelText(sibling.innerText);
        if (directText && directText.length < 200) return directText;
        const labelEl = sibling.querySelector("span, label, legend, p, [class*='label'], [class*='Label']");
        const text = cleanLabelText(labelEl?.innerText);
        if (text && text.length < 200) return text;
      }
    }
    node = parent;
  }
  // Label text in preceding sibling (common on Gem / SPA field rows)
  let prev = el.previousElementSibling;
  for (let i = 0; i < 3 && prev; i++, prev = prev.previousElementSibling) {
    const t = cleanLabelText(prev.innerText);
    if (t && t.length < 200) return t;
  }
  // Try aria-label
  const ariaLabel = cleanLabelText(el.getAttribute("aria-label"));
  if (ariaLabel) return ariaLabel;
  // Try placeholder
  const placeholder = cleanLabelText(el.placeholder);
  if (placeholder) return placeholder;
  // Try name or id
  return cleanLabelText((el.name || el.id || "").replace(/[-_]/g, " "));
}

function getMatchHaystack(el) {
  const parts = [getLabel(el)];
  if (el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
  if (el.placeholder) parts.push(el.placeholder);
  if (el.name) parts.push(el.name.replace(/[-_]/g, " "));
  if (el.id) parts.push(el.id.replace(/[-_]/g, " "));
  if (el.autocomplete) parts.push(el.autocomplete);
  return parts.join(" ").toLowerCase();
}

const FILLABLE_SELECTOR = "input:not([type=hidden]):not([type=submit]):not([type=file]), textarea, select, [contenteditable='true'], [contenteditable='']";

function collectAll(selector) {
  const seen = new Set();
  const out = [];
  const addAll = (root) => {
    try {
      root.querySelectorAll(selector).forEach(el => {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      });
    } catch (_) {}
  };
  function walk(node) {
    if (!node) return;
    addAll(node);
    if (node.shadowRoot) walk(node.shadowRoot);
    for (const child of node.children || []) walk(child);
  }
  addAll(document);
  for (const child of document.children || []) walk(child);
  return out;
}

function collectFillable() {
  return collectAll(FILLABLE_SELECTOR);
}

const CHOICE_SELECTOR = "input[type=radio], input[type=checkbox]";

function forEachChoice(callback) {
  document.querySelectorAll(CHOICE_SELECTOR).forEach(callback);
}

function whenFormReady(run, maxWaitMs = 8000) {
  let debounceTimer;
  let maxTimer;
  let ran = false;
  let observer;
  let lastCount = -1;
  let stablePasses = 0;
  const execute = () => {
    if (ran) return;
    ran = true;
    observer?.disconnect();
    clearTimeout(debounceTimer);
    clearTimeout(maxTimer);
    run();
  };
  const schedule = () => {
    if (ran) return;
    const count = collectFillable().length;
    if (count > 0 && count === lastCount) stablePasses++;
    else stablePasses = 0;
    lastCount = count;
    clearTimeout(debounceTimer);
    if (stablePasses >= 2 && count > 0) {
      execute();
      return;
    }
    debounceTimer = setTimeout(execute, 500);
  };
  schedule();
  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  maxTimer = setTimeout(execute, maxWaitMs);
}

const autocompleteHints = {
  firstName: ["given-name"],
  lastName: ["family-name"],
  email: ["email"],
  phone: ["tel", "phone"],
  address: ["street-address", "address-line1"],
  city: ["address-level2"],
  state: ["address-level1"],
  zip: ["postal-code"]
};

function keywordMatches(haystack, keyword) {
  const normalizedKeyword = String(keyword).toLowerCase().replace(/[_-]/g, " ").trim();
  if (!normalizedKeyword) return false;
  const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
}

function matchField(el) {
  const haystack = getMatchHaystack(el).replace(/[_-]/g, " ");

  for (const [key, keywords] of Object.entries(fieldMap)) {
    if (keywords.some(k => keywordMatches(haystack, k))) return key;
    const hints = autocompleteHints[key];
    if (hints?.some(h => keywordMatches(haystack, h))) return key;
  }
  return null;
}

function isYearsExperienceQuantityQuestion(text) {
  if (!text) return false;
  const normalized = String(text).toLowerCase().replace(/\s+/g, " ");
  return (
    /\bhow many\b.*\byears?\b.*\bexperience\b/.test(normalized) ||
    /\b(number|#)\s+of\b.*\byears?\b.*\bexperience\b/.test(normalized) ||
    /\btotal\b.*\byears?\b.*\bexperience\b/.test(normalized)
  );
}

function getQuestionText(el) {
  let text = getLabel(el);
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const t = (node.innerText || "").toLowerCase();
    if (t.length > text.length && t.length < 800) text = t;
  }
  return text;
}

function getNearbyQuestionText(el) {
  const parts = [getLabel(el), getFieldQuestionText(el)];
  for (let node = el.parentElement, depth = 0; node && node !== document.body && depth < 6; node = node.parentElement, depth++) {
    const nodeText = cleanLabelText(node.innerText);
    if (nodeText && nodeText.length < 300) parts.push(nodeText);

    let prev = node.previousElementSibling;
    for (let i = 0; i < 3 && prev; i++, prev = prev.previousElementSibling) {
      const prevText = cleanLabelText(prev.innerText);
      if (prevText && prevText.length < 300) parts.push(prevText);
    }
  }
  return [...new Set(parts.filter(Boolean))].join(" ");
}

function isWorkAuthQuestion(text) {
  if (!text) return false;
  return (
    text.includes("work authorization") ||
    text.includes("authorized to work") ||
    text.includes("legally authorized to work") ||
    /legally\s+authorized/.test(text) ||
    (text.includes("authorization") && text.includes("united states"))
  );
}

function isWorkAuthStatusQuestion(text) {
  if (!text) return false;
  return /\bwork authorization status\b/.test(text) || /\bauthorization status\b/.test(text);
}

function isSponsorshipRequiredQuestion(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (/currently.*future.*require.*visa sponsorship/.test(t)) return true;
  if (/will you.*future.*require.*visa sponsorship/.test(t)) return true;
  if (/employer[- ]sponsored/.test(t) && t.includes("authorization")) return true;
  if ((t.includes("sponsor") || t.includes("sponsorship")) &&
      (t.includes("require") || t.includes("need") || /now or in the future/.test(t))) {
    return true;
  }
  if (t.includes("visa sponsorship") && (t.includes("require") || t.includes("need") || t.includes("will you"))) {
    return true;
  }
  return false;
}

function isWorkAuthYesNoQuestion(text) {
  return isWorkAuthQuestion(text) && !isWorkAuthStatusQuestion(text) && !isSponsorshipRequiredQuestion(text);
}

function shouldApplyWorkAuthSetting(questionText) {
  return isWorkAuthYesNoQuestion(questionText) || isSponsorshipRequiredQuestion(questionText);
}

// Authorized in the US → no sponsorship needed; not authorized → yes sponsorship needed.
function workAuthAnswerForQuestion(workAuthPref, questionText) {
  if (isSponsorshipRequiredQuestion(questionText)) {
    return workAuthPref === "yes" ? "no" : "yes";
  }
  return workAuthPref;
}

function getFieldQuestionText(el) {
  const scoped = el.closest("fieldset,[role=group],li,.question,.form-group,.field,.form-question,.select__container,.select");
  if (scoped) {
    const t = (scoped.innerText || "").toLowerCase().trim();
    if (t.length > 0 && t.length < 400) return t;
  }
  const label = getLabel(el);
  if (isWorkAuthQuestion(label)) return label;
  let text = label;
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const t = (node.innerText || "").toLowerCase().trim();
    if (t.length > text.length && t.length < 400) text = t;
  }
  return text;
}

function workAuthYesOption(label, value) {
  const l = label.toLowerCase();
  const v = (value || "").toLowerCase();
  if (l.includes("yes") || v === "yes") return true;
  return l.includes("authorized") && !/not authorized|not eligible|no authorization/.test(l);
}

function workAuthNoOption(label, value) {
  const l = label.toLowerCase();
  const v = (value || "").toLowerCase();
  if (l.includes("no") || v === "no") return true;
  return /not authorized|not eligible|no authorization|require sponsorship|need sponsorship/.test(l);
}

function fillInput(el, value) {
  const stringValue = value == null ? "" : String(value).trim();
  el.focus();
  if (el.isContentEditable) {
    el.textContent = stringValue;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: stringValue }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    el.blur();
    return;
  }
  const proto = el.tagName === "TEXTAREA"
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

  if (el._valueTracker) el._valueTracker.setValue("");
  if (valueSetter) {
    valueSetter.call(el, stringValue);
  } else {
    el.value = stringValue;
  }
  el.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: stringValue
  }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.blur();
}

function normalizePreference(data, key) {
  return String(data[key] || "").toLowerCase().trim();
}

function getChoiceContext(el) {
  return {
    label: getLabel(el),
    parentText: (el.closest("fieldset, div, li, p") || el.parentElement)?.innerText?.toLowerCase() || "",
    value: (el.value || "").toLowerCase()
  };
}

function clickChoiceIfMatches(el, pref, label, value) {
  if (!pref) return false;
  if (label.includes(pref) || value === pref) {
    el.click();
    return true;
  }
  return false;
}

function setSelectOption(el, matcher) {
  const opt = [...el.options].find(matcher);
  if (!opt) return false;
  el.value = opt.value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function dispatchKey(el, key) {
  el.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    code: key,
    bubbles: true,
    cancelable: true
  }));
}

function setComboboxOption(el, text) {
  const input = el.tagName === "INPUT" ? el : el.querySelector("input[role='combobox']");
  if (!input) return false;
  const control = input.closest(".select__control") || input;
  control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
  control.click();
  input.focus();
  input.click();
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (valueSetter) valueSetter.call(input, text);
  else input.value = text;
  input.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: text
  }));
  dispatchKey(input, "ArrowDown");
  dispatchKey(input, "Enter");
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.blur();
  return true;
}

function runFill(data) {
  // "Do you have at least X years of..." — click Yes
  forEachChoice(el => {
    const { label, parentText, value } = getChoiceContext(el);
    if (/at least \d+ years?/.test(parentText) || /\d+\+ years? of experience/.test(parentText)) {
      if (label.includes("yes") || value === "yes") {
        el.click();
      }
    }
  });

  // Visa sponsorship fallback — only when US Work Authorization is not set (sponsorship-required questions use that setting).
  const workAuthPrefForPolicy = normalizePreference(data, "workAuthorization");
  forEachChoice(el => {
    if (workAuthPrefForPolicy) return;
    const questionText = getNearbyQuestionText(el);
    const { label, parentText, value } = getChoiceContext(el);
    if (isSponsorshipRequiredQuestion(questionText) || parentText.includes("sponsor") || label.includes("sponsor")) {
      if (label.includes("no") || value === "no") {
        el.click();
      }
    }
  });
  document.querySelectorAll("select").forEach(el => {
    if (workAuthPrefForPolicy) return;
    const questionText = getNearbyQuestionText(el);
    const matchesSponsorship = isSponsorshipRequiredQuestion(questionText);
    if (!matchesSponsorship) return;
    setSelectOption(el, o => workAuthNoOption(o.text, o.value));
  });
  document.querySelectorAll("input[role='combobox']").forEach(el => {
    if (workAuthPrefForPolicy) return;
    const questionText = getFieldQuestionText(el);
    const matchesSponsorship = isSponsorshipRequiredQuestion(questionText);
    if (!matchesSponsorship) return;
    setComboboxOption(el, "No");
  });

  // Valid driver's license — find the question context and click "Yes"
  forEachChoice(el => {
    const { label, parentText, value } = getChoiceContext(el);
    const isDriverLicenseQuestion =
      /driver'?s?\s+license/.test(parentText) ||
      /driver'?s?\s+license/.test(label) ||
      (parentText.includes("drivers") && parentText.includes("license")) ||
      (label.includes("drivers") && label.includes("license"));

    if (isDriverLicenseQuestion) {
      if (label.includes("yes") || value === "yes") {
        el.click();
      }
    }
  });

  // US work authorization — only answer yes/no controls; status/details prompts need a dedicated setting.
  const workAuthClickedGroups = new Set();
  const workAuthPref = normalizePreference(data, "workAuthorization");
  if (workAuthPref) {
    forEachChoice(el => {
      const questionText = getNearbyQuestionText(el);
      if (!shouldApplyWorkAuthSetting(questionText)) return;
      const groupKey = el.name || questionText.slice(0, 120);
      if (workAuthClickedGroups.has(groupKey)) return;
      const answer = workAuthAnswerForQuestion(workAuthPref, questionText);
      const { label } = getChoiceContext(el);
      const value = el.value || "";
      const matches = answer === "yes"
        ? workAuthYesOption(label, value)
        : workAuthNoOption(label, value);
      if (matches) {
        el.click();
        workAuthClickedGroups.add(groupKey);
      }
    });
    document.querySelectorAll("select").forEach(el => {
      const questionText = getNearbyQuestionText(el);
      const shouldApply = shouldApplyWorkAuthSetting(questionText);
      const groupKey = "select:" + questionText.slice(0, 120);
      if (!shouldApply) return;
      if (workAuthClickedGroups.has(groupKey)) return;
      const answer = workAuthAnswerForQuestion(workAuthPref, questionText);
      const changed = answer === "yes"
        ? setSelectOption(el, o => workAuthYesOption(o.text, o.value))
        : setSelectOption(el, o => workAuthNoOption(o.text, o.value));
      if (changed) {
        workAuthClickedGroups.add(groupKey);
      }
    });
    document.querySelectorAll("input[role='combobox']").forEach(el => {
      const questionText = getFieldQuestionText(el);
      const shouldApply = shouldApplyWorkAuthSetting(questionText);
      const groupKey = "combobox:" + (el.name || el.id || questionText.slice(0, 120));
      const answer = workAuthAnswerForQuestion(workAuthPref, questionText);
      if (!shouldApply) return;
      if (workAuthClickedGroups.has(groupKey)) return;
      const changed = setComboboxOption(el, answer === "yes" ? "Yes" : "No");
      if (changed) workAuthClickedGroups.add(groupKey);
    });
  }

  const choiceSettings = [
    {
      key: "relocationWillingness",
      matchesQuestion: (label, parentText) => parentText.includes("relocate") || label.includes("relocate")
    },
    {
      key: "gender",
      matchesQuestion: (label, parentText) => parentText.includes("gender") || label.includes("gender")
    },
    {
      key: "race",
      matchesQuestion: (label, parentText) =>
        parentText.includes("race") ||
        parentText.includes("ethnicity") ||
        label.includes("race") ||
        label.includes("ethnicity")
    },
    {
      key: "disability",
      matchesQuestion: (label, parentText) => parentText.includes("disability") || label.includes("disability")
    },
    {
      key: "veteran",
      matchesQuestion: (label, parentText) => parentText.includes("veteran") || label.includes("veteran")
    }
  ];

  choiceSettings.forEach(({ key, matchesQuestion }) => {
    const pref = normalizePreference(data, key);
    if (!pref) return;
    forEachChoice(el => {
      const { label, parentText, value } = getChoiceContext(el);
      if (!matchesQuestion(label, parentText)) return;
      clickChoiceIfMatches(el, pref, label, value);
    });
  });

  // Family / prior company — radios, selects, or free-text (e.g. Gem forms type "No" in a text field)
  document.querySelectorAll("input[type=radio], input[type=checkbox], input[type=text], textarea, select").forEach(el => {
    const label = getLabel(el);
    const text = el.type === "text" || el.tagName === "TEXTAREA" ? label : getQuestionText(el);
    const key = ["familyWorksAtCompany", "priorCompanyRelationship"].find(
      k => data[k] && fieldMap[k].some(phrase => text.includes(phrase))
    );
    if (!key) return;
    const pref = String(data[key]).toLowerCase().trim();
    if (el.type === "text" || el.tagName === "TEXTAREA") {
      fillInput(el, pref);
      return;
    }
    if (el.tagName === "SELECT") {
      setSelectOption(el, o => o.text.toLowerCase().includes(pref) || (o.value || "").toLowerCase() === pref);
      return;
    }
    clickChoiceIfMatches(el, pref, label, (el.value || "").toLowerCase());
  });

  let mainLoopFilled = 0;
  const fillableNow = collectFillable();
  fillableNow.forEach(el => {
    const questionText = getFieldQuestionText(el);
    if (isYearsExperienceQuantityQuestion(questionText)) return;
    const key = matchField(el);
    if (!key || !data[key] || key === "familyWorksAtCompany" || key === "priorCompanyRelationship") return;
    mainLoopFilled++;
    if (el.tagName === "SELECT") {
        let opt;
        if (key === "travelAvailability") {
          const desiredBucket = normalizeTravelBucket(data[key]);
          if (desiredBucket) {
            opt = [...el.options].find(o => bucketFromText(o.text) === desiredBucket);
          }
          // Fallback to substring match if bucket logic didn't find anything
          if (!opt) {
            const raw = String(data[key]).toLowerCase();
            opt = [...el.options].find(o => o.text.toLowerCase().includes(raw));
          }
        } else {
          opt = [...el.options].find(o => o.text.toLowerCase().includes(data[key].toLowerCase()));
        }
        if (opt) setSelectOption(el, o => o === opt);
    } else {
      fillInput(el, data[key]);
    }
  });
  return { mainLoopFilled, inputsCount: fillableNow.length };
}

function onFillMessage(msg, _sender, sendResponse) {
  if (msg.action === "ping") {
    sendResponse({ ok: true });
    return;
  }
  if (msg.action === "fill") {
    const payload = msg.data;
    whenFormReady(() => sendResponse({ ok: true, debug: runFill(payload) }));
    return true;
  }
}

if (window.__formSlayerOnFillMessage) {
  chrome.runtime.onMessage.removeListener(window.__formSlayerOnFillMessage);
}
window.__formSlayerOnFillMessage = onFillMessage;
chrome.runtime.onMessage.addListener(onFillMessage);
})();
