/* ── MMR Photo Review App — Client-side JS ──────────────── */

// ─── Flash notifications ───────────────────────────────────

function showFlash(msg, type) {
    type = type || 'ok';
    const el = document.createElement('div');
    el.className = 'flash flash-' + type;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.3s';
        setTimeout(() => el.remove(), 300);
    }, 2000);
}


// ─── Canvas overlay drawing (review page) ──────────────────

function drawOverlays() {
    const canvas = document.getElementById('overlay-canvas');
    const img = document.getElementById('review-img');
    if (!canvas || !img || typeof RECORD === 'undefined') return;

    const wrap = document.getElementById('image-wrap');
    const rect = img.getBoundingClientRect();

    // Match canvas to displayed image size
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const showBoxes = document.getElementById('show-boxes');
    const showBibs = document.getElementById('show-bibs');
    const showOutfit = document.getElementById('show-outfit');

    const boxes = RECORD.people_boxes || [];
    if (boxes.length === 0) return;

    // Compute scale from original image to displayed size.
    // people_boxes bboxes are in the pipeline's resized coordinates.
    // For overlay purposes, we scale bbox coords relative to the
    // displayed image dimensions. The pipeline works on images resized
    // to a max of DETECTION_MAX_PX (1280), but the review image is
    // displayed at its natural fetch size. We need the natural image
    // dimensions to compute the correct scale.
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const scaleX = rect.width / natW;
    const scaleY = rect.height / natH;

    // However, bboxes from the pipeline are in resized coordinates
    // (max 1280px). Compute the pipeline resize factor.
    const DETECTION_MAX_PX = 1280;
    let pipeScale = 1;
    if (natW > DETECTION_MAX_PX || natH > DETECTION_MAX_PX) {
        pipeScale = DETECTION_MAX_PX / Math.max(natW, natH);
    }
    // Effective scale: from pipeline coords to display coords
    const sx = scaleX / pipeScale;
    const sy = scaleY / pipeScale;

    const colors = ['#5b8def', '#4caf88', '#e09040', '#e05555', '#9b7ee8', '#d4b83e'];

    boxes.forEach((person, i) => {
        const bbox = person.bbox;
        if (!bbox) return;

        const [bx, by, bw, bh] = bbox;
        const x = bx * sx;
        const y = by * sy;
        const w = bw * sx;
        const h = bh * sy;
        const color = colors[i % colors.length];

        // Person bounding box
        if (showBoxes && showBoxes.checked) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            ctx.strokeRect(x, y, w, h);

            // Person index label
            ctx.fillStyle = color;
            ctx.font = 'bold 12px sans-serif';
            const label = 'P' + i;
            const tm = ctx.measureText(label);
            ctx.fillRect(x, y - 16, tm.width + 8, 16);
            ctx.fillStyle = '#fff';
            ctx.fillText(label, x + 4, y - 4);
        }

        // Bib labels
        if (showBibs && showBibs.checked && person.bib_number) {
            ctx.fillStyle = 'rgba(91,141,239,0.85)';
            const bibLabel = 'Bib: ' + person.bib_number;
            ctx.font = 'bold 11px sans-serif';
            const btm = ctx.measureText(bibLabel);
            ctx.fillRect(x, y + h + 2, btm.width + 8, 16);
            ctx.fillStyle = '#fff';
            ctx.fillText(bibLabel, x + 4, y + h + 14);
        }

        // Outfit color swatches
        if (showOutfit && showOutfit.checked && person.outfit_signature) {
            const sig = person.outfit_signature;
            const dc = sig.dominant_colors || [];
            const swatchSize = 14;
            dc.forEach((hsv, ci) => {
                // Convert HSV (OpenCV: H 0-180, S 0-255, V 0-255) to CSS
                const hue = hsv[0] * 2;       // OpenCV H is 0-180, CSS is 0-360
                const sat = (hsv[1] / 255) * 100;
                const lit = (hsv[2] / 255) * 50; // rough V -> L mapping
                ctx.fillStyle = 'hsl(' + hue + ',' + sat + '%,' + Math.max(20, lit) + '%)';
                ctx.fillRect(x + w + 4, y + ci * (swatchSize + 2), swatchSize, swatchSize);
                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + w + 4, y + ci * (swatchSize + 2), swatchSize, swatchSize);
            });
        }

        // Facing direction arrow
        if (showBoxes && showBoxes.checked && person.facing) {
            const facing = person.facing;
            const cx = x + w / 2;
            const cy = y + h * 0.3;
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.font = '16px sans-serif';
            let arrow = '';
            if (facing === 'camera') arrow = '\u25CF';       // dot = facing camera
            else if (facing === 'away') arrow = '\u25CB';     // circle = away
            else if (facing === 'left') arrow = '\u25C0';     // left
            else if (facing === 'right') arrow = '\u25B6';    // right
            if (arrow) ctx.fillText(arrow, cx - 8, cy);
        }
    });

    // Draw bib_primary highlight if available
    if (showBibs && showBibs.checked && RECORD.bib_primary) {
        const bp = typeof RECORD.bib_primary === 'object' ? RECORD.bib_primary : null;
        if (bp && bp.bbox) {
            const [bx, by, bw, bh] = bp.bbox;
            ctx.strokeStyle = '#5b8def';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(bx * sx, by * sy, bw * sx, bh * sy);
            ctx.setLineDash([]);
        }
    }
}


