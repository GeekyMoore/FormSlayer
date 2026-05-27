(() => {
const CONTENT_SCRIPT_VERSION = "required-markers-v1";
const fieldMap = {
  firstName:   ["first name", "first_name", "fname", "given name", "legal first", "preferred first"],
  lastName:    ["last name", "last_name", "lname", "surname", "family name", "legal last"],
  email:       ["email", "e-mail"],
  phone:       ["phone", "phone number", "mobile number", "cell", "telephone"],
  address:     ["address", "street"],
  city:        ["city", "town", "location"],
  country:     ["country", "country/region", "country of residence", "country you currently reside", "country you reside", "nation"],
  state:       ["state", "state/region", "province", "region"],
  zip:         ["zip", "zip code", "postal", "postcode"],
  linkedin:    ["linkedin", "linkedin profile", "linkedin url", "linkedin profile url"],
  website:     ["personal website", "portfolio", "personal site", "share your portfolio"],
  jobTitle:    ["job title", "current title", "recent job title", "position", "current position"],
  employer:    ["employer", "company", "company name", "recent employer", "current employer", "current company", "organization"],
  preferredName: ["preferred name", "preferred first name", "goes by", "nickname", "full name", "fullname", "name"],
  salary:      ["salary", "compensation", "expected salary", "salary expectation", "pay expectation", "salary expectations", "desired annual base salary", "annual base salary", "desired base salary", "base salary"],
  travelAvailability: ["travel availability", "willingness to travel", "travel requirement", "travel percentage", "percent travel", "% travel", "travel (percent)", "travel up to"],
  educationLevel: ["education", "education level", "highest education", "degree", "highest degree"],
  startDate:   ["start date", "available to start", "when can you start", "availability", "available start"],
  coverLetter: ["cover letter"],
  familyWorksAtCompany: ["anyone in your family", "in your family currently work", "family member employed", "family member work", "know anyone who works", "relative employed", "related to an employee", "former employee at", "currently employed by a company who uses", "employed by a company who uses", "affiliated brands"],
  priorCompanyRelationship: ["have you ever worked at", "have you ever worked for", "previously worked at any", "previously worked at", "previously been directly employed", "been directly employed", "directly employed by", "worked at any entity", "do you currently work at", "do you currently work for", "have you ever applied", "ever applied to", "ever applied at", "previously applied", "worked here before", "prior employment with"]
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
  // SPA forms: question text in a sibling block (span may be nested, not a direct child)
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
  // Label text in preceding sibling (common on SPA field rows)
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

const FILLABLE_SELECTOR = "input:not([type=submit]):not([type=file]):not([type=button]):not([type=reset]), textarea, select, [contenteditable='true'], [contenteditable='']";

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
const requiredJumpState = {
  fields: [],
  index: 0
};
const requiredMarkerState = {
  enabled: true,
  refreshTimer: null
};

const REQUIRED_MARKER_STYLE_ID = "formslayer-required-marker-style";
const REQUIRED_MARKER_CLASS = "formslayer-required-marker-target";
const REQUIRED_MARKER_ATTR = "data-formslayer-required-marker-target";

function forEachChoice(callback) {
  document.querySelectorAll(CHOICE_SELECTOR).forEach(callback);
}

function isSkippableRequiredCandidate(el) {
  const type = (el?.type || "").toLowerCase();
  return !el || el.disabled || el.readOnly || ["submit", "button", "reset", "file"].includes(type);
}

function hasRequiredMarker(text) {
  return /\*/.test(String(text || ""));
}

function getQuestionScope(el) {
  return el.closest("fieldset,[role=group],[role='radiogroup'],li,.question,.form-group,.field,.form-question,.select__container,.select,.application-question,.questionnaire-question");
}

function getRequiredTextCandidates(el) {
  const parts = [];
  const pushText = (text, maxLen = 250) => {
    const value = String(text || "").trim();
    if (value && value.length < maxLen) parts.push(value);
  };
  if (el.id) {
    pushText(document.querySelector(`label[for="${el.id}"]`)?.innerText);
  }
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    pushText(labelledBy
      .split(/\s+/)
      .map(id => document.getElementById(id)?.innerText?.trim())
      .filter(Boolean)
      .join(" "));
  }
  pushText(el.closest("label")?.innerText);
  const scoped = getQuestionScope(el);
  if (scoped) {
    scoped
      .querySelectorAll("label, legend, [class*='label'], [class*='Label'], [class*='question'], [class*='Question']")
      .forEach(node => pushText(node.innerText));
  }
  let prev = el.previousElementSibling;
  for (let i = 0; i < 3 && prev; i++, prev = prev.previousElementSibling) {
    pushText(prev.innerText);
  }
  return parts;
}

function hasRequiredSignal(el) {
  if (!el || isSkippableRequiredCandidate(el)) return false;
  const type = (el.type || "").toLowerCase();
  return (
    el.required ||
    el.hasAttribute("required") ||
    (el.getAttribute("aria-required") || "").toLowerCase() === "true" ||
    Boolean(el.validity?.valueMissing) ||
    (type !== "hidden" && getRequiredTextCandidates(el).some(hasRequiredMarker))
  );
}

function isFieldAnswered(el) {
  const tag = el.tagName;
  const type = (el.type || "").toLowerCase();
  if (type === "radio" || type === "checkbox") return el.checked;
  if (tag === "SELECT") {
    const idx = el.selectedIndex;
    if (idx < 0) return false;
    const value = String(el.value || "").trim();
    const selectedText = String(el.options?.[idx]?.text || "").toLowerCase().trim();
    return Boolean(value) && !/^(select|choose|please select|not set)\b/.test(selectedText);
  }
  if ((el.getAttribute("role") || "").toLowerCase() === "combobox") {
    const value = String(el.value || el.getAttribute("aria-valuetext") || el.textContent || "").trim();
    return value !== "";
  }
  if (el.isContentEditable) return String(el.textContent || "").trim() !== "";
  return String(el.value || "").trim() !== "";
}

function getJumpTarget(el) {
  const type = (el.type || "").toLowerCase();
  if (type !== "hidden") return el;
  const scope = getQuestionScope(el) || el.parentElement;
  if (!scope) return el;
  return scope.querySelector("[role='combobox'], input[role='combobox'], select, textarea, input:not([type=hidden])") || el;
}

function getRequiredItemKey(el, target) {
  const type = (el.type || "").toLowerCase();
  if (type === "file") {
    const scope = getQuestionScope(el);
    const scopeKey = scope
      ? (scope.id || scope.getAttribute("data-qa") || cleanLabelText(scope.innerText).slice(0, 120))
      : "";
    if (scopeKey) return `file:scope:${scopeKey}`;
    return `file:${el.form?.id || ""}:${el.name || ""}:${target.id || ""}`;
  }
  if (type === "radio" || type === "checkbox") {
    return `choice:${type}:${el.form?.id || ""}:${el.name || ""}:${getFieldQuestionText(el).slice(0, 120)}`;
  }
  const scope = getQuestionScope(el);
  const scopeKey = scope
    ? (scope.id || scope.getAttribute("data-qa") || cleanLabelText(scope.innerText).slice(0, 120))
    : "";
  if (scopeKey) return `field:scope:${scopeKey}`;
  return `field:${el.tagName}:${type}:${el.name || ""}:${target.id || ""}`;
}

function collectRequiredFieldState(fields = collectFillable()) {
  const itemMap = new Map();
  const seenChoiceGroups = new Set();
  const upsertItem = (key, target, answered) => {
    const existing = itemMap.get(key);
    itemMap.set(key, { key, target, answered: Boolean(existing?.answered || answered) });
  };

  for (const el of fields) {
    if (isSkippableRequiredCandidate(el)) continue;
    const type = (el.type || "").toLowerCase();

    if (type === "radio" || type === "checkbox") {
      const key = getRequiredItemKey(el, el);
      if (seenChoiceGroups.has(key)) continue;
      seenChoiceGroups.add(key);
      const group = getChoiceGroup(el);
      if (!group.some(hasRequiredSignal)) continue;
      upsertItem(key, getJumpTarget(el), group.some(candidate => candidate.checked));
      continue;
    }

    if (!hasRequiredSignal(el)) continue;
    const target = getJumpTarget(el);
    upsertItem(getRequiredItemKey(el, target), target, isFieldAnswered(el));
  }

  const fileInputs = [...document.querySelectorAll("input[type='file']")];
  for (const fileInput of fileInputs) {
    const hasSignal = hasRequiredSignal(fileInput) || getRequiredTextCandidates(fileInput).some(hasRequiredMarker);
    if (!hasSignal) continue;
    const scope = getQuestionScope(fileInput) || fileInput.closest(".field,.form-group,.question,[class*='upload'],[class*='Upload']");
    const visibleTarget = scope || fileInput.parentElement || fileInput;
    const answered = Boolean(fileInput.files && fileInput.files.length > 0);
    upsertItem(getRequiredItemKey(fileInput, visibleTarget), visibleTarget, answered);
  }

  const unansweredTargets = [];
  const seenTargets = new Set();
  let total = 0;
  let answered = 0;
  for (const { target, answered: isAnswered } of itemMap.values()) {
    total++;
    if (isAnswered) {
      answered++;
      continue;
    }
    if (!seenTargets.has(target)) {
      seenTargets.add(target);
      unansweredTargets.push(target);
    }
  }
  return { total, answered, remaining: total - answered, unansweredTargets };
}

function getChoiceGroup(el) {
  const type = (el.type || "").toLowerCase();
  if (type !== "radio" && type !== "checkbox") return [el];
  if (!el.name) return [el];
  return [...document.querySelectorAll(`input[type="${type}"]`)]
    .filter(candidate => candidate.name === el.name && candidate.form === el.form);
}

function collectUnfilledRequiredFields(fields = collectFillable()) {
  return collectRequiredFieldState(fields).unansweredTargets;
}

function refreshRequiredJumpState(fields) {
  const state = collectRequiredFieldState(fields);
  requiredJumpState.fields = state.unansweredTargets;
  if (requiredJumpState.index >= requiredJumpState.fields.length) requiredJumpState.index = 0;
  return state;
}

function ensureRequiredMarkerStyle() {
  if (document.getElementById(REQUIRED_MARKER_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = REQUIRED_MARKER_STYLE_ID;
  style.textContent = `
    .${REQUIRED_MARKER_CLASS} {
      outline: 2px solid #f97316 !important;
      box-shadow: 0 0 0 4px rgba(249, 115, 22, 0.18) !important;
      border-radius: 4px !important;
    }
  `;
  document.documentElement.appendChild(style);
}

function clearRequiredMarkers() {
  document.querySelectorAll(`[${REQUIRED_MARKER_ATTR}="true"]`).forEach(el => {
    el.classList.remove(REQUIRED_MARKER_CLASS);
    el.removeAttribute(REQUIRED_MARKER_ATTR);
  });
}

function getRequiredMarkerTarget(el) {
  const type = (el?.type || "").toLowerCase();
  const tag = el?.tagName;
  const role = (el?.getAttribute("role") || "").toLowerCase();
  const scope = getQuestionScope(el);
  const likelyCustomSelectProxy =
    tag === "INPUT" &&
    (type === "text" || type === "search") &&
    (
      role === "combobox" ||
      Boolean(el?.getAttribute("aria-controls")) ||
      (el?.getAttribute("aria-haspopup") || "").toLowerCase() === "listbox" ||
      Boolean(el?.closest?.("[role='combobox'],[class*='select'],[class*='Select'],[class*='combobox']")) ||
      (Boolean(el?.required) && (el?.getBoundingClientRect?.().height || 0) <= 24)
    );
  if (type === "radio" || type === "checkbox") return scope || el.closest("label") || el;
  if (type === "file") return scope || el.closest(".field,.form-group,.question,[class*='upload'],[class*='Upload']") || el.parentElement || el;
  if (likelyCustomSelectProxy) return scope || el.parentElement || el;
  if (type === "hidden" || tag === "SELECT" || role === "combobox") return scope || el;
  return el;
}

function drawRequiredMarkers(targets) {
  clearRequiredMarkers();
  if (!requiredMarkerState.enabled || !targets?.length) return;
  ensureRequiredMarkerStyle();
  targets.forEach(el => {
    const target = getRequiredMarkerTarget(el);
    if (!target?.getBoundingClientRect) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    target.classList.add(REQUIRED_MARKER_CLASS);
    target.setAttribute(REQUIRED_MARKER_ATTR, "true");
  });
}

function refreshRequiredMarkers(fields) {
  const state = refreshRequiredJumpState(fields);
  drawRequiredMarkers(state.unansweredTargets);
  return state;
}

function scheduleRequiredMarkerRefresh() {
  clearTimeout(requiredMarkerState.refreshTimer);
  requiredMarkerState.refreshTimer = setTimeout(() => {
    refreshRequiredMarkers();
  }, 120);
}

function setRequiredMarkersEnabled(enabled) {
  requiredMarkerState.enabled = Boolean(enabled);
  if (!requiredMarkerState.enabled) {
    clearRequiredMarkers();
    return refreshRequiredJumpState();
  }
  return refreshRequiredMarkers();
}

function jumpToNextRequiredField() {
  const state = refreshRequiredMarkers();
  const remaining = state.remaining;
  if (!remaining) return { jumped: false, requiredRemaining: 0, requiredTotal: state.total };
  const el = requiredJumpState.fields[requiredJumpState.index % remaining];
  requiredJumpState.index = (requiredJumpState.index + 1) % remaining;
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  try {
    el.focus({ preventScroll: true });
  } catch (_) {
    el.focus();
  }
  return { jumped: true, requiredRemaining: remaining, requiredTotal: state.total };
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
  address: ["street-address", "address-line1", "address-line2", "address-line3"],
  city: ["address-level2"],
  state: ["address-level1"],
  country: ["country", "country-name"],
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
  const autocompleteKey = {
    "address-level1": "state",
    "address-level2": "city",
    "country": "country",
    "country-name": "country",
    "postal-code": "zip"
  }[(el.autocomplete || "").toLowerCase()];
  if (autocompleteKey) return autocompleteKey;

  for (const [key, keywords] of Object.entries(fieldMap)) {
    if (key === "address" && keywordMatches(haystack, "address") && /address-(level|line)\d/.test(haystack)) {
      continue;
    }
    if (keywords.some(k => keywordMatches(haystack, k))) {
      if (
        (key === "firstName" || key === "lastName" || key === "preferredName") &&
        (isReferrerNameQuestion(haystack) || isReferrerNameQuestion(getFieldQuestionText(el)))
      ) {
        continue;
      }
      return key;
    }
    const hints = autocompleteHints[key];
    if (hints?.some(h => keywordMatches(haystack, h))) {
      if (
        (key === "firstName" || key === "lastName" || key === "preferredName") &&
        (isReferrerNameQuestion(haystack) || isReferrerNameQuestion(getFieldQuestionText(el)))
      ) {
        continue;
      }
      return key;
    }
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

function isReferrerNameQuestion(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return (
    t.includes("referral") ||
    /\breferred\b/.test(t) ||
    t.includes("who referred") ||
    (t.includes("refer") && (t.includes("associate") || t.includes("employee")) && t.includes("name"))
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
  const t = text.toLowerCase();
  return (
    t.includes("work authorization") ||
    t.includes("authorized to work") ||
    t.includes("legally authorized to work") ||
    /legally\s+authorized/.test(t) ||
    (t.includes("authorization") && t.includes("united states")) ||
    (t.includes("authorized to work") && (t.includes("country you currently reside") || t.includes("country you reside")))
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
  if ((t.includes("sponsor") || t.includes("sponsorship")) && t.includes("country you currently reside")) {
    return true;
  }
  if (/require sponsorship to work in the country/.test(t)) {
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
  const escapedPref = pref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const prefPattern = new RegExp(`(^|[^a-z0-9])${escapedPref}([^a-z0-9]|$)`);
  if (prefPattern.test(label) || value === pref) {
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

const stateAliases = {
  al: "alabama",
  ak: "alaska",
  az: "arizona",
  ar: "arkansas",
  ca: "california",
  co: "colorado",
  ct: "connecticut",
  de: "delaware",
  dc: "district of columbia",
  fl: "florida",
  ga: "georgia",
  hi: "hawaii",
  id: "idaho",
  il: "illinois",
  in: "indiana",
  ia: "iowa",
  ks: "kansas",
  ky: "kentucky",
  la: "louisiana",
  me: "maine",
  md: "maryland",
  ma: "massachusetts",
  mi: "michigan",
  mn: "minnesota",
  ms: "mississippi",
  mo: "missouri",
  mt: "montana",
  ne: "nebraska",
  nv: "nevada",
  nh: "new hampshire",
  nj: "new jersey",
  nm: "new mexico",
  ny: "new york",
  nc: "north carolina",
  nd: "north dakota",
  oh: "ohio",
  ok: "oklahoma",
  or: "oregon",
  pa: "pennsylvania",
  ri: "rhode island",
  sc: "south carolina",
  sd: "south dakota",
  tn: "tennessee",
  tx: "texas",
  ut: "utah",
  vt: "vermont",
  va: "virginia",
  wa: "washington",
  wv: "west virginia",
  wi: "wisconsin",
  wy: "wyoming"
};
const stateNamesToAbbr = Object.fromEntries(
  Object.entries(stateAliases).map(([abbr, name]) => [name, abbr])
);

function getStateMatchValues(value) {
  const normalized = String(value || "").toLowerCase().trim();
  const values = [normalized];
  if (stateAliases[normalized]) values.push(stateAliases[normalized]);
  if (stateNamesToAbbr[normalized]) values.push(stateNamesToAbbr[normalized]);
  return [...new Set(values.filter(Boolean))];
}

function runFill(data, options = {}) {
  if (typeof options.showRequiredMarkers === "boolean") {
    requiredMarkerState.enabled = options.showRequiredMarkers;
  }

  // "Do you have at least X years of experience..." — click Yes (not age; experience ≠ years old)
  forEachChoice(el => {
    const { label, parentText, value } = getChoiceContext(el);
    if (/years?\s*of\s*age/.test(parentText)) return;
    if (/at least \d+ years? (of )?experience/.test(parentText) || /\d+\+ years? of experience/.test(parentText)) {
      if (label.includes("yes") || value === "yes") {
        el.click();
      }
    }
  });

  // At least 18 / adult age — click Yes
  forEachChoice(el => {
    const { label, parentText, value } = getChoiceContext(el);
    const questionText = getNearbyQuestionText(el) || parentText;
    if (questionText.includes("experience")) return;
    const isAdultAgeQuestion =
      /at least\s*18\s*years?\s*of\s*age/.test(questionText) ||
      /18\s*years?\s*of\s*age/.test(questionText) ||
      /eighteen\s*years?\s*of\s*age/.test(questionText) ||
      /\b18\s*years?\s*old\b/.test(questionText) ||
      questionText.includes("are you an adult") ||
      questionText.includes("legally appropriate age") ||
      questionText.includes("of legal age");
    if (isAdultAgeQuestion && (label.includes("yes") || value === "yes")) {
      el.click();
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
      const scopedText = getFieldQuestionText(el);
      const questionText = shouldApplyWorkAuthSetting(scopedText) ? scopedText : getNearbyQuestionText(el);
      if (!shouldApplyWorkAuthSetting(questionText)) return;
      const groupKey = questionText.slice(0, 120) || el.name;
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

  // Family / prior company — radios, selects, or free-text (some forms type "No" in a text field)
  document.querySelectorAll("input[type=radio], input[type=checkbox], input[type=text], textarea, select").forEach(el => {
    const label = getLabel(el);
    const text =
      el.tagName === "SELECT" || el.type === "text" || el.tagName === "TEXTAREA"
        ? label
        : getQuestionText(el);
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
        } else if (key === "state") {
          const values = getStateMatchValues(data[key]);
          opt = [...el.options].find(o => {
            const optionText = o.text.toLowerCase();
            const optionValue = String(o.value || "").toLowerCase();
            return values.some(value => optionText.includes(value) || optionValue === value);
          });
        } else {
          const raw = String(data[key]).toLowerCase();
          opt = [...el.options].find(o => o.text.toLowerCase().includes(raw) || String(o.value || "").toLowerCase() === raw);
        }
        if (opt) setSelectOption(el, o => o === opt);
    } else {
      fillInput(el, data[key]);
    }
  });
  const requiredState = refreshRequiredMarkers(fillableNow);
  return {
    mainLoopFilled,
    inputsCount: fillableNow.length,
    requiredRemaining: requiredState.remaining,
    requiredTotal: requiredState.total
  };
}

function onFillMessage(msg, _sender, sendResponse) {
  if (msg.action === "ping") {
    sendResponse({ ok: true, version: CONTENT_SCRIPT_VERSION });
    return;
  }
  if (msg.action === "fill") {
    const payload = msg.data;
    whenFormReady(() => sendResponse({ ok: true, debug: runFill(payload, {
      showRequiredMarkers: msg.showRequiredMarkers
    }) }));
    return true;
  }
  if (msg.action === "setRequiredMarkers") {
    const state = setRequiredMarkersEnabled(msg.enabled);
    sendResponse({ ok: true, debug: { requiredRemaining: state.remaining, requiredTotal: state.total } });
    return;
  }
  if (msg.action === "jumpRequired") {
    sendResponse({ ok: true, debug: jumpToNextRequiredField() });
    return;
  }
}

if (window.__formSlayerOnFillMessage) {
  chrome.runtime.onMessage.removeListener(window.__formSlayerOnFillMessage);
}
if (window.__formSlayerRequiredMarkerHandler) {
  document.removeEventListener("input", window.__formSlayerRequiredMarkerHandler, true);
  document.removeEventListener("change", window.__formSlayerRequiredMarkerHandler, true);
}
window.__formSlayerRequiredMarkerHandler = () => {
  if (requiredJumpState.fields.length || document.querySelector(`[${REQUIRED_MARKER_ATTR}="true"]`)) {
    scheduleRequiredMarkerRefresh();
  }
};
document.addEventListener("input", window.__formSlayerRequiredMarkerHandler, true);
document.addEventListener("change", window.__formSlayerRequiredMarkerHandler, true);
window.__formSlayerOnFillMessage = onFillMessage;
chrome.runtime.onMessage.addListener(onFillMessage);
})();
