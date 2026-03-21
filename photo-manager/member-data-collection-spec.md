# MMR Member Data Collection — Form Spec & Privacy Consent Guide

---

## Part A — Google Form vs. Custom Web App

### Option 1: Google Form (Recommended to start)

**Pros:** Free, no code needed, handles file uploads, auto-saves to Google Sheets, easy to share via link or QR code, works on any phone.
**Cons:** File upload limit is 10GB per form (plenty), but Google Drive space is shared; limited branding; no custom validation logic; photos land in Google Drive, requiring a manual download step before loading into the system.

**Best for:** Getting started quickly. Works great for a club of hundreds of members.

### Option 2: Custom Web App Page

**Pros:** Full control over UX and validation (e.g., check face is detectable before accepting upload), auto-rename files to `A0000_firstname_lastname.jpg` convention on upload, can write directly to the local/server folder the pipeline reads from, no manual download step, better bilingual layout control.
**Cons:** Requires development time (a simple Flask or Next.js app is 1–2 days).

**Best for:** Long-term, production use. Strongly recommended as Phase 2 of the Photo Manager project.

**Recommendation:** Start with Google Form → migrate to a web app once the pipeline is proven.

---

## Part B — Google Form Field Design

### Form Title
```
MMR Member Profile Photo Submission
MMR 会员档案照片提交
```

### Form Description
```
Please fill in your details and upload your profile photos.
These photos help our system automatically find you in race event photos.
Your information is kept private and secure.

请填写您的资料并上传档案照片。
这些照片帮助我们的系统自动在比赛活动照片中找到您。
您的资料将被保密和安全保存。
```

---

### Section 1 — Member Information / 会员资料

| # | Field | Type | Required | Notes |
|---|---|---|---|---|
| 1 | **Full Name / 全名** | Short text | ✅ | First + Last name in Latin characters |
| 2 | **Chinese Name / 中文姓名** | Short text | ❌ | Optional, for display |
| 3 | **Member ID / 会员编号** | Short text | ✅ | Format: A0000. Shown on membership card. |
| 4 | **Email Address / 电子邮箱** | Short text (email) | ✅ | Used to notify when photos are found |
| 5 | **Mobile Number / 手机号码** | Short text | ❌ | For WhatsApp notification (optional) |
| 6 | **Preferred Notification Language / 通知语言偏好** | Multiple choice | ✅ | Options: English / 中文 / Both |
| 7 | **Are you an active runner? / 您是活跃跑手吗？** | Multiple choice | ✅ | Yes — I race regularly / Occasionally / Social member only |

---

### Section 2 — Photo Uploads / 照片上传

Each photo upload field should include the description from the instructions sheet so members know exactly what to upload.

| # | Field Label | Type | Required | Accepted Formats | Notes |
|---|---|---|---|---|---|
| 8 | **Photo 1 — Running gear, face clear (no hat, no sunglasses) / 跑步装，脸部清晰（不戴帽子，不戴墨镜）** | File upload | ✅ | JPG, PNG, HEIC | Max 20MB |
| 9 | **Photo 2 — Running gear with sunglasses / 跑步装戴墨镜** | File upload | ✅ | JPG, PNG, HEIC | Max 20MB |
| 10 | **Photo 3 — Running gear with hat or visor / 跑步装戴帽子或遮阳帽** | File upload | ✅ | JPG, PNG, HEIC | Max 20MB |
| 11 | **Photo 4 — Casual everyday clothes / 休闲日常服装** | File upload | ✅ | JPG, PNG, HEIC | Max 20MB |
| 12 | **Photo 5 — Smart or formal attire / 正式或商务服装** | File upload | ❌ | JPG, PNG, HEIC | Optional but recommended |
| 13 | **Additional photo (optional) / 额外照片（可选）** | File upload | ❌ | JPG, PNG, HEIC | Any other outfit or situation |

> **Google Form tip:** Set "Allow only specific file types" → Images. Set "Maximum number of files" to 1 per field (one upload field per photo type keeps them labeled clearly).

---

### Section 3 — Running Details (helps with bib matching) / 跑步详情（有助于号码布匹配）

| # | Field | Type | Required | Notes |
|---|---|---|---|---|
| 14 | **Typical race bib number range (if known) / 常用号码布编号范围（如知道）** | Short text | ❌ | E.g. "usually between 1000–1999" for seeded runners |
| 15 | **Typical race attire colour / 常穿比赛服颜色** | Checkboxes | ❌ | Red, Blue, Green, Yellow, Black, White, Orange, Other |
| 16 | **Do you usually wear sunglasses during races? / 比赛时通常戴墨镜吗？** | Multiple choice | ❌ | Always / Sometimes / Never |
| 17 | **Do you usually wear a hat or visor during races? / 比赛时通常戴帽子或遮阳帽吗？** | Multiple choice | ❌ | Always / Sometimes / Never |

