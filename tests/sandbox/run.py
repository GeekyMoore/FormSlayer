#!/usr/bin/env python3
"""Label-matching checks against the local embed-form fixture. Run: python3 tests/sandbox/run.py"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTENT_JS = ROOT / "content.js"
FIXTURE_HTML = Path(__file__).resolve().parent / "fixture.html"

EXPECTED_LABELS = {
    "firstName": "First Name",
    "lastName": "Last Name",
    "preferredName": "Preferred First Name",
    "email": "Email",
    "phone": "Phone",
    "country": "Country",
    "linkedin": "LinkedIn Profile",
    "website": "Website or Portfolio",
    "state": "State of Residence",
    "salary": "What is your desired base salary?",
    "zip": "Zip / Postal",
    "priorCompanyRelationship": "Have you ever been employed",
}


def load_field_map():
    text = CONTENT_JS.read_text(encoding="utf-8")
    block = re.search(r"const fieldMap = (\{.*?\n\});", text, re.S)
    if not block:
        raise RuntimeError("fieldMap not found in content.js")
    field_map = {}
    for key, keywords in re.findall(r"(\w+):\s*\[(.*?)\]", block.group(1), re.S):
        field_map[key] = [
            k.strip().strip('"').lower()
            for k in re.findall(r'"([^"]+)"', keywords)
        ]
    return field_map


def keyword_matches(haystack, keyword):
    normalized = keyword.lower().replace("_", " ").replace("-", " ").strip()
    escaped = re.escape(normalized).replace(r"\ ", r"\s+")
    return re.search(rf"(^|[^a-z0-9]){escaped}([^a-z0-9]|$)", haystack) is not None


def match_field(label, field_map):
    haystack = label.lower().replace("_", " ").replace("-", " ")
    for key, keywords in field_map.items():
        if any(keyword_matches(haystack, k) for k in keywords):
            if key == "firstName" and re.search(r"\bpreferred\b", haystack):
                continue
            return key
    return None


def extract_labels(html):
    labels = set()
    labels.update(re.findall(r'aria-label="([^"]+)"', html, re.I))
    for text in re.findall(r"<label[^>]*>(.*?)</label>", html, re.I | re.S):
        cleaned = re.sub(r"<[^>]+>", "", text)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if cleaned:
            labels.add(cleaned)
    return sorted(labels)


def main():
    field_map = load_field_map()
    html = FIXTURE_HTML.read_text(encoding="utf-8")
    labels = extract_labels(html)
    failures = []

    if 'id="first_name"' not in html:
        failures.append("first_name input missing from fixture")

    for key, fragment in EXPECTED_LABELS.items():
        label = next((l for l in labels if fragment.lower() in l.lower()), None)
        if not label:
            failures.append(f"missing label containing {fragment!r}")
            continue
        matched = match_field(label, field_map)
        if matched != key:
            failures.append(f"{fragment!r} matched {matched!r}, expected {key!r}")

    print(f"labels found: {len(labels)}")
    print(f"checks: {len(EXPECTED_LABELS)}")
    if failures:
        print("FAIL")
        for item in failures:
            print(f"  - {item}")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
