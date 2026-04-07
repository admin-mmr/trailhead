-- MIGRATION V010: Drop trg_members_family_inheritance (MySQL 5.7 error 1442)
-- Problem: MySQL 5.7 forbids UPDATE on a table inside a trigger fired by that
--          same table's INSERT. Error 1442 is a hard engine restriction with no
--          trigger-level workaround.
-- Fix:     Drop the trigger. Family inheritance logic moved to application layer:
--          api_members.py handles inheritance when creating a new family member
--          (see _apply_family_inheritance helper added with this migration).
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_members_family_inheritance;

-- Audit trail
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V010', 'Drop trg_members_family_inheritance: MySQL 5.7 error 1442 (cannot UPDATE table inside AFTER INSERT trigger on same table). Logic moved to application layer.', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
