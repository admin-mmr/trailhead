-- Migration v10: Add admins table
-- Purpose: Store admin user accounts for site administration
-- Date: 2026-03-25

USE mmrdb;

-- Create admins table
CREATE TABLE IF NOT EXISTS admins (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  added_by VARCHAR(255) NOT NULL DEFAULT 'system',
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Record this migration
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('v10', 'Add admins table for site administration', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
