-- Check data for event 25VCP2 (2026 United Airlines NYC Half)

-- Event summary
SELECT
  id,
  event_code,
  event_name,
  event_date,
  result_count,
  mmr_runner_count,
  mmr_matched_count
FROM nyrr_events
WHERE event_code = '25VCP2';

-- Total runners and breakdown
SELECT
  COUNT(*) as total_runners,
  COUNT(DISTINCT team_code) as unique_teams,
  SUM(CASE WHEN team_code = 'MMR' THEN 1 ELSE 0 END) as mmr_tagged,
  SUM(CASE WHEN mmr_member_id IS NOT NULL THEN 1 ELSE 0 END) as matched_to_member
FROM nyrr_event_runners
WHERE nyrr_event_id = (SELECT id FROM nyrr_events WHERE event_code = '25VCP2');

-- Breakdown by team_code
SELECT
  COALESCE(team_code, 'NULL') as team_code,
  COUNT(*) as count
FROM nyrr_event_runners
WHERE nyrr_event_id = (SELECT id FROM nyrr_events WHERE event_code = '25VCP2')
GROUP BY team_code
ORDER BY count DESC;

-- Show all MMR runners
SELECT
  overall_place,
  bib_number,
  runner_name,
  finish_time,
  pace,
  team_code,
  mmr_member_id
FROM nyrr_event_runners
WHERE nyrr_event_id = (SELECT id FROM nyrr_events WHERE event_code = '25VCP2')
  AND team_code = 'MMR'
ORDER BY overall_place;

-- Show all runners (first 20 rows)
SELECT
  overall_place,
  bib_number,
  runner_name,
  team_code,
  mmr_member_id
FROM nyrr_event_runners
WHERE nyrr_event_id = (SELECT id FROM nyrr_events WHERE event_code = '25VCP2')
ORDER BY overall_place
LIMIT 20;
