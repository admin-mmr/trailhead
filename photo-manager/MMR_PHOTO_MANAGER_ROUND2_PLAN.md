**MMR Photo Manager**

Round 2 Development Plan

*Azure Infrastructure, Tiered Storage & Face Recognition Pilot*

March 2026

Prepared for: MMR Admin Team

Executive Summary

This document defines the Round 2 development plan for MMR Photo
Manager, addressing three critical design decisions as the system moves
from prototype to production on Azure infrastructure.

  -------------------------------- -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Question**                     **Recommendation**
  **Q1: File Management & SSOT**   Google Drive remains SSOT for raw photos. Azure Blob stores only processed artifacts (thumbnails, face crops, embeddings). No bulk photo copy to Azure.
  **Q2: Tiered Storage**           3-tier system: Hot (current season, Google Drive) → Warm (1--3 years, Google Drive compressed) → Cold (3+ years, Azure Archive Blob). Curated Memory Lane photos stay Hot permanently.
  **Q3: Face Recognition Pilot**   Two-phase pilot: Phase A uses Detection + Verify (no Microsoft approval needed) to prove accuracy. Phase B applies for Limited Access to unlock PersonGroup Identify for 1:N matching at scale.
  -------------------------------- -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

Q1: File Management & SSOT Design

Current State Analysis

Based on the existing codebase and Azure infrastructure, the current
photo flow works as follows:

-   Google Drive is the canonical storage for all raw race photos,
    organized by event folders.

-   photo-manager reads from Google Drive via the basecamp
    GoogleDriveClient.

-   Azure Blob Storage (mmrunnersstorage) has an mmr-photos container,
    but it currently stores member profile photos and payment
    screenshots --- not event albums.

-   The process\_photos.py pipeline runs locally, reading photos from a
    downloaded directory and writing output.json results.

-   bib\_analyzer.py uses local face\_recognition (dlib) for face
    matching, keeping encodings in memory only.

Recommendation: Do NOT Copy Raw Photos to Azure

After analyzing your cost structure, data volumes, and pipeline
architecture, the clear recommendation is to keep Google Drive as the
single source of truth (SSOT) for raw photos. Here is the rationale:

Cost Comparison

  ------------------- ------------------------------------ ---------------------- ---------------------------
  **Factor**          **Google Drive**                     **Azure Blob (Hot)**   **Azure Blob (Cool)**
  Storage/GB/month    \~\$0.01 (pooled with Workspace)     \$0.018                \$0.01
  100GB annual cost   \~\$0 (included in Workspace plan)   \~\$22/year            \~\$12/year
  Egress (reads)      Free within Google ecosystem         \$0.08/GB              \$0.01/GB + retrieval fee
  Redundancy          Built-in (Google infrastructure)     LRS included           LRS included
  ------------------- ------------------------------------ ---------------------- ---------------------------

For a running club with \~100--500 members and 10--20 events per year,
the raw photo volume is roughly 50--200GB annually. Duplicating this to
Azure would add \$12--40/year in storage alone, plus egress costs every
time the pipeline runs. Google Drive is effectively free within the
existing Google Workspace plan.

What Azure Blob SHOULD Store

Azure Blob Storage should be reserved for processed artifacts that the
web app and API need to serve directly:

  --------------------- -------------------------------------------------------- -------------------------------------------------
  **Container**         **Contents**                                             **Purpose**
  mmr-photos            Member profile photos (4--6 per member, \~2MB each)      Azure Face API enrollment; web portal display
  mmr-face-crops        Extracted headshots from event photos (50--200KB each)   Face verification reference; admin review
  mmr-thumbnails        Resized event photo thumbnails (100--300KB each)         Web gallery display; member notification emails
  mmr-pipeline-output   output.json, bib\_results JSON files                     Pipeline state; API queries; dashboard data
  mmr-snapshots         Google Sheets sync snapshots (already exists)            Bi-directional sync audit trail
  --------------------- -------------------------------------------------------- -------------------------------------------------

SSOT Architecture

The data ownership model should be:

-   Google Drive = SSOT for raw photos (original event albums, member
    profile submissions via Google Form)

-   Azure MySQL = SSOT for structured data (members, events, photo
    metadata, activity logs)

-   Azure Blob = derived/processed artifacts only (thumbnails, face
    crops, pipeline outputs)

-   If Google Drive goes down, the pipeline pauses but no data is lost
    (Google handles redundancy).

-   If Azure Blob is cleared, it can be fully regenerated by re-running
    the pipeline against Google Drive.

This means the Azure Blob containers are essentially a cache layer. The
regenerability principle keeps the system simple and avoids dual-master
synchronization complexity.

Q2: Tiered Photo Storage & Archival Design

