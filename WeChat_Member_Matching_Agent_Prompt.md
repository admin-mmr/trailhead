# WeChat Group Member Matching — AI Agent Prompt

## Purpose

This prompt instructs an AI agent to match WeChat group members against a
membership database and produce a structured Excel report. Run this task
several times per year after screenshots of the WeChat group member list are
collected.

---

## Inputs Required

Provide the agent with **two files**:

### 1. Member Database CSV

Standard membership export. Must contain these columns (exact header names):

| Column | Description |
|---|---|
| `Member ID` | Format `A0001`–`A9999`. Primary key. |
| `Full Name` | English name |
| `Status` | `active`, `lifetime`, `inactive`, `expired`, `pending_upgrade` |
| `Expiration` | Date string |
| `Gender` | Male / Female / blank |
| `WeChat ID` | Member's self-reported WeChat username (may be blank) |
| `Email` | May contain name fragments useful for matching |
| `District` | Geographic district |
| `Type` | Individual / Family |
| `Family ID` | Family group code if applicable |
| `Payment Date` | |
| `Membership Fee Paid` | |
| `Payment Transaction` | |

### 2. WeChat Members List

A two-column CSV transcribed from WeChat group member screenshots, with header
row `wechat_name,wechat_alias`.

- **`wechat_name`**: The large display name shown in the WeChat group member list
- **`wechat_alias`**: The nickname shown below the display name
  (labeled `昵称` or `群昵称` in the app). Leave blank if not shown.

**How to create this file from screenshots:**
Go through each screenshot of the WeChat group member list. For each person,
record:
- Their display name (top line, larger text)
- Their alias/nickname (bottom line, smaller text, after `昵称：` or `群昵称：`)

Example rows:
```
wechat_name,wechat_alias
龙在纽约 付龙昌,龙昌 A0014
A0019 Jimmy 🔵,Jimmy 🔵
贾森（Zhaoxun Liu）,贾森
珊妹子,
正谊,正谊
Gary Wang,
```

---

## Matching Logic (in priority order)

The agent must apply these rules in order, stopping at the first match per
WeChat entry. Each **CSV member ID may only appear once** in the output
(highest-confidence match wins).

### Step 1 — Member ID Extraction (Confirmed, score = 100)
Search both the display name and alias for a member ID pattern.
Handles all these formats:
- Standard: `A0121`, `A0019`
- Space: `J. Xia A 0137` → `A0137`
- No boundary: `timA0293` → `A0293`
- Short number: `A383` → `A0383`

Regex: `A\s*0*(\d{3,4})(?:\b|\D|$)` → zero-pad to 4 digits → `A{n:04d}`

If the extracted ID exists in the member database → **confirmed match**.

### Step 2 — Fuzzy Scoring (scores 60–95)

Apply all rules below against every member record and take the highest score.
Score ≥ 95 → **confirmed**. Score 60–94 → **guessed**.

**Critical bug to avoid:** Before any substring check, verify both strings
meet the minimum length. Empty string (`''`) is a substring of every string
in Python — this causes massive false positives. Use `MIN_LEN = 4`.

| Rule | Condition | Score |
|---|---|---|
| A | CSV `WeChat ID` (any length) **equals** alias exactly | 95 |
| B | CSV `WeChat ID` (any length) **equals** display name exactly | 95 |
| C | CSV `WeChat ID` (≥4 chars) **contained in** alias (≥4 chars) | 85 |
| D | CSV `Full Name` (≥4 chars) found in WC display or alias | 80 |
| E | WC display name (≥4 chars) found in CSV `Full Name` | 75 |
| F | WC alias (≥4 chars) found in CSV `Full Name` | 75 |
| G | Individual name tokens (≥4 chars) found in WC display or alias | 60 |
| H | Email local part: 2+ tokens match, OR 1 unique token ≥6 chars | 65–72 |

**Normalize before comparison:** strip `[\s\-_*()\[\].,，。·•]+` and lowercase.

**Email matching (Rule H):** Extract English tokens ≥4 chars from the WeChat
display name and alias. Check how many appear in the email address local part
(before `@`). Require either 2+ matching tokens OR 1 token ≥6 chars.
Never match on short common tokens alone (e.g., `zhang`, `wang`, `chen`
appearing in `Zhang` emails would match half the database).

---

## Output: 7-Tab Excel Workbook

### Column Order (applies to all tabs with WeChat data)
WeChat/match columns first, then key member fields, then remaining fields.

**Tabs 1–2 (Confirmed):**
`WeChat Display Name | WeChat Alias | Match Reason | Member ID | Full Name |
Status | WeChat ID | Expiration | Email | District | Gender | Type |
Family ID | Payment Date | Membership Fee Paid | Payment Transaction`

**Tabs 3–4 (Guessed):**
`WeChat Display Name | WeChat Alias | Confidence % | Guess Reason | Member ID |
Full Name | Status | WeChat ID | Expiration | Email | District | Gender |
Type | Family ID | Payment Date | Membership Fee Paid | Payment Transaction`

**Tab 5 (WeChat No CSV Match):**
`WeChat Display Name | WeChat Alias | Note | Member ID (from name) |
Full Name | Status | District | Email`

Note values:
- `"ID found — matched member record"` — ID was in name and found in CSV
- `"ID {Axxxx} found in name but NOT in member CSV"` — ID extracted but absent from database (investigate!)
- `"No member ID; no name/email match"` — completely unidentified

