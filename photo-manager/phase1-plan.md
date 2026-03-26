**MMR Photo Manager**

Phase 1 --- Local Photo Processing Pipeline

Development Plan & Technical Specification

March 2026 \| v1.0 Draft

**1. Project Overview**

MMR Photo Manager is a system designed to systematically process,
analyze, and organize race event photos. Phase 1 establishes the local
processing pipeline --- a command-line tool that scans a given directory
of photos, analyzes each image using computer vision, and records
structured metadata to an output JSON file. This metadata will power all
downstream features: member notifications, social media content
selection, and photo search.

+---------------------------------------------------------------+
| **🎯 Phase 1 Goal**                                            |
|                                                               |
| Input: A local directory of race event photos (JPG/PNG)       |
|                                                               |
| Process: Run 5 analysis modules on each photo                 |
|                                                               |
| Output: A structured JSON file recording all analysis results |
|                                                               |
| Runtime: Fully local --- no cloud dependency required         |
+---------------------------------------------------------------+

**1.1 Context: MMR Photo Workflow**

After each race event, photographers deliver hundreds or thousands of
photos. Currently, organizing these photos, identifying which members
appear in which photos, and matching bib numbers to athlete profiles is
done manually. Phase 1 automates the analysis layer so that later phases
can automate the entire workflow.

**2. System Architecture**

**2.1 High-Level Flow**

The Phase 1 pipeline operates as a single Python script invoked from the
command line. It walks the input directory, processes each supported
image file through five analysis modules in sequence, collects results
into a structured record, and writes the cumulative output to a JSON
file.

  ---------- ----------------------- -----------------------------------------------------------------------------------------------------------------------------------------------------
  **Step**   **Module**              **Description**
  **1**      **Directory Walker**    Recursively scans input directory; filters supported formats (JPG, JPEG, PNG, HEIC); builds a queue of image paths
  **2**      **Quality Scorer**      Evaluates sharpness, exposure, noise, and composition to produce a normalized quality score (0.0 -- 1.0)
  **3**      **Face Detector**       Detects faces in the image, counts them, and optionally matches against member profile references using face embeddings
  **4**      **Bib Number Reader**   Uses OCR to extract bib numbers from the image; distinguishes the primary subject's bib from bib numbers of other runners visible in the background
  **5**      **People Counter**      Counts total number of people (not just faces) visible in the image using an object detection model
  **6**      **JSON Writer**         Aggregates all module outputs into a structured record and appends/overwrites the output JSON file
  ---------- ----------------------- -----------------------------------------------------------------------------------------------------------------------------------------------------

**2.2 Directory & File Structure**

The project is organized as follows:

photo\_manager/ --- project root

├── process\_photos.py --- main entry point

├── modules/ --- one file per analysis module

│ ├── quality.py

│ ├── faces.py

│ ├── bib\_ocr.py

│ └── people.py

├── profiles/ --- member profile photos for face matching

├── embeddings\_cache.pkl --- precomputed face embeddings
(auto-generated)

└── output.json --- analysis results output file

**3. Output JSON Schema**

Each processed image produces one record in the output JSON file. The
file is an array of objects, one per image. All fields are always
present; null indicates that a module could not produce a result for
that image (e.g., due to an error or unsupported format).

  ----------------- ------------------- ----------------------------------------------------------------------
  **Field**         **Type**            **Description**
  file\_path        string              Absolute path to the source photo file
  file\_name        string              Filename only (e.g., IMG\_4821.jpg)
  processed\_at     string (ISO 8601)   Timestamp when analysis was run
  quality\_score    float \| null       Overall photo quality score from 0.0 (poor) to 1.0 (excellent)
  quality\_detail   object \| null      Breakdown: { sharpness, exposure, noise, composition } each 0.0--1.0
  face\_count       integer \| null     Number of faces detected in the image
  face\_matches     array \| null       List of matched member records (see Face Match Object below)
  bib\_primary      string \| null      Bib number of the most prominent runner in the photo
  bib\_related      array               Bib numbers of other runners visible in the background
  people\_count     integer \| null     Total number of people detected (faces + bodies)
  error             string \| null      Error message if processing failed; null on success
  ----------------- ------------------- ----------------------------------------------------------------------

**3.1 Face Match Object**

