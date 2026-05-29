(() => {
const CONTENT_SCRIPT_VERSION = "veteran-status-phrases-v1";

// Profile field config
const fieldMap = {
  firstName:   ["first name", "first_name", "fname", "given name", "legal first", "preferred first"],
  lastName:    ["last name", "last_name", "lname", "surname", "family name", "legal last"],
  email:       ["email", "e-mail"],
  phone:       ["phone", "phone number", "mobile number", "cell", "telephone"],
  address:     ["address", "street"],
  city:        ["city", "town", "location", "location (city)"],
  country:     ["country", "country/region", "country of residence", "country you currently reside", "country you reside", "nation"],
  state:       ["state", "state/region", "province", "region"],
  zip:         ["zip", "zip code", "postal", "postcode"],
  linkedin:    ["linkedin", "linkedin profile", "linkedin url", "linkedin profile url"],
  website:     ["personal website", "portfolio", "personal site", "share your portfolio"],
  jobTitle:    ["job title", "current title", "recent job title", "position", "current position"],
  employer:    ["employer", "company", "company name", "recent employer", "current employer", "current company", "organization"],
  preferredName: ["preferred name", "preferred first name", "goes by", "nickname", "full name", "fullname", "name"],
  salary:      ["salary", "compensation", "compensation requirements", "expected salary", "salary expectation", "pay expectation", "salary expectations", "desired pay", "expected pay", "desired annual base salary", "annual base salary", "desired base salary", "base salary"],
  travelAvailability: ["travel availability", "willingness to travel", "travel requirement", "travel percentage", "percent travel", "% travel", "travel (percent)", "travel up to"],
  educationLevel: ["education", "education level", "highest education", "highest education obtained", "degree", "highest degree"],
  startDate:   ["start date", "available to start", "when can you start", "availability", "available start"],
  coverLetter: ["cover letter"],
  familyWorksAtCompany: ["anyone in your family", "in your family currently work", "family member employed", "family member work", "know anyone who works", "relative employed", "related to an employee", "related to anyone", "former employee at", "currently employed by a company who uses", "employed by a company who uses", "affiliated brands"],
  priorCompanyRelationship: ["have you ever worked at", "have you ever worked for", "previously worked at any", "previously worked at", "previously been directly employed", "been directly employed", "directly employed by", "worked at any entity", "do you currently work at", "do you currently work for", "have you ever applied", "ever applied to", "ever applied at", "previously applied", "worked here before", "prior employment with"]
};

// Travel availability normalization
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

// Label and DOM discovery
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

const FILLABLE_SELECTOR = "input:not([type=hidden]):not([type=submit]):not([type=file]):not([type=button]):not([type=reset]), textarea, select, [contenteditable='true'], [contenteditable='']";
const REQUIRED_CANDIDATE_SELECTOR = "input:not([type=submit]):not([type=button]):not([type=reset]), textarea, select, [contenteditable='true'], [contenteditable='']";

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

function collectRequiredCandidates() {
  return collectAll(REQUIRED_CANDIDATE_SELECTOR);
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

// Required field markers and jump state
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
  const type = (el?.type || "").toLowerCase();
  if (type === "radio" || type === "checkbox") {
    const fieldset = el.closest("fieldset");
    if (fieldset) return fieldset;
  }
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
  const scope = getQuestionScope(el);
  if (scope && scope !== el) {
    if (scope.required || scope.hasAttribute("required")) return true;
    if ((scope.getAttribute("aria-required") || "").toLowerCase() === "true") return true;
  }
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
    if (isReactSelectCombobox(el)) {
      if (getReactSelectDisplayValue(el)) return true;
      const native = findReactSelectNativeInput(el);
      if (native && String(native.value || "").trim() && !native.validity?.valueMissing) return true;
    }
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

function collectRequiredFieldState(fields = collectRequiredCandidates()) {
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

// Form readiness and profile matching
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
      if (key === "country" && isPhoneDialCodeField(el)) continue;
      if (key === "jobTitle" && fieldMap.salary.some(k => keywordMatches(haystack, k))) continue;
      if (
        (key === "firstName" || key === "lastName" || key === "preferredName") &&
        (isReferrerNameQuestion(haystack) ||
          isReferrerNameQuestion(getFieldQuestionText(el)) ||
          isRelationshipFollowUpQuestion(haystack) ||
          isRelationshipFollowUpQuestion(getFieldQuestionText(el)))
      ) {
        continue;
      }
      return key;
    }
    const hints = autocompleteHints[key];
    if (hints?.some(h => keywordMatches(haystack, h))) {
      if (
        (key === "firstName" || key === "lastName" || key === "preferredName") &&
        (isReferrerNameQuestion(haystack) ||
          isReferrerNameQuestion(getFieldQuestionText(el)) ||
          isRelationshipFollowUpQuestion(haystack) ||
          isRelationshipFollowUpQuestion(getFieldQuestionText(el)))
      ) {
        continue;
      }
      return key;
    }
  }
  return null;
}

// Question detectors and setting answers
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
    (t.includes("referrer") && t.includes("name")) ||
    (t.includes("refer") && (t.includes("associate") || t.includes("employee")) && t.includes("name"))
  );
}

function isRelationshipFollowUpQuestion(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return t.includes("what is your relationship") || (t.includes("if yes") && t.includes("relationship"));
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

function getChoiceQuestionPrompt(el) {
  let node = el;
  while (node && node !== document.body) {
    const li = node.closest("li");
    if (li) {
      const text = cleanLabelText(li.innerText);
      if (text && text.includes("?")) return text;
      const list = li.parentElement;
      if (list) {
        for (const sibling of list.children) {
          if (sibling.tagName !== "LI") continue;
          const siblingText = cleanLabelText(sibling.innerText);
          if (siblingText && siblingText.includes("?")) return siblingText;
        }
      }
    }
    node = node.parentElement;
  }
  const scoped = el.closest("fieldset,[role=group],.question,.form-question,.form-group");
  if (scoped) {
    const text = cleanLabelText(scoped.innerText);
    if (text) return text;
  }
  return getLabel(el);
}

function isWorkAuthQuestion(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes("work authorization") ||
    t.includes("authorized to work") ||
    t.includes("legally authorized to work") ||
    /legally\s+authorized/.test(t) ||
    t.includes("proof of citizenship") ||
    (t.includes("authorization") && t.includes("united states")) ||
    (t.includes("authorized to work") && (t.includes("country you currently reside") || t.includes("country you reside")))
  );
}

