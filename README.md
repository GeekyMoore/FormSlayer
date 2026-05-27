# FormSlayer

A Chrome extension that auto-fills job application forms. No account, no subscription, no bullshit.

Works on any standard HTML job form — CareerPlug, Greenhouse, Jobvite, Lever, Ashby, and more.

## How It Works

FormSlayer uses three core mechanisms to fill forms intelligently:

**Word Association**

Fields are matched against lists of common labels that all map to the same value. For example, any field labelled with one of the following will be filled with your saved phone number:

```js
phone: ["phone", "phone number", "mobile number", "cell", "telephone"],
```

This is done for dozens of common field types across the forms you'll encounter.

**Logic Conditions**

Some fields require more nuance than a simple label match. For range-based questions (e.g. willingness to travel), FormSlayer selects the next highest value within the available range:

```js
if (str.includes("0-25"))   return "0-25%";
if (str.includes("25-50"))  return "25-50%";
if (str.includes("50-75"))  return "50-75%";
if (str.includes("75-100")) return "75-100%";
```

For obligatory yes/no questions, it handles inverse logic automatically:

```
Are you legally allowed to work in the US?         → Yes
Will you require work sponsorship in the US?       → No
```

Zip codes work the same way — since a postal code implies city and state, all three fields are populated from a single saved value.

**Required Field Detection**

Some fields can't be pre-filled — open-ended questions custom to the role, for instance. FormSlayer flags these so you know exactly what still needs your attention before submitting.

EEOC and similar optional fields can generally be skipped, but for the rare cases they're required, FormSlayer can store that information too. All such fields are entirely optional.

## Install

1. Clone or download this repo
2. Go to `chrome://extensions`
3. Enable **Developer Mode** (top-right toggle)
4. Click **Load Unpacked** and select the repo folder

## Uninstall

Go to `chrome://extensions`, find FormSlayer, and click **Remove**. This will also delete your saved settings.

## Setup

Click the FormSlayer icon in your Chrome toolbar, fill in your details, and hit **Save**.

## Usage

Navigate to a job application page, click the FormSlayer icon, then hit **Fill This Form**.

---

## Adding New Field Patterns

If a field isn't being filled, find its label text and add it to the appropriate array in `content.js`:

```js
phone: ["phone", "mobile", "cell", "telephone", "your new pattern here"],
```

## File Structure

```
manifest.json   — Chrome extension config
popup.html      — Settings UI
popup.js        — Save/load settings
content.js      — Form detection and filling logic
```

## Privacy

FormSlayer has no call-home functions. Your data stays local to your machine via `chrome.storage.sync`. The repo is fully open to inspection under the MIT license.

All settings are optional — if you'd rather not save personal details like location, gender, or ethnicity, leave them blank. FormSlayer will fill what it can with whatever you've provided.

## Support

FormSlayer is provided as-is and stability cannot be guaranteed. Bugs and feature requests can be filed as issues, or submitted as a PR for inclusion in the main branch.

## License

MIT
