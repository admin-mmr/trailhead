-- ============================================================
-- MIGRATION_V040.sql — point poll options at their full-length previews
--
-- V039 created poll_options.detail_path but left it NULL. The poll cards only
-- showed a hero screenshot, so a voter could not see how a design behaves
-- further down the page. Each option now links to the real, scrollable mockup
-- served from the webapp's public/mockups/ folder; 'current' links to the live
-- site, which IS the current design.
--
-- Idempotent: plain UPDATEs keyed on (poll_id, code), safe to re-run.
-- ============================================================

UPDATE poll_options o
  JOIN polls p ON p.id = o.poll_id
   SET o.detail_path = CASE o.code
         WHEN 'current' THEN '/'
         WHEN 'a' THEN '/mockups/option-a-summit.html'
         WHEN 'b' THEN '/mockups/option-b-momentum.html'
         WHEN 'c' THEN '/mockups/option-c-lantern.html'
         WHEN 'd' THEN '/mockups/option-d-splits.html'
         WHEN 'e' THEN '/mockups/option-e-foundry.html'
         WHEN 'f' THEN '/mockups/option-f-grid.html'
         WHEN 'g' THEN '/mockups/option-g-afterdark.html'
         WHEN 'h' THEN '/mockups/option-h-mist.html'
         WHEN 'i' THEN '/mockups/option-i-everyone.html'
         WHEN 'j' THEN '/mockups/option-j-family.html'
         ELSE o.detail_path
       END
 WHERE p.slug = 'website-design-2026';

-- ── Self-registration (audit trail + prevents re-runs) ──────────────────────
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V040', 'poll_options.detail_path -> full-length design mockups for website-design-2026', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