function isWorkAuthStatusQuestion(text) {
  if (!text) return false;
  return /\bwork authorization status\b/.test(text) || /\bauthorization status\b/.test(text);
}

function isDirectWorkAuthorizationQuestion(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes("authorized to work") ||
    t.includes("legally authorized") ||
    t.includes("eligible to work")
  );
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
  return false;
}

function isWorkAuthStatusPickerQuestion(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    /what is your current work authorization/.test(t) ||
    /current work authorization in/.test(t) ||
    (/work authorization/.test(t) && /for any employer|require sponsorship to work in the country/.test(t))
  );
}

function workAuthStatusOptionMatches(workAuthPref, optionLabel) {
  const l = String(optionLabel || "").toLowerCase();
  const pref = String(workAuthPref || "").toLowerCase();
  if (pref === "yes") {
    if (/for any employer/.test(l)) return true;
    return l.includes("authorized") && !/require sponsorship|unknown/.test(l);
  }
  if (/require sponsorship/.test(l)) return true;
  return /status.*unknown|unknown.*status/.test(l);
}

function isWorkAuthYesNoQuestion(text) {
  return isWorkAuthQuestion(text) && !isWorkAuthStatusQuestion(text) && !isSponsorshipRequiredQuestion(text);
}

function shouldApplyWorkAuthSetting(questionText) {
  return isWorkAuthYesNoQuestion(questionText) || isSponsorshipRequiredQuestion(questionText);
}

// Authorized in the US → no sponsorship needed; not authorized → yes sponsorship needed.
function workAuthAnswerForQuestion(workAuthPref, questionText) {
  if (isDirectWorkAuthorizationQuestion(questionText) && !isWorkAuthStatusQuestion(questionText)) {
    return workAuthPref;
  }
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

function normalizeNumberInputValue(value) {
  const normalized = String(value || "").replace(/[$,\s]/g, "").trim();
  if (/^-?\d+(\.\d+)?$/.test(normalized)) return normalized;
  const match = normalized.match(/-?\d+(\.\d+)?/);
  return match ? match[0] : "";
}

// Native input and select fill helpers
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
  const inputValue = (el.type || "").toLowerCase() === "number"
    ? normalizeNumberInputValue(stringValue)
    : stringValue;
  const proto = el.tagName === "TEXTAREA"
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

  if (el._valueTracker) el._valueTracker.setValue("");
  if (valueSetter) {
    valueSetter.call(el, inputValue);
  } else {
    el.value = inputValue;
  }
  el.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: inputValue
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
  if (textMatchesChoicePreference(pref, label, value)) {
    el.click();
    return true;
  }
  return false;
}

function textMatchesChoicePreference(pref, label, value) {
  if (!pref) return false;
  const escapedPref = pref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const prefPattern = new RegExp(`(^|[^a-z0-9])${escapedPref}([^a-z0-9]|$)`);
  return prefPattern.test(label) || value === pref;
}

function isEthnicityYesNoQuestion(text) {
  const t = String(text || "").toLowerCase();
  if (!/\bhispanic\b/.test(t) && !/\blatino\b/.test(t)) return false;
  return /\bare you\b/.test(t) || /\bdo you\b/.test(t);
}

function isEthnicityYesRacePref(pref) {
  return String(pref || "").toLowerCase().trim() === "hispanic";
}

function isWorkEnvironmentQuestion(text) {
  const t = String(text || "").toLowerCase();
  if (t.includes("sponsorship questions")) return false;
  if (t.includes("relocate") && !t.includes("remote")) return false;
  return (
    /work in (the )?office/.test(t) ||
    /willing to work (in )?(the )?office/.test(t) ||
    /work on-site|work onsite|on-site work/.test(t) ||
    (/hybrid/.test(t) && (t.includes("work") || t.includes("office") || t.includes("remote"))) ||
    /remote work|work remotely|work from home/.test(t) ||
    t.includes("work environment") ||
    t.includes("preferred work location") ||
    t.includes("work arrangement")
  );
}

function isWorkEnvironmentYesNoQuestion(text) {
  const t = String(text || "").toLowerCase();
  if (!isWorkEnvironmentQuestion(t)) return false;
  return (
    /willing to work|are you willing|work in (the )?office/.test(t) ||
    (t.includes("remote") && /\b(yes|no)\b/.test(t))
  );
}

function normalizeWorkEnvironmentPrefs(data) {
  const raw = data.workEnvironment;
  if (Array.isArray(raw)) {
    return raw.map(v => String(v).toLowerCase().trim()).filter(Boolean);
  }
  return String(raw || "").split(",").map(v => v.toLowerCase().trim()).filter(Boolean);
}

function workEnvironmentAcceptsInOffice(prefs) {
  return prefs.some(pref => pref === "onsite" || pref === "hybrid");
}

function workEnvironmentYesNoAnswer(prefs, questionText) {
  if (!prefs.length || !isWorkEnvironmentYesNoQuestion(questionText)) return null;
  return workEnvironmentAcceptsInOffice(prefs) ? "yes" : "no";
}

function workEnvironmentPrefPriority(pref) {
  if (pref === "hybrid") return 0;
  if (pref === "onsite") return 1;
  if (pref === "remote") return 2;
  return 3;
}

function orderedWorkEnvironmentPrefs(prefs) {
  return [...prefs].sort((a, b) => workEnvironmentPrefPriority(a) - workEnvironmentPrefPriority(b));
}

function getSettingAnswerText(key, pref, questionText) {
  if (key === "race" && isEthnicityYesNoQuestion(questionText)) {
    if (String(pref || "").toLowerCase().includes("prefer not")) return "decline";
    return isEthnicityYesRacePref(pref) ? "yes" : "no";
  }
  return pref;
}