---

### Section 4 — Privacy Consent / 私隐同意 ⭐

> **This section must appear on the form before the Submit button.**

#### 4a — Consent Statement (display as a paragraph, not a question)

```
PRIVACY NOTICE — FACIAL RECOGNITION DATA
私隐声明 — 人脸识别数据

MMR collects your profile photos to power an automated photo identification system.
Your photos are used to generate a facial recognition "embedding" (a mathematical
representation of your face). This data is:

  • Stored securely on MMR's private system
  • Never shared with third parties
  • Used only to identify you in MMR race and event photos
  • Deleted upon your request at any time

You have the right to:
  ✅ Access your stored data
  ✅ Correct inaccurate data
  ✅ Request complete deletion of your data
  ✅ Withdraw consent at any time without penalty

Contact: privacy@mmr.org.hk

---

MMR 收集您的档案照片，用于自动照片识别系统。
您的照片用于生成人脸识别"特征向量"（您面部的数学表示）。此数据将：

  • 安全存储在 MMR 的私人系统上
  • 绝不会与第三方共享
  • 仅用于在 MMR 比赛和活动照片中识别您的身份
  • 随时应您的要求删除

您有权：
  ✅ 查阅您存储的数据
  ✅ 更正不准确的数据
  ✅ 要求完全删除您的数据
  ✅ 随时撤回同意，不受任何惩罚

联系方式：privacy@mmr.org.hk
```

#### 4b — Consent Checkbox (required to submit)

| # | Field | Type | Required |
|---|---|---|---|
| 18 | **I have read and agree to MMR's Facial Recognition Data Policy. I consent to MMR storing and processing my photos for the purpose of photo identification. / 我已阅读并同意 MMR 的人脸识别数据政策。我同意 MMR 为照片识别目的存储和处理我的照片。** | Checkbox — single option | ✅ |

> In Google Forms: use a "Checkboxes" question with a single option "I agree / 我同意". Mark as Required. The form cannot be submitted without checking this box.

#### 4c — Age Confirmation (if minors may be members)

| # | Field | Type | Required |
|---|---|---|---|
| 19 | **I confirm I am 18 years of age or older. If submitting on behalf of a minor, I confirm I am the parent or legal guardian and consent on their behalf. / 我确认我已年满18岁。如代表未成年人提交，我确认我是其父母或法定监护人并代为同意。** | Checkbox | ✅ |

---

### Section 5 — Form Settings (Google Form Admin Config)

| Setting | Value |
|---|---|
| Collect email addresses | ON (automatically) |
| Response receipts | Send to respondents |
| Limit to 1 response | OFF (allow re-submission to update photos) |
| Response destination | Google Sheet → `MMR_Member_Profiles` tab |
| File upload destination | Google Drive folder: `MMR / Member Profiles / Uploads / {year}` |
| Confirmation message | "Thank you! Your photos have been received. We will process them within 5 business days. / 谢谢！您的照片已收到。我们将在5个工作日内处理。" |

---

## Part C — Custom Web App Page (Future Phase)

If building a dedicated web app, the page should do the following beyond what Google Form offers:

### Additional Features

**1. Auto Face Validation on Upload**
Before accepting a photo, run a lightweight client-side or server-side face detection check. If no face is detected, show an error:
> "We could not find a clear face in this photo. Please try again with better lighting or move closer to the camera. / 我们无法在此照片中找到清晰的面部。请在更好的光线下重试，或靠近镜头。"

**2. Auto File Renaming**
On upload, automatically rename files to the convention:
`A0000_firstname_lastname.jpg`, `A0000_firstname_lastname_2.jpg`, etc.
No manual renaming needed by the admin.

**3. Live Photo Preview + Quality Hints**
Show a preview of the uploaded photo and display basic quality signals:
- ✅ Face detected
- ✅ Face size: good
- ⚠️ Lighting: slightly dark — try facing a window

**4. Member Lookup**
Let members enter their Member ID to pre-fill their name, so they don't have to type it again. Reduces errors.

**5. Re-submission / Update Flow**
Members should be able to log in with their Member ID + email and replace any of their photos without having to resubmit all 5.

**6. Admin Dashboard**
- See all members with submitted / missing / pending photos
- One-click "approve and move to profiles folder" button
- Flag profiles where face detection failed

### Recommended Tech Stack

| Component | Option A (Simple) | Option B (Scalable) |
|---|---|---|
| Backend | Python Flask | Node.js / Next.js |
| Face validation | `face_recognition` (Python) | API call to same pipeline |
| File storage | Local folder (`profiles/`) | AWS S3 or Google Cloud Storage |
| Auth | Email + Member ID | Google OAuth (club Gmail) |
| Database | SQLite | PostgreSQL |
| Hosting | Local Mac / NAS | Fly.io / Railway (free tier) |