The Problem

After each race season, the photo volume grows but member interest in
older photos drops sharply. Most photos are action shots of varying
quality --- only a few per event truly matter for the \"Memory Lane\"
experience. Keeping everything in hot storage is wasteful, but deleting
photos risks losing irreplaceable moments.

3-Tier Storage Architecture

  ---------- -------------- --------------------------------------- ------------------------------------------------------------------------------------------------------ ------------------------
  **Tier**   **Age**        **Location**                            **Contents**                                                                                           **Cost/100GB**
  **HOT**    0--12 months   Google Drive (original event folders)   All photos from current season + curated Memory Lane photos from all time                              \~\$0 (Workspace plan)
  **WARM**   1--3 years     Google Drive (archive subfolder)        Representative photos only (top 10--20% by quality + face matches). Thumbnails remain in Azure Blob.   \~\$0 (Workspace plan)
  **COLD**   3+ years       Azure Blob Archive tier                 Compressed ZIP of full album. 180-day minimum retention. Retrieval takes hours.                        \$0.20/year
  ---------- -------------- --------------------------------------- ------------------------------------------------------------------------------------------------------ ------------------------

Memory Lane Curation Process

The key insight is that \"representative photos\" are not random ---
they are the photos that members actually care about. The curation
process should be semi-automated:

1.  Auto-score at pipeline time: process\_photos.py already computes
    quality\_score. Photos with quality \> 0.7 AND a detected face AND a
    matched bib are automatically flagged as candidates.

2.  Member self-selection: When members receive their post-event photo
    notification, they can \"star\" their favorites. Starred photos
    automatically get Memory Lane status.

3.  Admin curation: For each event, admins select 5--10 \"highlight\"
    photos (best group shots, finish line moments, scenic shots) that
    represent the event overall.

4.  Auto-promote face matches: Any photo where Azure Face API returns a
    high-confidence match (\>0.85) is automatically promoted to Memory
    Lane for that member.

Archival Workflow

This should run as a scheduled GitHub Actions job quarterly:

1.  Identify events older than 12 months that have not been archived
    yet.

2.  For each event, query the MySQL photo metadata table: separate
    Memory Lane photos from bulk.