Each item in the face\_matches array has the following structure:

  -------------- ------------------- ------------------------------------------------------
  **Field**      **Type**            **Description**
  member\_id     string              Unique member identifier from the profiles directory
  member\_name   string              Display name of the matched member
  confidence     float               Match confidence from 0.0 to 1.0 (threshold: 0.6)
  face\_bbox     array \[x,y,w,h\]   Bounding box of the matched face in pixels
  -------------- ------------------- ------------------------------------------------------

**3.2 Sample Output Record**

Below is an example of a single record in the output JSON array:

+----------------------------------------------------------------------+
| **output.json --- example record**                                   |
|                                                                      |
| {                                                                    |
|                                                                      |
| \"file\_path\": \"/photos/event-2026-03-15/IMG\_4821.jpg\",          |
|                                                                      |
| \"file\_name\": \"IMG\_4821.jpg\",                                   |
|                                                                      |
| \"processed\_at\": \"2026-03-15T09:42:11Z\",                         |
|                                                                      |
| \"quality\_score\": 0.83,                                            |
|                                                                      |
| \"quality\_detail\": { \"sharpness\": 0.91, \"exposure\": 0.78,      |
| \"noise\": 0.88, \"composition\": 0.75 },                            |
|                                                                      |
| \"face\_count\": 2,                                                  |
|                                                                      |
| \"face\_matches\": \[                                                |
|                                                                      |
| { \"member\_id\": \"mmr-0042\", \"member\_name\": \"Jane Smith\",    |
| \"confidence\": 0.87, \"face\_bbox\": \[312, 140, 98, 112\] }        |
|                                                                      |
| \],                                                                  |
|                                                                      |
| \"bib\_primary\": \"1042\",                                          |
|                                                                      |
| \"bib\_related\": \[\"2318\", \"875\"\],                             |
|                                                                      |
| \"people\_count\": 3,                                                |
|                                                                      |
| \"error\": null                                                      |
|                                                                      |
| }                                                                    |
+----------------------------------------------------------------------+

**4. Analysis Modules --- Detailed Specification**

**4.1 Photo Quality Scorer**

The quality scorer evaluates four signal dimensions and combines them
into a single composite score using a weighted average.

  ------------- ---------------------------------------------------------------------------------------- ------------
  **Signal**    **Method**                                                                               **Weight**
  Sharpness     Laplacian variance on grayscale image. Higher variance = sharper.                        35%
  Exposure      Histogram analysis: penalizes overexposed (\>250) and underexposed (\<5) pixel ratios.   30%
  Noise         Estimate via difference between image and Gaussian-blurred version.                      20%
  Composition   Rule-of-thirds face placement score; fallback to center-weighted crop score.             15%
  ------------- ---------------------------------------------------------------------------------------- ------------

Recommended libraries:

-   OpenCV (cv2) for Laplacian variance and histogram analysis

-   Pillow (PIL) for image loading and basic manipulation

-   NumPy for array-level pixel statistics

+----------------------------------------------------------------------+
| **⚠️ Calibration Note**                                              |
|                                                                      |
| Sharpness thresholds are sensitive to image resolution. Calibrate    |
| Laplacian variance thresholds on a sample set of 50-100 event photos |
| before deploying. A Laplacian variance above 100 is generally        |
| considered sharp for a 12MP image.                                   |
+----------------------------------------------------------------------+

**4.2 Facial Recognition**

Face detection and recognition are handled in two sub-steps:

1.  Detection --- Find all faces in the image and return bounding boxes.

2.  Recognition --- If a member profiles directory is provided, compare
    each detected face against the precomputed member embeddings and
    return matches above the confidence threshold.

  ---------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Sub-step**           **Recommended Approach**
  Face Detection         Use face\_recognition library (dlib-based) or MediaPipe Face Detection for speed. Fall back to OpenCV Haar cascades if dlib install is problematic.
  Embedding Generation   face\_recognition.face\_encodings() produces 128-dimension embeddings per face. Run once at setup time on all profile photos; cache to embeddings\_cache.pkl.
  Matching               Compare each detected face embedding against cached member embeddings using Euclidean distance. A distance \< 0.6 (configurable) is considered a match.
  ---------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------

The output includes face\_count (total faces detected regardless of
match) and face\_matches (list of members identified with confidence
score).

**4.3 Bib Number --- Primary**