// ─── Annotation submission ─────────────────────────────────

function submitAnnotation(status) {
    if (typeof RECORD === 'undefined') return;

    const form = document.getElementById('annotation-form');
    if (!form) return;

    const data = {
        file_path:          form.file_path.value,
        file_name:          form.file_name.value,
        review_status:      status,
        reviewed_by:        'admin',
        difficulty:         form.difficulty.value || null,
        notes:              form.notes.value || null,
        bib_correct:        form.bib_correct.value !== '' ? parseInt(form.bib_correct.value) : null,
        bib_override:       form.bib_override.value || null,
        face_correct:       form.face_correct.value !== '' ? parseInt(form.face_correct.value) : null,
        member_id_override: form.member_id_override.value || null,
        quality_score:      RECORD.quality_score,
        people_count:       RECORD.people_count,
        bib_primary:        typeof RECORD.bib_primary === 'object' && RECORD.bib_primary
                            ? RECORD.bib_primary.number : RECORD.bib_primary,
        match_tier:         RECORD.match_tier || null,
        match_conf:         RECORD.match_conf || null,
        face_score:         RECORD.face_score || null,
        outfit_score:       RECORD.outfit_score || null,
    };

    fetch('/api/annotate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data),
    })
    .then(r => r.json())
    .then(resp => {
        if (resp.ok) {
            showFlash('Saved: ' + status);
            // Auto-advance to next photo after short delay
            setTimeout(() => {
                if (typeof NEXT_IDX !== 'undefined' && NEXT_IDX !== IDX) {
                    window.location.href = '/review/' + NEXT_IDX;
                }
            }, 400);
        } else {
            showFlash(resp.error || 'Save failed', 'err');
        }
    })
    .catch(() => showFlash('Network error', 'err'));
}


// ─── Keyboard shortcuts ────────────────────────────────────

document.addEventListener('keydown', function(e) {
    // Only on review page
    if (typeof IDX === 'undefined') return;
    // Don't trigger if typing in an input
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    switch (e.key) {
        case 'ArrowLeft':
            e.preventDefault();
            if (typeof PREV_IDX !== 'undefined') {
                window.location.href = '/review/' + PREV_IDX;
            }
            break;
        case 'ArrowRight':
            e.preventDefault();
            if (typeof NEXT_IDX !== 'undefined') {
                window.location.href = '/review/' + NEXT_IDX;
            }
            break;
        case '1':
            submitAnnotation('confirmed');
            break;
        case '2':
            submitAnnotation('rejected');
            break;
        case '3':
            submitAnnotation('needs_recheck');
            break;
    }
});


// ─── Window resize handling ────────────────────────────────

let resizeTimer;
window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawOverlays, 150);
});
