-- MIGRATION_V024: Add member_duplicate_dismissals table
--
-- Supports the duplicate-detection UI (P1b). When an admin reviews two members
-- and determines they are NOT the same person, they can dismiss that pair so it
-- stops appearing in the duplicates queue.
--
-- dup_type:  'name'    — matched on LOWER(TRIM(FirstName)) + LOWER(TRIM(LastName))
--            'phone'   — matched on PhoneNumber
--            'wechat'  — matched on WeChatID
--
-- dup_key:   Canonical string that identifies the duplicate group:
--              name   → "<firstname>|<lastname>" (lowercased, trimmed)
--              phone  → the phone number string
--              wechat → the WeChatID string
--
-- dismissed_by: email of the admin who dismissed the pair
-- dismissed_at: timestamp of dismissal (defaults to NOW())
--
-- UNIQUE(dup_type, dup_key) — one dismissal record per group per type.
-- Safe to re-run: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS `member_duplicate_dismissals` (
  `id`            INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `dup_type`      ENUM('name','phone','wechat') NOT NULL,
  `dup_key`       VARCHAR(255)   CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `dismissed_by`  VARCHAR(255)   CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `dismissed_at`  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dismissal` (`dup_type`, `dup_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V024', 'Add member_duplicate_dismissals table for duplicate-detection UI', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