function optionMatchesSetting(answer, label, value, key) {
  if (!answer) return false;
  const normalizedLabel = String(label || "").toLowerCase();
  const normalizedValue = String(value || "").toLowerCase();
  if (key === "veteran") {
    if (answer === "no") {
      return (
        normalizedLabel.includes("not a protected veteran") ||
        normalizedLabel.includes("i am not a protected") ||
        normalizedLabel.includes("am not a protected veteran")
      );
    }
    if (answer === "yes") {
      return (
        normalizedLabel.includes("identify as one or more") ||
        (normalizedLabel.includes("protected veteran") && !normalizedLabel.includes("not a protected"))
      );
    }
  }
  if (key === "disability") {
    if (answer === "no") {
      return (
        normalizedLabel.includes("do not have a disability") ||
        normalizedLabel.includes("no, i do not have a disability")
      );
    }
    if (answer === "yes") {
      return (
        normalizedLabel.includes("have a disability") &&
        !normalizedLabel.includes("do not have a disability")
      );
    }
  }
  if (key === "workEnvironment") {
    if (answer === "yes" || answer === "no") {
      return textMatchesChoicePreference(answer, normalizedLabel, normalizedValue);
    }
    if (answer === "onsite") {
      return /on-?\s*site|in\s*office|in-office/.test(normalizedLabel);
    }
    if (answer === "hybrid") {
      return normalizedLabel.includes("hybrid");
    }
    if (answer === "remote") {
      return normalizedLabel.includes("remote") || normalizedLabel.includes("work from home");
    }
  }
  if (key === "educationLevel") {
    const level = String(answer || "").toLowerCase().trim();
    if (level === "associate" && normalizedLabel.includes("associates")) return true;
    if (level === "mba" && normalizedLabel.includes("business administration")) return true;
    if (level === "master" && normalizedLabel.includes("master") && !normalizedLabel.includes("business administration")) return true;
    if (level === "phd" && (normalizedLabel.includes("doctorate") || normalizedLabel.includes("doctor of philosophy"))) return true;
    if (level === "md" && normalizedLabel.includes("medical doctor")) return true;
    if (normalizedLabel.includes(level)) return true;
    return false;
  }
  if (textMatchesChoicePreference(answer, normalizedLabel, normalizedValue)) return true;
  if (answer.includes("prefer not")) {
    return (
      normalizedLabel.includes("prefer not") ||
      normalizedLabel.includes("decline") ||
      normalizedLabel.includes("do not wish") ||
      normalizedLabel.includes("don't wish") ||
      normalizedLabel.includes("do not want to answer") ||
      normalizedValue.includes("prefer not") ||
      normalizedValue.includes("decline")
    );
  }
  return false;
}

function getSettingComboboxHint(key, answer) {
  if (key === "veteran") {
    if (answer === "no") return "not a protected veteran";
    if (answer === "yes") return "identify as one or more";
    if (answer.includes("prefer not")) return "do not wish";
  }
  if (key === "disability") {
    if (answer === "no") return "do not have a disability";
    if (answer === "yes") return "have a disability";
    if (answer.includes("prefer not")) return "do not want to answer";
  }
  if (key === "educationLevel") {
    const level = String(answer || "").toLowerCase().trim();
    if (level === "associate") return "associates";
    if (level === "bachelor") return "bachelor";
    if (level === "master") return "master";
    if (level === "mba") return "business administration";
    if (level === "phd") return "doctorate";
    if (level === "md") return "medical";
    if (level === "high school") return "high school";
  }
  return answer;
}

// Combobox and phone widgets
function setSelectOption(el, matcher) {
  const opt = [...el.options].find(matcher);
  if (!opt) return false;
  el.value = opt.value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function isFabricBackedSelect(el) {
  return (
    el?.tagName === "SELECT" &&
    el.getAttribute("aria-hidden") === "true" &&
    Boolean(getFabricSelectToggle(el))
  );
}

function getFabricSelectToggle(selectEl) {
  return selectEl.closest(".MuiFormControl-root, .fab-Select")?.querySelector("button.fab-SelectToggle");
}

function getFabricSelectDisplayText(selectEl) {
  const toggle = getFabricSelectToggle(selectEl);
  const guts = toggle?.querySelector(".fab-SelectToggle__guts");
  return cleanLabelText(guts?.innerText || "");
}

function matchProfileValueToOption(key, savedValue, optionText, optionValue) {
  if (!savedValue) return false;
  const text = String(optionText || "");
  const value = String(optionValue || "");
  if (optionMatchesSetting(savedValue, text, value, key)) return true;
  if (key === "travelAvailability") {
    const desiredBucket = normalizeTravelBucket(savedValue);
    if (desiredBucket && bucketFromText(text) === desiredBucket) return true;
  }
  if (key === "state") {
    const values = getStateMatchValues(savedValue);
    const optionTextLower = text.toLowerCase();
    const optionValueLower = value.toLowerCase();
    return values.some(v => optionTextLower.includes(v) || optionValueLower === v);
  }
  const raw = String(savedValue).toLowerCase().trim();
  return text.toLowerCase().includes(raw) || value.toLowerCase() === raw;
}

function getFabricSelectMenuOptions(toggle) {
  const menuId = toggle?.getAttribute("data-menu-id");
  if (!menuId) return [];
  const selectors = [
    `[data-helium-id="${menuId}"] .fab-MenuOption[role='menuitem']`,
    `[data-fabric-component="Menu"][data-helium-id="${menuId}"] .fab-MenuOption[role='menuitem']`,
    `[data-menu-id="${menuId}"] .fab-MenuOption[role='menuitem']`
  ];
  const seen = new Set();
  const out = [];
  for (const selector of selectors) {
    for (const el of document.querySelectorAll(selector)) {
      if (seen.has(el)) continue;
      seen.add(el);
      out.push(el);
    }
  }
  return out;
}

function openFabricSelectToggle(toggle) {
  toggle.scrollIntoView({ block: "center", inline: "nearest" });
  toggle.focus();
  const init = { bubbles: true, cancelable: true, view: window, buttons: 1, detail: 1 };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    toggle.dispatchEvent(new Ctor(type, init));
  }
}

async function collectFabricSelectMenuOptions(toggle) {
  let options = getFabricSelectMenuOptions(toggle);
  for (let i = 0; options.length === 0 && i < 12; i++) {
    await nextFrame();
    options = getFabricSelectMenuOptions(toggle);
  }
  return options;
}

