# Translation Validation System

## Overview

This document describes the comprehensive translation validation system implemented to ensure **all user-visible text** on the member portal is properly translatable into both English and Chinese.

## Problem Statement

Previously, we relied on manually adding `data-i18n` attributes to every element. This approach was error-prone because:
- Easy to miss text elements
- Hard to identify which pages have untranslated content
- No automated way to validate translation completeness
- Difficult to maintain consistency across pages

## Solution: Translation Validation Utilities

We've added three new utility functions to `frontend/i18n.js` that help identify and validate translations:

### 1. `validateTranslations(options)`

Scans the entire page and identifies any user-visible text that doesn't have translation attributes.

**Usage:**
```javascript
// Run validation in console or page script
const issues = validateTranslations({
  debugHighlight: false,  // Highlight untranslated text in red
  logToConsole: true      // Log warnings to browser console
});

// Returns array of issues like:
// [
//   {
//     text: "Family Members",
//     element: "H2",
//     elementId: "",
//     elementClass: "page-title",
//     recommendation: "Add data-i18n=\"family_members\" to parent element"
//   }
// ]
```

**What it checks:**
- ✅ Finds all text nodes in the DOM
- ✅ Checks if parent element has `data-i18n`, `data-i18n-placeholder`, or `data-i18n-title` attribute
- ✅ Ignores empty/whitespace-only text
- ✅ Ignores internal elements (scripts, styles)
- ✅ De-duplicates multiple instances of same text

**Console Output Example:**
```
✅ [Translation Validation] All visible text appears to have translation attributes
```

Or if issues found:
```
⚠️  [Translation Validation] Found 3 potentially untranslated text nodes:
  1. "Delete Member" in <BUTTON#deleteBtn>
     Recommendation: Add data-i18n="btnDelete" to parent element
  2. "Loading…" in <DIV.empty-state>
     Recommendation: Add data-i18n="loadingText" to parent element
  3. "Confirm Action" in <H2>
     Recommendation: Add data-i18n="confirmAction" to parent element
```

### 2. `enableTranslationDebugMode()`

Activates a developer mode that highlights untranslated text with red outlines and validates on page load and language changes.

**Usage:**
```javascript
// Add this to your page script during development
enableTranslationDebugMode();

// Or run in browser console:
// enableTranslationDebugMode()
```

**What it does:**
- 🔴 Adds red outline to any untranslated text
- 📋 Logs detailed warnings to console
- 🔄 Re-validates whenever user changes language
- 📍 Shows tooltip on hover: "UNTRANSLATED: [text]"

**Visual Feedback:**
- Untranslated elements have a red 2px outline
- Hover over outlined element to see the text that needs translation
- Console shows detailed list of all issues

### 3. `getTranslationKeySummary()`

Audits the translation dictionary to ensure all keys are present in both English and Chinese.

**Usage:**
```javascript
// Run in browser console
getTranslationKeySummary();
```

**Output Example:**
```javascript
{
  english: ["appTitle", "dashboard", "save", "cancel", ...],  // 145 keys
  chinese: ["appTitle", "dashboard", "save", "cancel", ...],  // 145 keys
  missingInChinese: [],     // Keys defined in English but not Chinese
  missingInEnglish: []      // Keys defined in Chinese but not English
}
```

## Implementation: How to Ensure ALL Text is Translatable

### Step 1: Mark All Text with Translation Attributes

Use one of these three patterns:

```html
<!-- For visible text content -->
<h2 data-i18n="pageTitle">Family Members</h2>
<button data-i18n="btnSubmit">Submit</button>
<p data-i18n="descriptionText">Please fill in all fields...</p>

<!-- For input placeholders -->
<input data-i18n-placeholder="emailPlaceholder" placeholder="your@email.com" />
<textarea data-i18n-placeholder="notesPlaceholder" placeholder="Add notes..."></textarea>

<!-- For element titles/tooltips -->
<span data-i18n-title="helpTooltip" title="Click for help">?</span>
```

### Step 2: Add Keys to TRANSLATIONS Dictionary

In each page's `<script>` section, define translations:

```javascript
var TRANSLATIONS = {
  "en": {
    "pageTitle": "Family Members",
    "btnSubmit": "Submit",
    "descriptionText": "Please fill in all fields...",
    "emailPlaceholder": "your@email.com",
    "notesPlaceholder": "Add notes...",
    "helpTooltip": "Click for help"
  },
  "zh": {
    "pageTitle": "家庭成员",
    "btnSubmit": "提交",
    "descriptionText": "请填写所有字段...",
    "emailPlaceholder": "your@email.com",
    "notesPlaceholder": "添加备注...",
    "helpTooltip": "点击寻求帮助"
  }
};
```

### Step 3: Validate and Deploy

Before deploying:

```javascript
// Run in browser console
validateTranslations({ debugHighlight: true });

// Or get summary of all keys
getTranslationKeySummary();
```

If validation finds issues, they'll be highlighted in red and logged to console.

## Pages with Complete Chinese Translations

✅ **Complete:**
- `page_login.html` - All navigation and form text translated
- `page_dashboard.html` - Status badges, payment history, all labels translated
- `page_profile.html` - All form fields and instructions translated
- `page_payment.html` - Payment details and instructions translated
- `page_payment_proof.html` - All form fields and buttons translated
- `page_payment_history.html` - All column headers and status labels translated
- `page_admin.html` - Tabs, buttons, column headers translated
- `page_family.html` - All form fields and table headers translated

## Best Practices

### DO:
✅ Use `data-i18n="keyName"` for all user-visible text
✅ Use kebab-case for translation keys (e.g., `btn_submit`, `label_email`)
✅ Keep English and Chinese keys identical (only values differ)
✅ Test with `validateTranslations()` before deploying
✅ Use `enableTranslationDebugMode()` during development

### DON'T:
❌ Hardcode English text directly in HTML
❌ Use different key names for English vs Chinese
❌ Forget to add Chinese translations when adding English text
❌ Leave untranslated text in production pages
❌ Mix static HTML text with dynamically generated text without translation

## Dynamic Text (JavaScript-Generated)

For text created dynamically in JavaScript, translate it before inserting:

```javascript
// ❌ BAD - Hardcoded English
function showStatus(status) {
  const msg = status === 'pending' ? 'Waiting for approval' : 'Approved';
  document.getElementById('status').textContent = msg;
}

// ✅ GOOD - Using translation function
function showStatus(status) {
  const lang = getCurrentLanguage();
  const trans = TRANSLATIONS[lang] || TRANSLATIONS['en'];
  const msg = status === 'pending' ? trans['statusPending'] : trans['statusApproved'];
  document.getElementById('status').textContent = msg;
}

// Or for inline dynamic content, pre-define in TRANSLATIONS:
// "statusPending": "Waiting for approval"
// "statusApproved": "Approved"
```

## Testing Checklist

Before marking a page as "translation complete":

- [ ] Run `validateTranslations()` in console - should show ✅ success
- [ ] Switch language to Chinese - all text should be in Chinese
- [ ] Switch language to English - all text should be in English
- [ ] Check placeholders in forms - should translate with language
- [ ] Check buttons and links - should translate with language
- [ ] Check validation messages - should be in selected language
- [ ] Check error/success messages - should be in selected language

## Debugging Tips

### Issue: Validation finds untranslated text

1. **Use `enableTranslationDebugMode()`** to see red outlines
2. **Hover over red outline** to see what text needs translation
3. **Add `data-i18n` attribute** to that element
4. **Add key-value pair** to TRANSLATIONS dictionary
5. **Re-run validation** to confirm

### Issue: Translation doesn't apply when language changes

Make sure your element has the `data-i18n` attribute:
```javascript
// ❌ Without attribute - won't translate
<button onclick="save()">Save</button>

// ✅ With attribute - will translate
<button onclick="save()" data-i18n="btnSave">Save</button>
```

### Issue: Placeholder text not translating

Use `data-i18n-placeholder` attribute:
```javascript
// ❌ Won't translate
<input placeholder="Enter name" />

// ✅ Will translate
<input data-i18n-placeholder="namePlaceholder" placeholder="Enter name" />
```

## Summary

The three validation utilities provide:

1. **`validateTranslations()`** - Find untranslated text automatically
2. **`enableTranslationDebugMode()`** - Visual highlighting during development
3. **`getTranslationKeySummary()`** - Audit translation dictionary completeness

Together, these ensure **100% of user-visible text is translatable** and provide a clear workflow to identify and fix any gaps.