---

## Part D — Where to Place Privacy Consent

### Summary: 4 Touchpoints

| # | Where | What | When |
|---|---|---|---|
| 1 | **Member Registration Form** | Brief notice + consent checkbox | When a member first joins MMR |
| 2 | **Profile Photo Submission Form** | Full facial recognition data policy + explicit consent checkbox (Section 4 above) | Every time a member submits profile photos |
| 3 | **Photo Notification Emails** | One-line reminder + opt-out link | Every time the system sends "you're in this photo" notifications |
| 4 | **Club Website / Privacy Policy Page** | Full standalone policy document | Permanently accessible; linked from all forms and emails |

### Detail

**Touchpoint 1 — Member Registration Form**
Add a short paragraph to the existing registration form:
> "MMR may use facial recognition technology to identify members in event photos. Full details are in our [Privacy Policy]. You may opt out by contacting admin@mmr.org.hk."
A checkbox: "I agree to MMR's Privacy Policy including the use of facial recognition for photo identification."

**Touchpoint 2 — Profile Photo Submission Form**
This is the most important touchpoint. Use the full consent block from Section 4 above. This is where specific, informed, freely given consent is collected for the biometric data use. Store the consent record (member ID, timestamp, form version, IP address) in a secure log.

**Touchpoint 3 — Photo Notification Emails**
Every automated email that says "You appear in these photos" should include a footer:
> "You are receiving this because you opted in to MMR photo identification. [Manage preferences] [Opt out]"

**Touchpoint 4 — Privacy Policy Page**
The standalone policy should cover:
- What data is collected (photos, embeddings)
- How it is stored (encrypted, access-controlled, local only)
- How long it is kept (until membership ends + 30 days, or upon request)
- Who has access (admins only)
- Your rights (access, correction, deletion, withdrawal of consent)
- How to exercise your rights (email address, response timeline)
- Compliance references (PDPO Hong Kong / GDPR if applicable)

### Recommended Consent Record to Log (per submission)

```json
{
  "member_id": "A0042",
  "member_name": "Jane Smith",
  "consent_given": true,
  "consent_version": "v1.0-2026-03",
  "timestamp_utc": "2026-03-15T09:42:00Z",
  "form_url": "https://forms.gle/...",
  "ip_address": "redacted-or-hashed"
}
```

Store this in a `consent_log.json` or a secure spreadsheet. This is your audit trail if a member later disputes having consented.

---

## Part E — Phase 3 Pipeline: From Submission to Notification

This section describes how the collected member profile photos flow into the automated face recognition pipeline.

### How submitted photos feed into `bib_analyzer.py`

Once a member submits photos via the Google Form or web app, their files are saved to the `members/` folder using the naming convention `A0042_Jane_Smith.jpg` (up to five photos: `_2`, `_3`, etc.).

The `bib_analyzer.py` script does **not** use these member profile photos directly. Instead, it:

1. Finds the member in event photos via their bib number (`output.json` from Phase 1/2)
2. Extracts the best face crop from those event photos automatically
3. Scans the full event album for additional photos of that person

The submitted profile photos are reserved for a future direct-matching mode (planned Phase 3 extension) where the system will cross-reference member photos against detected faces without needing a bib number as the starting point.

### Post-event workflow for admins

```
After each race event:

1. Run Phase 1+2 pipeline on the event album:
   python src/process_photos.py --input-dir ./album_mmr --output output.json

2. For each member who wants their photos:
   python src/bib_analyzer.py <bib_number>

   Output:
     bib_results/faces/bib_<number>/   ← best headshots extracted from event photos
     bib_results/bib_<number>_matches.json

3. Review bib_results/bib_<number>_matches.json
   → matches.with_bib    confirmed photos (bib was readable)
   → matches.without_bib new photos to send the member (bib not detected but face matched)

4. Send the member all photos from both lists.
```

### Tolerance tuning by event type

Different race conditions affect face recognition reliability. Adjust `--tolerance` accordingly:

| Race condition | Recommended tolerance | Notes |
|---------------|----------------------|-------|
| Small event, clear shots | `0.45` | Strict — avoids false positives |
| Standard road race | `0.55` | Recommended default |
| Crowded start/finish zone | `0.65` | Lenient — catches partial/angled faces |

If a member reports missing photos, re-run with a higher tolerance:
```bash
python src/bib_analyzer.py 1330 --tolerance 0.65 --out bib_results_lenient/
```

### Privacy note for face recognition results

The `bib_results/` directory contains extracted face crops and face encoding data (stored in memory only — not written to disk). The JSON result files contain bounding box coordinates but no biometric embeddings. Treat the headshot images in `bib_results/faces/` as personal data under PDPO/GDPR and delete them after sending photos to the member.

---

*MMR Photo Manager — Data Collection & Privacy Spec v1.1 — March 2026*