3.  Memory Lane photos: Move to a dedicated Google Drive folder (\"MMR
    Archive / Memory Lane / {year}\"). These stay on Google Drive
    forever.

4.  Bulk photos (non-Memory Lane): ZIP the entire event folder, upload
    to Azure Blob Archive tier (mmr-cold-archive container), then delete
    originals from Google Drive.

5.  Update MySQL: Set photo.storage\_tier = \'cold\' and
    photo.archive\_blob\_path for archived photos.

6.  If a member later requests a cold photo, the admin triggers a
    retrieval (takes up to 15 hours from Azure Archive tier) and
    provides a temporary download link.

Database Schema Addition

Add these columns to the photos table to support tiered storage:

  ----------------------- -------------------------------------------------------------------- -----------------------------------------------------------
  **Column**              **Type**                                                             **Purpose**
  storage\_tier           ENUM(\'hot\',\'warm\',\'cold\')                                      Current storage tier for this photo
  is\_memory\_lane        BOOLEAN DEFAULT FALSE                                                Flagged as representative / curated photo
  memory\_lane\_reason    ENUM(\'quality\',\'member\_star\',\'admin\_pick\',\'face\_match\')   Why this photo was promoted
  archive\_blob\_path     VARCHAR(500) NULL                                                    Azure Blob path for cold-tier ZIP
  archived\_at            TIMESTAMP NULL                                                       When the photo was moved to cold storage
  thumbnail\_blob\_path   VARCHAR(500) NULL                                                    Azure Blob path for thumbnail (persists across all tiers)
  ----------------------- -------------------------------------------------------------------- -----------------------------------------------------------

Q3: Azure Face API Pilot Test Workflow

Current State

Your codebase already has a solid foundation in azure\_face.py with
three capabilities: Detection (find faces, return bounding boxes +
quality attributes), Verification (1:1 compare two face images), and
Identification (1:N match against a PersonGroup). Detection and
Verification work without special approval. Identification
(PersonGroup/Identify) requires Microsoft Limited Access approval.

The existing bib\_analyzer.py uses the local face\_recognition library
(dlib) for face matching. This works offline but is slower and less
accurate than Azure Face API, especially for challenging conditions like
sunglasses, hats, and varying lighting that are common in race photos.

Pilot Design: Two Phases

Phase A: Detection + Verification (No Approval Needed)

Goal: Prove Azure Face API accuracy against your actual race photos and
member profiles, using only the APIs available today. This can start
immediately.

**Input Requirements (What You Need to Prepare):**

  -------------------------- ---------------------------------------------------------------------------------------------------------------------------------------- ----------------------------------------------------------------------------------------
  **Input**                  **Spec**                                                                                                                                 **Why It Matters**
  Test member profiles       5--10 members, each with 4--6 profile photos per the member-photo-instructions.md spec (running gear, sunglasses, hat, casual, formal)   Diverse appearances train the pilot properly. Follow the 5-type photo guide.
  Test event album           1 recent race event album with 100--500 photos. Must include photos where the test members are visible.                                  Real-world conditions: crowd, motion blur, varied lighting, sunglasses, hats.
  Ground truth spreadsheet   For each test member + event photo, a manual yes/no: \"Is this member in this photo?\" Even 20--30 labeled pairs is enough.              Needed to compute precision/recall. Without ground truth, you cannot measure accuracy.
  Azure Face resource        Already configured: AZURE\_FACE\_KEY + AZURE\_FACE\_ENDPOINT in .env.local. Standard S0 tier (\$1/1000 calls).                           The existing azure\_face.py module is ready to use.
  -------------------------- ---------------------------------------------------------------------------------------------------------------------------------------- ----------------------------------------------------------------------------------------

**Pilot Script:** pilot\_verify.py

This script implements the Phase A pilot workflow. It should be created
at photo-manager/src/pilot\_verify.py:

1.  Load test member profile photos from a designated folder (e.g.,
    pilot\_data/profiles/{member\_id}/)

2.  Load test event album photos from pilot\_data/event\_album/

3.  For each event photo, call detect\_faces() to find all faces and get
    face\_ids

4.  For each detected face, call verify\_faces() against every test
    member profile photo (1:1 comparison)

5.  Record results: (event\_photo, detected\_face\_bbox,
    best\_match\_member\_id, confidence\_score)

6.  Compare against ground truth spreadsheet to compute precision,
    recall, and F1 score

7.  Output a pilot\_results.json with per-member accuracy and a summary
    CSV for review

**Key Metrics to Capture:**

  ------------------------- ------------------------------------------------------------ ---------------------------------------------------------
  **Metric**                **Definition**                                               **Target**
  Detection Rate            \% of faces in event photos successfully detected by Azure   \> 90% (expect \~95%+ for frontal/semi-profile)
  True Positive Rate        \% of correct matches at threshold 0.50                      \> 85%
  False Positive Rate       \% of wrong matches (different person matched)               \< 5%
  Confidence Distribution   Histogram of confidence scores for true vs false matches     Clear separation between true (\>0.6) and false (\<0.4)
  Hat/Sunglasses Impact     Accuracy difference: bare face vs hat vs sunglasses          Document the drop-off for tuning guidance
  API Latency               Average ms per detect + verify call                          \< 2s per photo (for batch feasibility)
  Cost per Event            Total API calls x \$0.001 for a typical 300-photo album      \< \$5 per event
  ------------------------- ------------------------------------------------------------ ---------------------------------------------------------

**Expected Challenges:**

-   Verify is 1:1, so with 10 members and 300 event photos, you need up
    to 300 x 10 x 5 = 15,000 verify calls. At \$0.001/call, this is
    \~\$15 for one pilot run. Optimize by only verifying faces in photos
    where detection found a face.

-   Race photos with heavy motion blur or very distant subjects will
    have lower detection rates. Filter by the blur and exposure
    attributes returned by detect\_faces() to skip poor-quality faces
    before verification.

-   Sunglasses reduce accuracy by \~10--15%. Hats have less impact. This
    is why the member photo instructions request both sunglasses and hat
    variants.

Phase B: PersonGroup Identify (Requires Microsoft Approval)

Once Phase A proves the accuracy is acceptable, apply for Microsoft
Limited Access at https://aka.ms/facerecognition. With approval, you
unlock the most powerful workflow:

1.  Create a PersonGroup using create\_person\_group() --- already
    implemented in azure\_face.py.

2.  Enroll all members using add\_member\_photo() --- upload 4--6
    profile photos per member.

3.  Train the group using train\_group() --- Azure builds an optimized
    face model for your member roster.

4.  For each event album, run identify\_faces() on every photo --- Azure
    returns candidate member matches with confidence scores in a single
    API call per photo.

5.  This eliminates the O(N x M) verification loop. Instead, it is O(P)
    where P = number of event photos, regardless of member count.

**Phase B Advantages:**

-   10x faster: One API call per photo instead of one per (photo x
    member).

-   10x cheaper: 300 photos = 300 API calls (\~\$0.30) instead of 15,000
    (\~\$15).

-   Better accuracy: Azure trains a specialized model on your member
    photos, not just generic face distance.

-   Scales to hundreds of members with no performance degradation.

Pilot Showcase Workflow

For a compelling demo to stakeholders, run this end-to-end showcase on
one real event:

1.  Prepare: Collect profile photos from 5--10 volunteer members using
    the member-photo-instructions.md guide. Manually label 20--30 ground
    truth photo pairs.

2.  Detect: Run detect\_faces() on the full event album. Show the face
    count, bounding boxes, and quality attributes overlaid on sample
    photos.

3.  Match: Run the verification loop (Phase A) or identify (Phase B).
    Display a dashboard showing each member with their matched event
    photos side-by-side.

4.  Compare: Run the same matching with the existing local
    face\_recognition (dlib) pipeline. Show accuracy comparison: Azure
    vs local, with the ground truth as reference.

5.  Demonstrate edge cases: Show before/after for sunglasses, hats, and
    varied lighting. Highlight where Azure outperforms (or
    underperforms) dlib.

6.  Cost projection: Extrapolate from the pilot to a full season (20
    events x 300 photos x 200 members) and present the cost estimate.

Implementation Timeline

  ------------------------------ -------------- ---------------------------------------------------------------------------------------------------------------------------------------- ---------------------------------------------------------------------------------------
  **Phase**                      **Duration**   **Deliverables**                                                                                                                         **Dependencies**
  **R2.1: Blob Architecture**    Week 1--2      Create Azure Blob containers (face-crops, thumbnails, pipeline-output). Thumbnail generation pipeline. MySQL schema additions.           Azure Portal access. Storage connection string in GitHub Secrets.
  **R2.2: Face Pilot Phase A**   Week 2--4      pilot\_verify.py script. Ground truth collection from 5--10 volunteers. Accuracy report with metrics dashboard.                          Volunteer member profile photos. One recent event album. AZURE\_FACE\_KEY configured.
  **R2.3: Tiered Storage**       Week 4--6      Archival GitHub Actions workflow. Memory Lane curation UI. Cold-tier retrieval admin tool.                                               R2.1 Blob containers ready. Admin review of curation criteria.
  **R2.4: Face Pilot Phase B**   Week 6--8      Microsoft Limited Access application. PersonGroup enrollment pipeline. Identify integration into process\_photos.py.                     R2.2 accuracy report proving need. Microsoft approval (2--10 business days).
  **R2.5: Integration & Demo**   Week 8--10     End-to-end showcase. Azure vs dlib comparison report. Cost projection for full season. process\_photos.py v2 with face module enabled.   All prior phases complete.
  ------------------------------ -------------- ---------------------------------------------------------------------------------------------------------------------------------------- ---------------------------------------------------------------------------------------

Appendix A: Pilot Data Folder Structure

Set up this folder structure in photo-manager/ before running the pilot:

**pilot\_data/**

profiles/ (member profile photos)

A0042\_jane\_smith/

running\_no\_hat.jpg (Type 1: running gear, face clear)

running\_sunglasses.jpg (Type 2: running gear + sunglasses)

running\_hat.jpg (Type 3: running gear + hat)

casual.jpg (Type 4: everyday clothes)

formal.jpg (Type 5: smart attire, optional)

A0015\_john\_doe/

\... (same structure)

event\_album/ (one real race event)

IMG\_0001.jpg

IMG\_0002.jpg

\... (100--500 photos)

ground\_truth.csv (manual labels)

**ground\_truth.csv format:**

event\_photo, member\_id, is\_present

IMG\_0042.jpg, A0042, yes

IMG\_0042.jpg, A0015, no

IMG\_0099.jpg, A0042, yes

\...

Aim for at least 20--30 labeled pairs to get statistically meaningful
results. Prioritize diversity: include photos where members are wearing
different outfits, in crowd vs solo shots, and at different distances
from the camera.

Appendix B: Azure Resource Additions

  --------------------- ------------------- ---------------------------------------- -----------------------
  **Resource**          **Type**            **Config**                               **Est. Monthly Cost**
  mmr-face-crops        Blob Container      Hot tier, LRS, in mmrunnersstorage       \< \$0.50
  mmr-thumbnails        Blob Container      Hot tier, LRS, in mmrunnersstorage       \< \$0.50
  mmr-pipeline-output   Blob Container      Hot tier, LRS, in mmrunnersstorage       \< \$0.10
  mmr-cold-archive      Blob Container      Archive tier, LRS, in mmrunnersstorage   \< \$0.02/100GB
  Face API (existing)   Cognitive Service   S0 Standard tier                         \~\$5--15 per event
  --------------------- ------------------- ---------------------------------------- -----------------------

Total estimated additional Azure cost for Round 2: less than \$20/month
during active development, dropping to under \$5/month in steady state
between events.
