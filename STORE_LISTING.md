# Chrome Web Store Prep

Use this file as the working copy for the store dashboard and release checklist.

## Listing Copy

### Name

FormSlayer

### Short Description

Save your job application profile locally and fill common application forms faster.

### Detailed Description

FormSlayer helps job seekers fill repetitive application forms with profile details they save once in the extension popup.

The extension can fill common fields like name, email, phone, address, work authorization, education, and other application profile details. It also highlights required fields that still need attention, so users can review the application before submitting it.

FormSlayer is local-first. It does not require an account, subscription, backend service, or external profile database. Saved settings are stored with browser extension storage and are used when the user clicks Fill This Form.

## Privacy Disclosure

Suggested privacy wording:

FormSlayer stores the profile details you enter so it can fill job application forms at your request. This may include contact information, location, work preferences, and optional demographic or application-related fields. FormSlayer does not sell this data and does not send it to a company server. Your saved profile is stored using browser extension storage.

## Permission Justification

### `storage`

Used to save the user's application profile and popup preferences.

### `activeTab`

Used so the popup can act on the tab where the user chooses to fill a form.

### `scripting`

Used to inject the content script into the current page and its frames when needed.

### `<all_urls>`

Used because job application forms can appear on many different domains. FormSlayer only fills forms when the user clicks Fill This Form.

## Release ZIP

From the repository root, create the upload ZIP with:

```sh
rm -f formslayer-chrome-store.zip
zip -r formslayer-chrome-store.zip \
  manifest.json \
  content.js \
  popup.html \
  popup.js \
  icons \
  formslayer_icon.svg \
  LICENSE
```

Before uploading, unzip the package in a temporary folder and confirm `manifest.json` is at the ZIP root.

## Pre-Upload Checklist

1. Load the extension unpacked from the release files in `chrome://extensions`.
2. Confirm there are no manifest errors.
3. Open the popup, save a test profile, close and reopen the popup, and confirm the values persist.
4. Test Fill This Form on representative application forms.
5. Confirm required-field markers appear and the Next button jumps between missing required fields.
6. Confirm the store dashboard screenshots and copy match the current popup and extension behavior.
