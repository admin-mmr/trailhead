-- Migration 0012: Add age grade columns to nyrr_event_runners
-- Purpose: Support age grade metrics from NYRR API (ageGradeTime, ageGradePlace, ageGradePercent)
-- Created: 2026-03-28

ALTER TABLE nyrr_event_runners
ADD COLUMN age_grade_time VARCHAR(20) NULL AFTER gender_place,
ADD COLUMN age_grade_place INT NULL AFTER age_grade_time,
ADD COLUMN age_grade_percent DECIMAL(5,2) NULL AFTER age_grade_place;