async function activateFabricMenuOption(optionEl) {
  optionEl.scrollIntoView({ block: "nearest" });
  optionEl.focus();
  const init = { bubbles: true, cancelable: true, view: window, buttons: 1, detail: 1 };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    optionEl.dispatchEvent(new Ctor(type, init));
  }
  await nextFrame();
  dispatchKey(optionEl, "Enter");
  await nextFrame();
}

async function selectFabricSelectOption(selectEl, key, savedValue) {
  if (!savedValue || !isFabricBackedSelect(selectEl)) return false;
  const toggle = getFabricSelectToggle(selectEl);
  if (!toggle) return false;
  if (String(selectEl.value || "").trim() && matchProfileValueToOption(key, savedValue, getFabricSelectDisplayText(selectEl), selectEl.value)) {
    return true;
  }
  openFabricSelectToggle(toggle);
  let options = await collectFabricSelectMenuOptions(toggle);
  if (!options.length) {
    dispatchKey(toggle, " ");
    await nextFrame();
    options = await collectFabricSelectMenuOptions(toggle);
  }
  if (!options.length) return false;
  const match = options.find(opt => {
    const text = (opt.innerText || opt.textContent || "").trim();
    return matchProfileValueToOption(key, savedValue, text, "");
  });
  if (!match) {
    toggle.click();
    return false;
  }
  await activateFabricMenuOption(match);
  if (!String(selectEl.value || "").trim()) {
    await activateFabricMenuOption(match);
  }
  if (!String(selectEl.value || "").trim()) {
    toggle.click();
    return false;
  }
  selectEl.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

async function fillFabricBackedSelects(data) {
  for (const sel of document.querySelectorAll('select[aria-hidden="true"]')) {
    if (!isFabricBackedSelect(sel)) continue;
    const key = matchField(sel);
    if (!key || !data[key] || key === "familyWorksAtCompany" || key === "priorCompanyRelationship") continue;
    await selectFabricSelectOption(sel, key, data[key]);
  }
}

function getComboboxInput(el) {
  return el.tagName === "INPUT" ? el : el.querySelector("input[role='combobox']");
}

function getReactSelectListbox(input) {
  const id = input?.id;
  if (!id) return null;
  return document.getElementById(`react-select-${id}-listbox`);
}

const KEY_CODES = { ArrowDown: 40, ArrowUp: 38, Home: 36, Enter: 13, Escape: 27, " ": 32 };

function dispatchKey(el, key) {
  const keyCode = KEY_CODES[key] || 0;
  const init = { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

function getReactSelectDisplayValue(input) {
  const root = input.closest(".select__container") || input.closest(".select");
  if (!root) return "";
  const single = root.querySelector(".select__single-value, [class*='single-value']");
  if (single?.innerText?.trim()) return single.innerText.trim();
  const placeholder = root.querySelector(".select__placeholder");
  if (placeholder && placeholder.offsetParent !== null) return "";
  return "";
}

function reactSelectMatchesExpected(input, expectedText) {
  return getReactSelectDisplayValue(input).toLowerCase() === String(expectedText || "").toLowerCase().trim();
}

function getReactSelectFieldScope(input) {
  return input.closest(".select__container, .select, .field, .form-group, .question, .application-question, li") || input.parentElement;
}

function findReactSelectNativeInput(input) {
  const scope = getReactSelectFieldScope(input);
  if (!scope) return null;
  const candidates = [...scope.querySelectorAll("input")].filter(el => {
    if (el === input) return false;
    if (el.classList?.contains("select__input")) return false;
    if ((el.getAttribute("role") || "").toLowerCase() === "combobox") return false;
    const type = (el.type || "").toLowerCase();
    return type === "text" || type === "hidden";
  });
  return candidates.find(el => el.required || el.hasAttribute("required")) || candidates[0] || null;
}

function setNativeInputValue(native, value) {
  if (!native) return;
  const stringValue = value == null ? "" : String(value);
  const proto = native.tagName === "SELECT"
    ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (native._valueTracker) native._valueTracker.setValue("");
  if (setter) setter.call(native, stringValue);
  else native.value = stringValue;
  native.dispatchEvent(new Event("input", { bubbles: true }));
  native.dispatchEvent(new Event("change", { bubbles: true }));
}

function syncReactSelectNativeInput(input, optionText, optionValue) {
  const native = findReactSelectNativeInput(input);
  if (!native) return { synced: false, nativeFound: false };
  const value = String(optionValue || optionText || "").trim();
  if (!value) return { synced: false, nativeFound: true };
  setNativeInputValue(native, value);
  return {
    synced: true,
    nativeFound: true,
    valueMissing: Boolean(native.validity?.valueMissing)
  };
}

function reactSelectIsCommitted(input, expectedText) {
  if (expectedText && reactSelectMatchesExpected(input, expectedText)) return true;
  if (getReactSelectDisplayValue(input)) return true;
  const native = findReactSelectNativeInput(input);
  return Boolean(native && String(native.value || "").trim() && !native.validity?.valueMissing);
}

async function activateReactSelectOption(optionEl) {
  const clickTarget = optionEl.querySelector(".select__option") || optionEl;
  clickTarget.scrollIntoView({ block: "nearest" });
  const init = { bubbles: true, cancelable: true, view: window, buttons: 1, detail: 1 };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    clickTarget.dispatchEvent(new Ctor(type, init));
  }
  await nextFrame();
  await nextFrame();
}

async function typeReactSelectFilter(input, text) {
  const filterText = String(text || "").trim().slice(0, 24);
  if (!filterText) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  input.focus();
  if (setter) setter.call(input, "");
  else input.value = "";
  input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "deleteContentBackward" }));
  await nextFrame();
  if (setter) setter.call(input, filterText);
  else input.value = filterText;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: filterText }));
  await nextFrame();
  await nextFrame();
}

function isPhoneDialCodeField(el) {
  const iti = el?.closest?.(".iti");
  if (!iti) return false;
  return el !== iti.querySelector("input[type='tel']");
}