The primary bib is the bib number worn by the most prominent runner in
the photo --- typically the largest, most centered, and sharpest person
in the frame. Detection pipeline:

3.  Detect all people in the image (bounding boxes via YOLOv8n or
    similar lightweight model).

4.  Rank people by a prominence score: combination of bounding box area,
    centrality, and sharpness of the crop.

5.  Crop the top-ranked person and run OCR on their chest/number region.

6.  Return the extracted bib number string, or null if no bib is
    legible.

Recommended libraries:

-   ultralytics (YOLOv8) for person detection

-   EasyOCR or pytesseract for bib text extraction

-   OpenCV for image cropping and pre-processing (contrast enhancement
    before OCR)

**4.4 Bib Numbers --- Related**

Related bib numbers are extracted from all other visible runners in the
photo (not the primary subject). This supports tagging multiple members
from a single group photo.

7.  Use the same person detection bounding boxes from 4.3.

8.  For each non-primary detected person, crop and run OCR on the chest
    region.

9.  Collect all successfully read bib numbers into the bib\_related
    array.

10. Deduplicate; exclude the primary bib if it appears.

+----------------------------------------------------------------------+
| **💡 OCR Tips for Bib Numbers**                                       |
|                                                                      |
| Resize the cropped bib region to at least 100px tall before OCR to   |
| improve accuracy.                                                    |
|                                                                      |
| Apply adaptive thresholding (cv2.adaptiveThreshold) to handle        |
| varying race bib background colors.                                  |
|                                                                      |
| Post-process: filter OCR output to digits only; reject results with  |
| length \< 2 or \> 6.                                                 |
|                                                                      |
| Consider building a known bib number whitelist from the race         |
| registration data for validation.                                    |
+----------------------------------------------------------------------+

**4.5 People Counter**

Counts the total number of distinct people visible in the photo using an
object detection model. This count includes runners partially visible at
the edges of the frame.

  ------------------------- ---------------------------------------------------------------------------------------------------------------------------------
  **Aspect**                **Detail**
  Model                     YOLOv8n (nano) --- fastest variant, suitable for batch processing on CPU. Upgrade to YOLOv8s for better accuracy on GPU.
  Class Filter              Filter detections to class 0 (person) only. Confidence threshold: 0.4.
  Output                    Integer count of person bounding boxes above threshold. Stored as people\_count.
  Relation to face\_count   people\_count \>= face\_count always. People with their back turned or wearing hats may be detected as people but not as faces.
  ------------------------- ---------------------------------------------------------------------------------------------------------------------------------

**5. Command-Line Interface**

The pipeline is invoked from the terminal. The script signature:

+----------------------------------------------------+
| **Usage**                                          |
|                                                    |
| python process\_photos.py \\                       |
|                                                    |
| \--input-dir /path/to/event/photos \\              |
|                                                    |
| \--output /path/to/output.json \\                  |
|                                                    |
| \--profiles ./profiles \\                          |
|                                                    |
| \[\--resume\] \[\--workers 4\] \[\--quality-only\] |
+----------------------------------------------------+

  ----------------- ------------- -----------------------------------------------------------------------------
  **Flag**          **Default**   **Description**
  \--input-dir      (required)    Path to the directory of photos to process
  \--output         output.json   Path to the output JSON file
  \--profiles       none          Path to the member profiles directory. Enables facial recognition matching.
  \--resume         false         Skip images already present in the output file (resume interrupted runs)
  \--workers        1             Number of parallel worker threads for processing
  \--quality-only   false         Run only the quality scorer (fastest, skips all CV models)
  \--min-quality    0.0           Minimum quality score to include a photo in output (filter low-quality)
  ----------------- ------------- -----------------------------------------------------------------------------

**6. Member Profile Photo Reference Guide**

Facial recognition accuracy depends heavily on the quality and
organization of the member profile photo references. This section
describes how to add and maintain profile photos so the system can
perform reliable face matching across event photos.

+----------------------------------------------------------------------+
| **🔑 Why Profile Photos Matter**                                      |
|                                                                      |
| Face recognition works by comparing a numeric \"embedding\"          |
| (128-dimensional vector) computed from the detected face in an event |
| photo against embeddings computed from member profile photos.        |
|                                                                      |
| The better the profile photo quality --- clear face, good lighting,  |
| unobstructed --- the more accurate the matching will be.             |
|                                                                      |
| One well-chosen profile photo per member is sufficient. Multiple     |
| photos improve accuracy further, especially if the member often      |
| wears hats or sunglasses during races.                               |
+----------------------------------------------------------------------+

