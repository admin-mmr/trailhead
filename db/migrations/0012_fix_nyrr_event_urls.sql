-- Migration 0012: Fix NYRR event URLs to use correct format
-- Changes: https://results.nyrr.org/events/{code} -> https://results.nyrr.org/event/{code}/finishers

UPDATE nyrr_events
SET event_url = CONCAT('https://results.nyrr.org/event/', event_code, '/finishers')
WHERE event_url LIKE 'https://results.nyrr.org/events/%'
  AND event_code IS NOT NULL;

-- Verification: Check that URLs follow the correct pattern
SELECT event_code, event_url
FROM nyrr_events
WHERE event_url IS NOT NULL
LIMIT 10;
