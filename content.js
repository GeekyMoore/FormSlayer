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
  salary:      ["salary", "compensation", "expected salary", "salary expectation", "pay expectation", "salary expectations", "desired annual base salary", "annual base salary", "desired base salary", "base salary"],
  travelAvailability: ["travel availability", "willingness to travel", "travel requirement", "travel percentage", "percent travel", "% travel", "travel (percent)", "travel up to"],
  educationLevel: ["education", "education level", "highest education", "degree", "highest degree"],
  startDate:   ["start date", "available to start", "when can you start", "availability", "available start"],
  coverLetter: ["cover letter", "coverletter", "cover_letter", "message", "additional info", "additional information"]
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

  // Valid driver's license — find the question context and click "Yes"
  document.querySelectorAll("input[type=radio], input[type=checkbox]").forEach(el => {
    const label = getLabel(el);
    const parentText = (el.closest("fieldset, div, li, p") || el.parentElement)?.innerText?.toLowerCase() || "";
    const isDriverLicenseQuestion =
      /driver'?s?\s+license/.test(parentText) ||
      /driver'?s?\s+license/.test(label) ||
      (parentText.includes("drivers") && parentText.includes("license")) ||
      (label.includes("drivers") && label.includes("license"));

    if (isDriverLicenseQuestion) {
      if (label.includes("yes") || el.value?.toLowerCase() === "yes") {
        el.click();
      }
    }
  });

  // Relocation willingness — detect relocate questions and click saved Yes/No preference
  document.querySelectorAll("input[type=radio], input[type=checkbox]").forEach(el => {
    const relocationPreference = String(data.relocationWillingness || "").toLowerCase().trim();
    if (!relocationPreference) return;

    const label = getLabel(el);
    const parentText = (el.closest("fieldset, div, li, p") || el.parentElement)?.innerText?.toLowerCase() || "";
    const isRelocationQuestion =
      /willing\s+to\s+relocate/.test(parentText) ||
      /willing\s+to\s+relocate/.test(label) ||
      parentText.includes("relocate") ||
      label.includes("relocate");

    if (isRelocationQuestion) {
      if (label.includes(relocationPreference) || el.value?.toLowerCase() === relocationPreference) {
        el.click();
      }
    }
  });

  // Gender — detect gender questions and click saved preference
  document.querySelectorAll("input[type=radio], input[type=checkbox]").forEach(el => {
    const genderPreference = String(data.gender || "").toLowerCase().trim();
    if (!genderPreference) return;

    const label = getLabel(el);
    const parentText = (el.closest("fieldset, div, li, p") || el.parentElement)?.innerText?.toLowerCase() || "";
    const isGenderQuestion =
      parentText.includes("gender") ||
      label.includes("gender");

    if (isGenderQuestion) {
      if (label.includes(genderPreference) || el.value?.toLowerCase() === genderPreference) {
        el.click();
      }
    }
  });

  // Race / ethnicity — detect race/ethnicity questions and click saved preference
  document.querySelectorAll("input[type=radio], input[type=checkbox]").forEach(el => {
    const racePreference = String(data.race || "").toLowerCase().trim();
    if (!racePreference) return;

    const label = getLabel(el);
    const parentText = (el.closest("fieldset, div, li, p") || el.parentElement)?.innerText?.toLowerCase() || "";
    const isRaceQuestion =
      parentText.includes("race") ||
      parentText.includes("ethnicity") ||
      parentText.includes("hispanic") ||
      label.includes("race") ||
      label.includes("ethnicity");

    if (isRaceQuestion) {
      if (label.includes(racePreference) || el.value?.toLowerCase() === racePreference) {
        el.click();
      }
    }
  });

  // Disability status — detect disability questions and click saved preference
  document.querySelectorAll("input[type=radio], input[type=checkbox]").forEach(el => {
    const disabilityPreference = String(data.disability || "").toLowerCase().trim();
    if (!disabilityPreference) return;

    const label = getLabel(el);
    const parentText = (el.closest("fieldset, div, li, p") || el.parentElement)?.innerText?.toLowerCase() || "";
    const isDisabilityQuestion =
      parentText.includes("disability") ||
      label.includes("disability");

    if (isDisabilityQuestion) {
      if (label.includes(disabilityPreference) || el.value?.toLowerCase() === disabilityPreference) {
        el.click();
      }
    }
  });

  // Veteran status — detect veteran questions and click saved preference
  document.querySelectorAll("input[type=radio], input[type=checkbox]").forEach(el => {
    const veteranPreference = String(data.veteran || "").toLowerCase().trim();
    if (!veteranPreference) return;

    const label = getLabel(el);
    const parentText = (el.closest("fieldset, div, li, p") || el.parentElement)?.innerText?.toLowerCase() || "";
    const isVeteranQuestion =
      parentText.includes("veteran") ||
      parentText.includes("protected veteran") ||
      label.includes("veteran");

    if (isVeteranQuestion) {
      if (label.includes(veteranPreference) || el.value?.toLowerCase() === veteranPreference) {
        el.click();
      }
    }
  });

  inputs.forEach(el => {
    const key = matchField(el);
    if (key && data[key]) {
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
        if (opt) { el.value = opt.value; el.dispatchEvent(new Event("change", { bubbles: true })); }
      } else {
        fillInput(el, data[key]);
      }
    }
  });
});