**6.1 Profile Directory Structure**

Place all member profile photos in the profiles/ directory. Use the
following naming convention:

profiles/

├── mmr-0001\_jane-smith.jpg ← format: {member-id}\_{name}.jpg

├── mmr-0042\_john-doe.jpg

├── mmr-0042\_john-doe\_2.jpg ← second reference photo for same member

└── mmr-0107\_mary-jones.jpg

The member\_id prefix is used to link a match back to a member record.
The name portion is for human readability only. Multiple photos for the
same member must share the same member\_id prefix.

**6.2 Requirements for a Good Profile Photo**

Not all photos make good face references. Follow these requirements when
selecting or taking profile photos:

+----------------------------------+----------------------------------+
| **✅ DO --- Good Profile Photo**  | **❌ DON\'T --- Poor Profile      |
|                                  | Photo**                          |
+----------------------------------+----------------------------------+
| -   Clear frontal or 3/4 view of | -   Sunglasses, hats, or face    |
|     the face                     |     coverings                    |
|                                  |                                  |
| -   Face fills at least 30% of   | -   Group photos (multiple       |
|     the frame                    |     faces)                       |
|                                  |                                  |
| -   Even, natural lighting (no   | -   Profile / side-on pose (90°  |
|     harsh shadows)               |     from camera)                 |
|                                  |                                  |
| -   Eyes open and visible        | -   Motion blur or out-of-focus  |
|                                  |     face                         |
| -   Recent photo (within 2       |                                  |
|     years)                       | -   Heavy makeup or face paint   |
|                                  |     (race-day looks)             |
| -   Minimum resolution: 200 x    |                                  |
|     200 pixels                   | -   Very small face (\< 100 x    |
|                                  |     100 px)                      |
| -   JPG or PNG format            |                                  |
|                                  | -   Screenshots from video (low  |
|                                  |     resolution)                  |
+----------------------------------+----------------------------------+

**6.3 Adding a New Member Profile Photo --- Step by Step**

11. Obtain a suitable photo of the member (see requirements above). A
    headshot, a prior race finish photo with a clear face, or a profile
    photo from the club website all work well.

12. Rename the file to follow the convention:
    {member-id}\_{first-last}.jpg. Example: mmr-0042\_john-doe.jpg

13. Copy the file into the profiles/ directory in the photo-manager
    project folder.

14. Run the embedding regeneration command to include the new member:

+----------------------------------------------------------------------+
| **Rebuild embeddings after adding profiles**                         |
|                                                                      |
| python process\_photos.py \--rebuild-embeddings \--profiles          |
| ./profiles                                                           |
|                                                                      |
| This reads all profile photos, computes face embeddings, and saves   |
| them to embeddings\_cache.pkl.                                       |
|                                                                      |
| This step only needs to be repeated when profiles are added,         |
| removed, or updated.                                                 |
+----------------------------------------------------------------------+

15. Verify the member was added correctly by checking the output:

+----------------------------------------------------------------------+
| **Verify embedding generation**                                      |
|                                                                      |
| python process\_photos.py \--list-profiles                           |
|                                                                      |
| Output example:                                                      |
|                                                                      |
| mmr-0001 Jane Smith 1 reference photo OK                             |
|                                                                      |
| mmr-0042 John Doe 2 reference photos OK                              |
|                                                                      |
| mmr-0107 Mary Jones 1 reference photo WARNING: face not detected in  |
| photo                                                                |
+----------------------------------------------------------------------+

If a profile photo shows WARNING: face not detected, replace it with a
clearer photo and rebuild embeddings.

**6.4 Improving Matching Accuracy**

When the system produces false positives (wrong member matched) or
misses a member who is clearly in the photo, use these strategies:

-   Add a second profile photo: Members photographed from various angles
    or wearing race gear (headbands, visors) benefit greatly from a
    second reference photo taken in race conditions.

-   Use a race-day photo as a second reference: Find an event photo
    where the member was positively identified (e.g., by bib match), and
    add that crop as a second profile photo for the member.