function getIntlTelInstance(telInput) {
  if (telInput?._iti) return telInput._iti;
  if (window.intlTelInputGlobals?.getInstance) {
    try {
      return window.intlTelInputGlobals.getInstance(telInput);
    } catch (_) {}
  }
  return null;
}

function getPhoneCountryIso(phone, profileCountry) {
  return window.__formSlayerPhoneLocale?.resolveCountryIso?.(phone, profileCountry) || "us";
}

function itiOptionMatchesCountry(text, iso2, profileCountry) {
  const t = String(text || "").toLowerCase().trim();
  const profileLabel = String(profileCountry || "").toLowerCase().trim();
  if (profileLabel && t.includes(profileLabel)) return true;
  if (iso2 === "us" && t.includes("united states")) return true;
  if (iso2 === "ca" && t.includes("canada")) return true;
  if (iso2 === "gb" && t.includes("united kingdom")) return true;
  return false;
}

function formatPhoneForIti(phoneValue, iso2) {
  const digits = String(phoneValue || "").replace(/\D/g, "");
  if (!digits) return "";
  if (iso2 === "us" || iso2 === "ca") {
    const national = digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
    return `+1${national}`;
  }
  if (String(phoneValue).trim().startsWith("+")) return String(phoneValue).trim();
  return `+${digits}`;
}

function getItiSelectedIso(telInput) {
  const iti = getIntlTelInstance(telInput);
  return (iti?.getSelectedCountryData?.()?.iso2 || "").toLowerCase();
}

async function setIntlTelCountry(itiRoot, telInput, iso2, phoneValue, profileCountry) {
  const formatted = formatPhoneForIti(phoneValue, iso2);
  const iti = getIntlTelInstance(telInput);
  if (iti?.setCountry) {
    iti.setCountry(iso2);
    if (formatted && iti.setNumber) iti.setNumber(formatted);
    return { ok: true, method: "iti-api", selectedIso: getItiSelectedIso(telInput) };
  }
  const flagBtn = itiRoot.querySelector(".iti__selected-country, .iti__selected-flag");
  if (flagBtn) {
    flagBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    flagBtn.click();
    await nextFrame();
    await nextFrame();
  }
  const searchInput = itiRoot.querySelector(
    "input[type='search'][role='combobox'], input.iti__search-input, input[id*='iti'][role='combobox']"
  );
  if (searchInput) {
    const hint = String(profileCountry || "").trim();
    const ok = await selectComboboxOption(
      searchInput,
      (text) => itiOptionMatchesCountry(text, iso2, profileCountry),
      hint
    );
    if (ok) {
      if (formatted && getIntlTelInstance(telInput)?.setNumber) {
        getIntlTelInstance(telInput).setNumber(formatted);
      }
      return { ok: true, method: "iti-search", selectedIso: getItiSelectedIso(telInput) };
    }
  }
  return { ok: false, method: "iti-failed", selectedIso: getItiSelectedIso(telInput) };
}

function syncPhoneCompanionInputs(telInput) {
  const scope = getQuestionScope(telInput) || telInput.closest(".field,.form-group,.question");
  if (!scope) return;
  const telValue = String(telInput.value || "").trim();
  if (!telValue) return;
  [...scope.querySelectorAll("input")].forEach(el => {
    if (el === telInput) return;
    const type = (el.type || "").toLowerCase();
    if (type === "tel" || type === "file") return;
    if (el.classList?.contains("select__input")) return;
    if ((el.getAttribute("role") || "").toLowerCase() === "combobox") return;
    if (!el.required && (el.getAttribute("aria-required") || "").toLowerCase() !== "true") return;
    if (String(el.value || "").trim()) return;
    setNativeInputValue(el, telValue);
  });
}

function phoneDigitsMatch(have, want) {
  if (!want) return true;
  if (!have) return false;
  return have === want || have.endsWith(want) || want.endsWith(have);
}

async function fillPhoneInput(el, value, profileCountry) {
  const itiRoot = el.closest(".iti");
  const telInput = itiRoot?.querySelector("input[type='tel'], input[type='text']") || el;
  const iso = getPhoneCountryIso(value, profileCountry);
  const wantDigits = String(value || "").replace(/\D/g, "");

  if (itiRoot) {
    await setIntlTelCountry(itiRoot, telInput, iso, value, profileCountry);
  }

  let haveDigits = String(telInput.value || "").replace(/\D/g, "");
  if (wantDigits && !phoneDigitsMatch(haveDigits, wantDigits)) {
    const iti = getIntlTelInstance(telInput);
    const formatted = formatPhoneForIti(value, iso);
    if (iti?.setNumber && formatted) iti.setNumber(formatted);
    haveDigits = String(telInput.value || "").replace(/\D/g, "");
    if (!phoneDigitsMatch(haveDigits, wantDigits)) fillInput(telInput, value);
  } else if (!itiRoot && wantDigits) {
    fillInput(telInput, value);
  }

  syncPhoneCompanionInputs(telInput);
  telInput.dispatchEvent(new Event("input", { bubbles: true }));
  telInput.dispatchEvent(new Event("change", { bubbles: true }));
  telInput.dispatchEvent(new Event("blur", { bubbles: true }));
}

function isReactSelectCombobox(input) {
  return Boolean(input?.classList?.contains("select__input") && input.id);
}

function openReactSelectMenu(input) {
  input.scrollIntoView({ block: "center", inline: "nearest" });
  input.focus();
  if (input.getAttribute("aria-expanded") === "true") return;
  const control = input.closest(".select__control");
  if (control) {
    control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    control.click();
  }
  if (input.getAttribute("aria-expanded") !== "true") {
    dispatchKey(input, "ArrowDown");
  }
  if (input.getAttribute("aria-expanded") !== "true") {
    input.closest(".select")?.querySelector("button[aria-label='Toggle flyout']")?.click();
  }
}

function openCombobox(input) {
  if (isReactSelectCombobox(input)) {
    openReactSelectMenu(input);
    return;
  }
  input.scrollIntoView({ block: "center", inline: "nearest" });
  input.focus();
  const control = input.closest(".select__control, [class*='select'], [class*='Select']") || input;
  control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
  control.click();
}

