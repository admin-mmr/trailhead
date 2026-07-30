-- ============================================================
-- MIGRATION_V038.sql — Community poll service (first use case: website design vote)
--
-- A general, reusable poll feature. Members vote without logging in: they
-- identify with MemberID + last name, which is validated against `members`.
-- One ballot per member per poll, enforced by a UNIQUE key rather than by
-- application logic, so a double-submit cannot create a second ballot.
--
-- Tables
--   polls                 one row per poll
--   poll_options          the choices in a poll
--   poll_ballots          one row per member per poll (the vote envelope)
--   poll_ballot_choices   the ranked picks inside a ballot
--
-- Every step is INFORMATION_SCHEMA-guarded so the file is safe to re-run.
-- Target server is MySQL 8.4 (Azure Flexible Server); no ALTER ... IF NOT
-- EXISTS is used because that syntax has never existed in MySQL.
-- ============================================================

-- ── 1. polls ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS polls (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  slug            VARCHAR(64)  NOT NULL,
  title_en        VARCHAR(200) NOT NULL,
  title_zh        VARCHAR(200) NULL,
  description_en  TEXT NULL,
  description_zh  TEXT NULL,
  -- 'single' = pick one; 'top3' = ranked first/second/third
  mode            ENUM('single','top3') NOT NULL DEFAULT 'top3',
  status          ENUM('draft','open','closed') NOT NULL DEFAULT 'draft',
  -- who may read the tally: after casting a ballot, always, or admins only
  results_visibility ENUM('after_vote','public','admin') NOT NULL DEFAULT 'after_vote',
  -- 'member' = MemberID + last name checked against members; 'open' = no check
  voter_check     ENUM('member','open') NOT NULL DEFAULT 'member',
  opens_at        DATETIME NULL,
  closes_at       DATETIME NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_polls_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. poll_options ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS poll_options (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  poll_id      INT NOT NULL,
  code         VARCHAR(32)  NOT NULL,
  label_en     VARCHAR(200) NOT NULL,
  label_zh     VARCHAR(200) NULL,
  tagline_en   VARCHAR(400) NULL,
  tagline_zh   VARCHAR(400) NULL,
  -- site-relative path under /public, or an absolute https URL
  image_path   VARCHAR(400) NULL,
  -- optional deep link to a fuller view of this option (e.g. the full-page PDF)
  detail_path  VARCHAR(400) NULL,
  sort_order   SMALLINT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_poll_option_code (poll_id, code),
  KEY idx_poll_option_sort (poll_id, sort_order),
  CONSTRAINT fk_poll_options_poll FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. poll_ballots ─────────────────────────────────────────────────────────
-- MemberID is NULL-able so an 'open' poll can still record ballots. The unique
-- key therefore only constrains member-identified ballots (MySQL treats NULLs
-- as distinct in a UNIQUE index), which is exactly the behaviour we want.
CREATE TABLE IF NOT EXISTS poll_ballots (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  poll_id     INT NOT NULL,
  MemberID    VARCHAR(10) NULL,
  comment     VARCHAR(1000) NULL,
  -- salted hash only; we never store a raw IP
  ip_hash     CHAR(64) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ballot_poll_member (poll_id, MemberID),
  KEY idx_ballot_poll (poll_id),
  CONSTRAINT fk_poll_ballots_poll   FOREIGN KEY (poll_id)  REFERENCES polls(id)   ON DELETE CASCADE,
  CONSTRAINT fk_poll_ballots_member FOREIGN KEY (MemberID) REFERENCES members(MemberID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. poll_ballot_choices ──────────────────────────────────────────────────
-- Two unique keys: one rank may hold only one option, and one option may be
-- picked only once per ballot. Together these make a malformed ballot
-- (e.g. the same design ranked 1st and 2nd) a database error, not a bad tally.
CREATE TABLE IF NOT EXISTS poll_ballot_choices (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  ballot_id  INT NOT NULL,
  option_id  INT NOT NULL,
  rank_pos   TINYINT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_choice_ballot_rank   (ballot_id, rank_pos),
  UNIQUE KEY uq_choice_ballot_option (ballot_id, option_id),
  KEY idx_choice_option (option_id),
  CONSTRAINT fk_choices_ballot FOREIGN KEY (ballot_id) REFERENCES poll_ballots(id) ON DELETE CASCADE,
  CONSTRAINT fk_choices_option FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5. Seed the first poll — the website design vote ────────────────────────
-- INSERT IGNORE so re-running cannot duplicate the poll or reset its status
-- after an admin has opened or closed it.
INSERT IGNORE INTO polls
  (slug, title_en, title_zh, description_en, description_zh,
   mode, status, results_visibility, voter_check)
VALUES (
  'website-design-2026',
  'Which website design should we build?',
  '我们应该采用哪个网站设计？',
  'Ten directions for the club website, including the site as it stands today. Pick your first, second and third choice. The numbers shown inside the designs are placeholders, not real club figures.',
  '十个网站设计方向，包括目前的网站。请选择第一、第二和第三选择。设计图中的数字仅为示意，并非真实数据。',
  'top3', 'open', 'after_vote', 'member'
);

-- Options. image_path points at files copied into the webapp's public/ folder.
INSERT IGNORE INTO poll_options
  (poll_id, code, label_en, label_zh, tagline_en, tagline_zh, image_path, sort_order)
SELECT p.id, v.code, v.label_en, v.label_zh, v.tagline_en, v.tagline_zh, v.image_path, v.sort_order
FROM polls p
JOIN (
  SELECT 'current' AS code, 'The current site' AS label_en, '目前的网站' AS label_zh,
         'What we have today, for comparison.' AS tagline_en,
         '现有网站，用于对比。' AS tagline_zh,
         '/images/poll/current.jpg' AS image_path, 0 AS sort_order
  UNION ALL SELECT 'a', 'A · Summit', 'A · 峰顶',
    'Calm and editorial, with generous white space.', '沉稳、编辑风格、大量留白。',
    '/images/poll/option-a.jpg', 1
  UNION ALL SELECT 'b', 'B · Momentum', 'B · 动势',
    'Dark, loud, race-day energy.', '深色、强烈、比赛日的能量。',
    '/images/poll/option-b.jpg', 2
  UNION ALL SELECT 'c', 'C · Lantern', 'C · 灯笼',
    'Warm and bilingual by design; our identity leads.', '温暖的双语设计，突出我们的身份。',
    '/images/poll/option-c.jpg', 3
  UNION ALL SELECT 'd', 'D · Splits', 'D · 分段',
    'Data-forward — results, mileage and paces up front.', '以数据为主 — 成绩、里程与配速。',
    '/images/poll/option-d.jpg', 4
  UNION ALL SELECT 'e', 'E · Foundry', 'E · 铸字',
    'Printed serif, like a club yearbook.', '印刷衬线字体，像俱乐部年鉴。',
    '/images/poll/option-e.jpg', 5
  UNION ALL SELECT 'f', 'F · Grid', 'F · 网格',
    'Black, monospaced, built on a visible grid.', '黑色、等宽字体、可见的网格。',
    '/images/poll/option-f.jpg', 6
  UNION ALL SELECT 'g', 'G · After Dark', 'G · 夜跑',
    'Neon glow and evening-run energy.', '霓虹光感，夜跑的氛围。',
    '/images/poll/option-g.jpg', 7
  UNION ALL SELECT 'h', 'H · Mist', 'H · 岚',
    'Calm and airy, built from the meaning of 岚.', '宁静通透，源自「岚」的含义。',
    '/images/poll/option-h.jpg', 8
  UNION ALL SELECT 'i', 'I · Everyone', 'I · 每一个人',
    'Accessibility first — the friendliest and easiest to read.', '无障碍优先 — 最友好、最易读。',
    '/images/poll/option-i.jpg', 9
  UNION ALL SELECT 'j', 'J · Family 有家', 'J · 有家',
    'Photographs of members are the navigation.', '以会员照片作为导航。',
    '/images/poll/option-j.jpg', 10
) AS v
WHERE p.slug = 'website-design-2026';

-- ── 6. Self-registration (audit trail + prevents re-runs) ───────────────────
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V038', 'Community poll service: polls, poll_options, poll_ballots, poll_ballot_choices + website-design-2026 seed', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