-   Adjust the match threshold: The default distance threshold is 0.6.
    Lower it (e.g., 0.5) for stricter matching with fewer false
    positives; raise it (e.g., 0.7) if too many correct members are
    being missed.

-   Re-check outdated photos: If a member has significantly changed
    appearance (hair, weight), update their profile photo.

**6.5 Privacy & Consent Considerations**

+----------------------------------------------------------------------+
| **🔒 Privacy Notice**                                                 |
|                                                                      |
| Before adding member profile photos and computing face embeddings,   |
| ensure that:                                                         |
|                                                                      |
| 1\. The member has consented to having their facial recognition data |
| stored.                                                              |
|                                                                      |
| 2\. The profiles directory and embeddings\_cache.pkl are stored      |
| securely and not committed to a public repository.                   |
|                                                                      |
| 3\. Members can request removal of their profile at any time; after  |
| removal, rebuild the embeddings cache.                               |
+----------------------------------------------------------------------+

**7. Dependencies & Setup**

**7.1 Python Dependencies**

  ------------------- ------------- -------------------------------------------------------------
  **Package**         **Version**   **Purpose**
  opencv-python       \>=4.8        Image loading, Laplacian sharpness, histogram, thresholding
  Pillow              \>=10.0       HEIC support via pillow-heif; general image I/O
  numpy               \>=1.24       Pixel array operations
  face\_recognition   \>=1.3        Face detection and embedding generation (requires dlib)
  ultralytics         \>=8.0        YOLOv8 person detection for bib and people count
  easyocr             \>=1.7        Bib number OCR (GPU-accelerated if available)
  tqdm                \>=4.66       Progress bar for batch processing
  pillow-heif         \>=0.13       HEIC/HEIF format support for iPhone photos
  ------------------- ------------- -------------------------------------------------------------

**7.2 Installation**

+----------------------------------------------------------------------+
| **Setup commands**                                                   |
|                                                                      |
| \# Create virtual environment                                        |
|                                                                      |
| python -m venv .venv && source .venv/bin/activate                    |
|                                                                      |
| \# Install dependencies                                              |
|                                                                      |
| pip install opencv-python Pillow numpy tqdm pillow-heif              |
|                                                                      |
| pip install face\_recognition \# installs dlib automatically         |
|                                                                      |
| pip install ultralytics \# YOLOv8                                    |
|                                                                      |
| pip install easyocr \# OCR engine                                    |
|                                                                      |
| \# First run: YOLO and EasyOCR models download automatically (\~50MB |
| each)                                                                |
+----------------------------------------------------------------------+

**8. Phased Delivery Plan**

  ------------ ------------------------ ------------------------------------------------------------------------------------------------- --------------
  **Sprint**   **Deliverable**          **Tasks**                                                                                         **Estimate**
  **S1**       **Scaffold + Quality**   Project structure, CLI skeleton, directory walker, quality scorer, JSON writer, basic tests       3-4 days
  **S2**       **People & Bib**         YOLOv8 person detection, primary bib OCR, related bib extraction, OCR post-processing             4-5 days
  **S3**       **Face Recognition**     dlib install, face detection, embedding cache, member matching, profiles tooling                  3-4 days
  **S4**       **Hardening**            Error handling, resume mode, parallel workers, calibration tuning on real photos, documentation   2-3 days
  ------------ ------------------------ ------------------------------------------------------------------------------------------------- --------------

Total estimated Phase 1 duration: 12--16 developer-days.

**9. Success Criteria**

Phase 1 is considered complete when the following acceptance criteria
are met on a real event photo set of at least 200 images:

-   Quality scorer runs on 100% of JPG/PNG/HEIC images without crashing.

-   Bib OCR correctly reads the primary bib number in at least 70% of
    photos where a bib is clearly visible.

-   Face matching correctly identifies a member with \> 0.80 confidence
    in at least 85% of test cases where the member\'s profile photo is
    loaded.

-   People count is within ±1 of the ground truth for at least 90% of
    photos with 1--5 people.

-   Output JSON is valid, complete (no missing fields), and append-safe
    (running the script twice on the same directory does not duplicate
    records in resume mode).

-   Processing speed: at least 30 photos per minute on a modern laptop
    CPU with all modules enabled.

MMR Photo Manager --- Phase 1 Development Plan \| v1.0 Draft \| March
2026