function readReactSelectListbox(input) {
  const listbox = getReactSelectListbox(input);
  if (!listbox) return null;
  const opts = [...listbox.querySelectorAll("[role='option']")];
  return opts.length ? { listbox, opts } : null;
}

function waitForReactSelectListbox(input) {
  return new Promise(resolve => {
    let settled = false;
    let observer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      resolve(result);
    };
    openReactSelectMenu(input);
    const immediate = readReactSelectListbox(input);
    if (immediate) {
      finish(immediate);
      return;
    }
    observer = new MutationObserver(() => {
      const found = readReactSelectListbox(input);
      if (found) finish(found);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    let frames = 0;
    const poll = () => {
      const found = readReactSelectListbox(input);
      if (found) {
        finish(found);
        return;
      }
      frames++;
      if (frames < 24) requestAnimationFrame(poll);
      else finish(null);
    };
    requestAnimationFrame(poll);
  });
}

function getListboxOptions(input) {
  const reactListbox = getReactSelectListbox(input);
  if (reactListbox) {
    const reactOptions = [...reactListbox.querySelectorAll("[role='option']")];
    if (reactOptions.length) return reactOptions;
  }
  const listboxId = input.getAttribute("aria-controls");
  if (listboxId) {
    const listbox = document.getElementById(listboxId);
    if (listbox) {
      return [...listbox.querySelectorAll("[role='option'], li, [data-value]")];
    }
  }
  const scope = input.closest("fieldset,[role=group],.question,.form-group,.field,.form-question,.select__container,.select") || document;
  const inScope = [...scope.querySelectorAll("[role='listbox'] [role='option'], [role='option']")];
  if (inScope.length) return inScope;
  const visible = [...document.querySelectorAll("[role='listbox'] [role='option'], [role='option']")].filter(opt => {
    const rect = opt.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  return visible;
}

function getActiveListboxOptionIndex(input, opts) {
  const activeId = input.getAttribute("aria-activedescendant");
  if (!activeId) return -1;
  return opts.findIndex(o => o.id === activeId);
}

function findReactSelectOptionIndex(opts, matcher) {
  return opts.findIndex(opt => {
    const text = (opt.innerText || opt.textContent || "").trim();
    const value = (opt.getAttribute("data-value") || opt.id || "").toLowerCase();
    return matcher(text, value);
  });
}

async function selectReactSelectOption(input, matcher, filterHint = "") {
  if (input.getAttribute("aria-expanded") === "true") {
    dispatchKey(input, "Escape");
    await nextFrame();
  }

  let found = await waitForReactSelectListbox(input);
  let opts = found?.opts || [];
  let targetIndex = findReactSelectOptionIndex(opts, matcher);

  if (targetIndex < 0 && filterHint) {
    await typeReactSelectFilter(input, filterHint);
    let frames = 0;
    while (frames < 48 && targetIndex < 0) {
      found = readReactSelectListbox(input) || found;
      opts = found?.opts || opts;
      targetIndex = findReactSelectOptionIndex(opts, matcher);
      if (targetIndex >= 0) break;
      if (frames % 8 === 7) openReactSelectMenu(input);
      await nextFrame();
      frames++;
    }
  }

  if (targetIndex < 0) {
    dispatchKey(input, "Escape");
    return false;
  }

  const expectedText = (opts[targetIndex].innerText || opts[targetIndex].textContent || "").trim();
  const optionValue = opts[targetIndex].getAttribute("data-value") || expectedText;
  input.focus();

  const tryCommitSelection = async (optionEl) => {
    if (!optionEl) return false;
    await activateReactSelectOption(optionEl);
    if (reactSelectMatchesExpected(input, expectedText)) return true;
    if (input.getAttribute("aria-expanded") === "true") {
      dispatchKey(input, "Enter");
      await nextFrame();
    }
    return reactSelectMatchesExpected(input, expectedText);
  };

  let success = await tryCommitSelection(opts[targetIndex]);
  if (!success) {
    await typeReactSelectFilter(input, expectedText);
    found = readReactSelectListbox(input) || found;
    opts = found?.opts || opts;
    targetIndex = findReactSelectOptionIndex(opts, matcher);
    if (targetIndex >= 0) {
      success = await tryCommitSelection(opts[targetIndex]);
    }
  }

  if (!success) {
    let currentIndex = getActiveListboxOptionIndex(input, opts);
    if (currentIndex < 0) {
      dispatchKey(input, "ArrowDown");
      currentIndex = getActiveListboxOptionIndex(input, opts);
    }
    let guard = 0;
    while (currentIndex !== targetIndex && guard < opts.length + 3) {
      dispatchKey(input, currentIndex < targetIndex ? "ArrowDown" : "ArrowUp");
      const nextIndex = getActiveListboxOptionIndex(input, opts);
      if (nextIndex === currentIndex || nextIndex < 0) break;
      currentIndex = nextIndex;
      guard++;
    }
    dispatchKey(input, "Enter");
    await nextFrame();
    success = reactSelectMatchesExpected(input, expectedText);
    if (!success) success = await tryCommitSelection(opts[targetIndex]);
  }

  const syncResult = syncReactSelectNativeInput(input, expectedText, optionValue);
  if (!success) success = reactSelectIsCommitted(input, expectedText);
  if (!success && syncResult.nativeFound) {
    syncReactSelectNativeInput(input, expectedText, optionValue);
    success = reactSelectIsCommitted(input, expectedText);
  }

  if (input.getAttribute("aria-expanded") === "true") {
    dispatchKey(input, "Escape");
  }
  input.blur();
  return success;
}

async function selectComboboxOption(el, matcher, filterHint = "") {
  const input = getComboboxInput(el);
  if (!input || typeof matcher !== "function") return false;
  if (isReactSelectCombobox(input)) {
    return selectReactSelectOption(input, matcher, filterHint);
  }
  openCombobox(input);
  const options = getListboxOptions(input);
  const option = options.find(opt => {
    const text = (opt.innerText || opt.textContent || "").trim();
    const value = (opt.getAttribute("data-value") || opt.getAttribute("value") || opt.id || "").toLowerCase();
    return matcher(text, value);
  });
  if (!option) return false;
  option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
  option.click();
  option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.blur();
  return true;
}

function setComboboxOption(el, answer, key) {
  const hint = getSettingComboboxHint(key, answer);
  return selectComboboxOption(
    el,
    (text, value) => optionMatchesSetting(answer, text, value, key),
    hint
  );
}

const stateAliases = window.__formSlayerStateAliases || {};
const stateNamesToAbbr = Object.fromEntries(
  Object.entries(stateAliases).map(([abbr, name]) => [name, abbr])
);

// Location and residency helpers
function getStateMatchValues(value) {
  const normalized = String(value || "").toLowerCase().trim();
  const values = [normalized];
  if (stateAliases[normalized]) values.push(stateAliases[normalized]);
  if (stateNamesToAbbr[normalized]) values.push(stateNamesToAbbr[normalized]);
  return [...new Set(values.filter(Boolean))];
}

function parseResidencyLocation(text) {
  const t = String(text || "").toLowerCase();
  const match = t.match(/\bare you in ([^?\n]+)/);
  if (!match) return null;
  return match[1].replace(/\*+/g, "").trim();
}

function isResidencyLocationQuestion(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!/\bare you in .+\?/.test(t)) return false;
  if (isSponsorshipRequiredQuestion(t) || isWorkAuthQuestion(t)) return false;
  if (t.includes("will you now") || t.includes("will you ever")) return false;
  return true;
}

function userIsInLocation(data, locationText) {
  const location = String(locationText || "").toLowerCase().trim();
  if (!location) return false;
  const city = String(data.city || "").toLowerCase().trim();
  if (city && (location.includes(city) || city.includes(location))) return true;
  const stateValues = getStateMatchValues(data.state);
  return stateValues.some(value => location.includes(value) || value.includes(location));
}

function isRelocateIfNotInLocationQuestion(text) {
  const t = String(text || "").toLowerCase();
  return (
    (t.includes("if you are not in") || t.includes("if you're not in")) &&
    t.includes("relocate")
  );
}

// Fill orchestration
async function runFill(data, options = {}) {
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
  for (const el of document.querySelectorAll("input.select__input[role='combobox'], input[role='combobox']")) {
    if (workAuthPrefForPolicy) break;
    if (!el.classList.contains("select__input") && el.closest(".iti")) continue;
    const questionText = getFieldQuestionText(el);
    if (!isSponsorshipRequiredQuestion(questionText)) continue;
    await setComboboxOption(el, "no");
  }

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
      const questionText = getChoiceQuestionPrompt(el);
      if (!shouldApplyWorkAuthSetting(questionText)) return;
      const groupKey = el.name || questionText.slice(0, 120);
      if (workAuthClickedGroups.has(groupKey)) return;
      const { label } = getChoiceContext(el);
      const value = el.value || "";
      if (isWorkAuthStatusPickerQuestion(questionText)) {
        let optionText = String(el.value || "").trim();
        if (optionText.startsWith("{")) {
          try {
            const parsed = JSON.parse(optionText);
            optionText = String(parsed.text || parsed.label || optionText).trim();
          } catch (_) {}
        }
        if (!optionText) optionText = (el.closest("li")?.innerText || label).trim();
        if (workAuthStatusOptionMatches(workAuthPref, optionText)) {
          el.click();
          workAuthClickedGroups.add(groupKey);
        }
        return;
      }
      const answer = workAuthAnswerForQuestion(workAuthPref, questionText);
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
    for (const el of document.querySelectorAll("input.select__input[role='combobox'], input[role='combobox']")) {
      if (!el.classList.contains("select__input") && el.closest(".iti")) continue;
      const questionText = getFieldQuestionText(el);
      if (!shouldApplyWorkAuthSetting(questionText)) continue;
      const groupKey = "combobox:" + (el.name || el.id || questionText.slice(0, 120));
      if (workAuthClickedGroups.has(groupKey)) continue;
      const answer = workAuthAnswerForQuestion(workAuthPref, questionText);
      const changed = await setComboboxOption(el, answer);
      if (changed) workAuthClickedGroups.add(groupKey);
    }
  }

  // "Are you in [location]?" — answer Yes/No from saved city/state.
  const residencyClickedGroups = new Set();
  if (data.state || data.city) {
    forEachChoice(el => {
      const questionText = getChoiceQuestionPrompt(el);
      if (!isResidencyLocationQuestion(questionText)) return;
      const location = parseResidencyLocation(questionText);
      if (!location) return;
      const groupKey = el.name || questionText.slice(0, 120);
      if (residencyClickedGroups.has(groupKey)) return;
      const answer = userIsInLocation(data, location) ? "yes" : "no";
      const { label, value } = getChoiceContext(el);
      if (textMatchesChoicePreference(answer, label, value)) {
        el.click();
        residencyClickedGroups.add(groupKey);
      }
    });
  }

  const relocatePref = normalizePreference(data, "relocationWillingness");
  if (relocatePref) {
    document.querySelectorAll("input[type=text], textarea").forEach(el => {
      const questionText = getLabel(el) || getFieldQuestionText(el);
      if (!isRelocateIfNotInLocationQuestion(questionText)) return;
      const location = parseResidencyLocation(questionText);
      if (location && userIsInLocation(data, location)) return;
      fillInput(el, relocatePref === "yes" ? "Yes" : "No");
    });
  }

  const choiceSettings = [
    {
      key: "relocationWillingness",
      matchesQuestion: (label, questionText) =>
        questionText.includes("relocate") || questionText.includes("plan to relocate")
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
        parentText.includes("hispanic") ||
        parentText.includes("latino") ||
        label.includes("race") ||
        label.includes("ethnicity") ||
        label.includes("hispanic") ||
        label.includes("latino")
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

  async function applyWorkEnvironmentSetting() {
    const prefs = normalizeWorkEnvironmentPrefs(data);
    if (!prefs.length) return;
    const clickedGroups = new Set();
    forEachChoice(el => {
      const questionText = getChoiceQuestionPrompt(el);
      if (!isWorkEnvironmentQuestion(questionText)) return;
      const { label, value } = getChoiceContext(el);
      if (el.type === "checkbox") {
        if (prefs.some(pref => optionMatchesSetting(pref, label, value, "workEnvironment"))) {
          if (!el.checked) el.click();
        }
        return;
      }
      const groupKey = el.name || questionText.slice(0, 120);
      if (clickedGroups.has(groupKey)) return;
      const yesNoAnswer = workEnvironmentYesNoAnswer(prefs, questionText);
      if (yesNoAnswer) {
        if (textMatchesChoicePreference(yesNoAnswer, label, value)) {
          el.click();
          clickedGroups.add(groupKey);
        }
        return;
      }
      for (const pref of orderedWorkEnvironmentPrefs(prefs)) {
        if (optionMatchesSetting(pref, label, value, "workEnvironment")) {
          el.click();
          clickedGroups.add(groupKey);
          break;
        }
      }
    });
    document.querySelectorAll("select").forEach(el => {
      const label = getLabel(el);
      if (!isWorkEnvironmentQuestion(label)) return;
      const yesNoAnswer = workEnvironmentYesNoAnswer(prefs, label);
      if (yesNoAnswer) {
        setSelectOption(el, o => optionMatchesSetting(yesNoAnswer, o.text, o.value, "workEnvironment"));
        return;
      }
      for (const pref of orderedWorkEnvironmentPrefs(prefs)) {
        if (setSelectOption(el, o => optionMatchesSetting(pref, o.text, o.value, "workEnvironment"))) break;
      }
    });
    for (const el of document.querySelectorAll("input.select__input[role='combobox']")) {
      const label = getLabel(el);
      if (!isWorkEnvironmentQuestion(label)) continue;
      const yesNoAnswer = workEnvironmentYesNoAnswer(prefs, label);
      if (yesNoAnswer) {
        await setComboboxOption(el, yesNoAnswer, "workEnvironment");
        continue;
      }
      for (const pref of orderedWorkEnvironmentPrefs(prefs)) {
        if (await setComboboxOption(el, pref, "workEnvironment")) break;
      }
    }
  }

  async function applyChoiceSettingsPass() {
    for (const { key, matchesQuestion } of choiceSettings) {
      const pref = normalizePreference(data, key);
      if (!pref) continue;
      forEachChoice(el => {
        const { label, value } = getChoiceContext(el);
        const questionText = getChoiceQuestionPrompt(el);
        if (!matchesQuestion(label, questionText)) return;
        const answer = getSettingAnswerText(key, pref, questionText || label);
        if (optionMatchesSetting(answer, label, value, key)) el.click();
      });
      for (const el of document.querySelectorAll("select")) {
        const label = getLabel(el);
        if (!matchesQuestion(label, label)) continue;
        const answer = getSettingAnswerText(key, pref, label);
        if (isFabricBackedSelect(el)) {
          await selectFabricSelectOption(el, key, answer);
          continue;
        }
        setSelectOption(el, o => optionMatchesSetting(answer, o.text, o.value, key));
      }
      for (const el of document.querySelectorAll("input.select__input[role='combobox']")) {
        const label = getLabel(el);
        if (!matchesQuestion(label, label)) continue;
        const answer = getSettingAnswerText(key, pref, label);
        await setComboboxOption(el, answer, key);
      }
    }
  }

  // Some forms reveal dependent demographic fields after a prior answer (e.g. race after Hispanic/Latino).
  // Run a second pass so newly revealed follow-up questions are filled in the same click.
  await applyWorkEnvironmentSetting();
  await applyChoiceSettingsPass();
  await applyChoiceSettingsPass();

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

  await fillFabricBackedSelects(data);

  let mainLoopFilled = 0;
  const fillableNow = collectFillable();
  for (const el of fillableNow) {
    const questionText = getFieldQuestionText(el);
    if (isYearsExperienceQuantityQuestion(questionText)) continue;
    const key = matchField(el);
    if (!key || !data[key] || key === "familyWorksAtCompany" || key === "priorCompanyRelationship") continue;
    if (key === "country" && isPhoneDialCodeField(el)) continue;
    const inputType = (el.type || "").toLowerCase();
    if (inputType === "radio" || inputType === "checkbox") continue;
    mainLoopFilled++;
    const role = (el.getAttribute("role") || "").toLowerCase();
    const skippedIti = role === "combobox" && !el.classList.contains("select__input") && Boolean(el.closest(".iti"));
    if (el.tagName === "SELECT") {
        if (isFabricBackedSelect(el)) continue;
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
    } else if (role === "combobox") {
      if (skippedIti) continue;
      let comboboxOk = false;
      if (key === "travelAvailability") {
        const desiredBucket = normalizeTravelBucket(data[key]);
        if (!desiredBucket) continue;
        comboboxOk = await selectComboboxOption(el, (text) => bucketFromText(text) === desiredBucket);
      } else if (key === "state") {
        const values = getStateMatchValues(data[key]);
        comboboxOk = await selectComboboxOption(el, (text, value) => {
          const optionText = String(text || "").toLowerCase();
          const optionValue = String(value || "").toLowerCase();
          return values.some(v => optionText.includes(v) || optionValue === v);
        }, String(data[key]));
      } else {
        const raw = String(data[key]).toLowerCase();
        comboboxOk = await selectComboboxOption(el, (text, value) => {
          const optionText = String(text || "").toLowerCase();
          const optionValue = String(value || "").toLowerCase();
          return optionText.includes(raw) || optionValue === raw;
        }, String(data[key]));
      }
    } else {
      if (key === "phone") await fillPhoneInput(el, data[key], data.country);
      else fillInput(el, data[key]);
    }
  }
  const requiredState = refreshRequiredMarkers();
  return {
    mainLoopFilled,
    inputsCount: fillableNow.length,
    requiredRemaining: requiredState.remaining,
    requiredTotal: requiredState.total
  };
}

// Message bootstrap
function onFillMessage(msg, _sender, sendResponse) {
  if (msg.action === "ping") {
    sendResponse({ ok: true, version: CONTENT_SCRIPT_VERSION });
    return;
  }
  if (msg.action === "fill") {
    const payload = msg.data;
    whenFormReady(() => {
      runFill(payload, { showRequiredMarkers: msg.showRequiredMarkers })
        .then(debug => sendResponse({ ok: true, debug }));
    });
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
