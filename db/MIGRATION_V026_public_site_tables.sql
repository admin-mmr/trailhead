-- MIGRATION_V026: Public site content tables
--
-- Creates 8 new tables needed for the public-facing website (Phase 2).
-- No dependency on Stripe — that comes in V027.
--
-- Tables added:
--   board_members, coaches, weekly_runs, training_plans,
--   team_records, races, sponsors, contact_submissions
--
-- MySQL 5.7+ notes:
--   • CREATE TABLE IF NOT EXISTS is safe
--   • Inline INDEX / FOREIGN KEY definitions are fine inside CREATE TABLE
--   • No separate CREATE INDEX statements (avoids IF NOT EXISTS constraint)

-- ── 1. board_members ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_members (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL,
  role          VARCHAR(100) NOT NULL,
  bio           TEXT,
  photo_url     VARCHAR(500),
  email         VARCHAR(255),
  term_year     INT,
  display_order INT          DEFAULT 0,
  is_active     BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── 2. coaches ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaches (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  name            VARCHAR(100) NOT NULL,
  specialty       VARCHAR(200),
  bio             TEXT,
  photo_url       VARCHAR(500),
  certifications  TEXT,
  contact_email   VARCHAR(255),
  display_order   INT       DEFAULT 0,
  is_active       BOOLEAN   DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── 3. weekly_runs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_runs (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  day_of_week      TINYINT      NOT NULL,          -- 0=Sunday .. 6=Saturday
  start_time       TIME         NOT NULL,
  location_name    VARCHAR(200) NOT NULL,
  location_address VARCHAR(500),
  location_lat     DECIMAL(10,8),
  location_lng     DECIMAL(11,8),
  pace_group       VARCHAR(50),                    -- e.g. "Easy 9–10 min/mi"
  distance_miles   DECIMAL(4,1),
  description      TEXT,
  coach_id         INT NULL,
  is_active        BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (coach_id) REFERENCES coaches(id)
);

-- ── 4. training_plans ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_plans (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  slug           VARCHAR(100) UNIQUE NOT NULL,
  title          VARCHAR(200) NOT NULL,
  goal_distance  VARCHAR(50),                      -- "Marathon", "Half", "5K"
  duration_weeks INT,
  level          VARCHAR(50),                      -- "Beginner", "Intermediate", "Advanced"
  description    TEXT,
  full_plan_url  VARCHAR(500),                     -- PDF in Azure Storage
  is_published   BOOLEAN   DEFAULT FALSE,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── 5. team_records ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_records (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  distance      VARCHAR(50)        NOT NULL,       -- "5K", "Marathon"
  gender        ENUM('M','F','X')  NOT NULL,
  age_group     VARCHAR(20),                       -- "Overall", "M40-49"
  time_seconds  INT                NOT NULL,
  athlete_name  VARCHAR(100)       NOT NULL,
  member_id     INT NULL,
  race_name     VARCHAR(200),
  race_date     DATE,
  race_location VARCHAR(200),
  is_verified   BOOLEAN DEFAULT FALSE,
  INDEX idx_distance_gender (distance, gender),
  FOREIGN KEY (member_id) REFERENCES members(id)
);

-- ── 6. races ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS races (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  name             VARCHAR(200) NOT NULL,
  race_date        DATE         NOT NULL,
  distance         VARCHAR(50),
  location         VARCHAR(200),
  registration_url VARCHAR(500),
  description      TEXT,
  recap_mdx        TEXT,                           -- post-race recap in MDX
  is_team_event    BOOLEAN DEFAULT FALSE,
  INDEX idx_date (race_date)
);

-- ── 7. sponsors ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsors (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(200) NOT NULL,
  tier          VARCHAR(50),                       -- "Gold", "Silver", "Bronze", "Partner"
  logo_url      VARCHAR(500),
  website_url   VARCHAR(500),
  description   TEXT,
  start_date    DATE,
  end_date      DATE,
  is_active     BOOLEAN DEFAULT TRUE,
  display_order INT     DEFAULT 0
);

-- ── 8. contact_submissions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_submissions (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(255) NOT NULL,
  subject    VARCHAR(200),
  message    TEXT         NOT NULL,
  status     ENUM('new','read','replied','archived') DEFAULT 'new',
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Self-registration ───────────────────────────────────────────────────────
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V026', 'Public site content tables: board_members, coaches, weekly_runs, training_plans, team_records, races, sponsors, contact_submissions', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