**Tabs 6–7 (CSV No WeChat):**
`Member ID | Full Name | Status | WeChat ID | Expiration | Email |
District | Gender | Type | Family ID | Payment Date | Membership Fee Paid |
Payment Transaction`

### Tab Definitions

| Tab | Color | Content | Action Required |
|---|---|---|---|
| **1. Confirmed Active** | Dark green | Confirmed match, active/lifetime status | None — all good |
| **2. Confirmed Review** | Dark olive | Confirmed match, **inactive/expired** | These people are in the WeChat group but their membership lapsed. Follow up to renew or remove from group. Rows highlighted yellow. |
| **3. Guessed Active** | Dark orange | Probable match, active/lifetime | Review each row: verify the match is correct |
| **4. Guessed Review** | Amber | Probable match, inactive/expired | Review match accuracy AND membership status. Rows highlighted yellow. |
| **5. WeChat No CSV Match** | Blue | In WeChat group, not in member database | Investigate. If ID is shown: person may have been removed from DB. If no ID: unknown person in group. |
| **6. CSV No WeChat Active** | Dark grey | **Active members absent from WeChat group** | High priority: invite these members to join the group. |
| **7. CSV No WeChat Rest** | Medium grey | Inactive/expired not in group | Low priority: for reference |

### Formatting Rules
- Header row: white bold Arial 10, colored background, centered, height 28
- Data rows: Arial 10, thin borders, alternating white/light grey fill
- Review tabs (2, 4): all data rows highlighted yellow instead of alternating
- Freeze pane at row 2 on all tabs

---

## Quality Checks the Agent Must Perform

Before writing the final Excel, the agent must verify:

1. **No duplicate member IDs** in the confirmed or guessed output — each ID
   appears at most once.

2. **Audit all guessed matches** by printing them with score + reason.
   Manually review any that seem implausible (e.g., matching on a single
   common word like "Zhang" or "Wang").

3. **Tab 5 integrity**: For every entry, attempt to extract a member ID from
   the WeChat name/alias. If one is found, look it up in the CSV.
   Show the extracted ID and lookup result in the output — do not just say
   "no match" if an ID was found.

4. **No hallucination**: Every value in the output must come directly from
   one of the two input files. Do not infer, guess, or fill in any member
   field that is not present in the CSV.

5. **Short alias safety**: `normalize('')` returns `''`, which is a substring
   of any string. Always check `len(normalized_string) >= 4` before using
   `in` for substring matching. Single-character aliases like `'C'`, `'M'`
   must only match via **exact equality** (Rule A/B), never substring.

---

## Running the Automated Script

A Python script `wechat_member_matcher.py` is provided alongside this prompt.
It implements the full pipeline above.

### Installation
```bash
pip install openpyxl
```

### Basic usage
```bash
python3 wechat_member_matcher.py \
    --csv   all_members_2026-04-25.csv \
    --wechat wechat_members.csv \
    --output wechat_matching_YYYY-MM-DD.xlsx
```

### With verbose audit output (recommended)
```bash
python3 wechat_member_matcher.py \
    --csv   all_members_2026-04-25.csv \
    --wechat wechat_members.csv \
    --output wechat_matching_YYYY-MM-DD.xlsx \
    --verbose
```

The `--verbose` flag prints every guessed match with its confidence and reason
before writing the file, so you can spot-check before opening Excel.

### WeChat CSV format reminder
```
wechat_name,wechat_alias
龙在纽约 付龙昌,龙昌 A0014
贾森（Zhaoxun Liu）,贾森
珊妹子,
```
The header row `wechat_name,wechat_alias` is required.
Leave the alias field blank (but keep the comma) if the member has no alias.

---

## Common Edge Cases & How to Handle Them

| Situation | How the script handles it |
|---|---|
| Member ID with space: `A 0137` | Regex handles optional space between A and digits |
| ID with no boundary: `timA0293` | Regex does not require word boundary before `A` |
| Short WeChat ID (1–3 chars): `贾森`, `静`, `晞` | Exact match only (Rules A/B), not substring |
| Same ID appears in two WeChat entries | First occurrence wins; second is silently skipped |
| WeChat member with ID not in CSV | Tab 5, note says "ID found but NOT in member CSV" — worth investigating |
| Member uses English alias in WeChat, Chinese ID in CSV | Rules A/B catch exact match regardless of length |
| Name in email: `liuzhaoxun@gmail.com` for `Zhaoxun Liu` | Rule H: `zhaoxun` (7 chars, unique) matches |
| Common name token only: `zhang` alone | Rule H: requires ≥6 chars OR 2+ tokens — `zhang` alone not enough |
| WeChat display has emoji or special chars | `normalize()` strips them before comparison |

---

## Workflow for Each Cleanup Cycle

1. **Export member database** from your membership system as CSV.

2. **Screenshot the WeChat group member list** (Settings → Group Members →
   scroll through all pages, screenshot each screen).

3. **Transcribe screenshots** into `wechat_members.csv`:
   - For each member: record display name in `wechat_name`, alias in
     `wechat_alias`.
   - Alternatively, give the screenshots to an AI and ask it to transcribe
     them into the two-column CSV format.

4. **Run the script** (see above).

5. **Review the output**:
   - Tab 2 (Confirmed Review): contact these members to renew or remove from group
   - Tab 3 & 4 (Guessed): verify each match is correct; move confirmed ones to confirmed list manually if needed
   - Tab 5 (WeChat No Match): investigate IDs not in database
   - Tab 6 (CSV No WeChat Active): invite active members who aren't in the group

6. **Update member database** with any corrections found.
