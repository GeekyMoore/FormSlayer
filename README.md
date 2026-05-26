# FormSlayer

A Chrome extension that auto-fills job application forms. No account, no subscription, no bullshit.

## What it does

- Fills standard job application fields (name, email, phone, address, LinkedIn, etc.)
- Auto-answers common yes/no questions (sponsorship, timezone, years of experience)
- Works on any standard HTML job form — CareerPlug, Greenhouse, Jobvite, Lever, Ashby, and more

## Install

1. Clone or download this repo
2. Go to `chrome://extensions`
3. Enable **Developer Mode** (top right toggle)
4. Click **Load Unpacked** and select the repo folder

## Uninstall

Go to `chrome://extensions`, find FormSlayer, and click **Remove**. Note this will also delete your saved settings.

## Setup

Click the FormSlayer icon in your Chrome toolbar, fill in your info, and hit **Save**.

## Usage

Navigate to a job application page, click the FormSlayer icon, then hit **Fill This Form**.

## Files

```
manifest.json   — Chrome extension config
popup.html      — Settings UI
popup.js        — Save/load settings
content.js      — Form detection and filling logic
```

## Adding new field patterns

If a field doesn't fill, find its label text and add it to the matching array in `content.js`:

```js
phone: ["phone", "mobile", "cell", "telephone", "your new pattern here"],
```

## License

MIT
