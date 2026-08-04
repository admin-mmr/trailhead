-- Revert for the P1m NYRR link audit unlink (policy B), 2026-07-30.
-- Restores mmr_member_id / match_method / matched_by / matched_at for the
-- 80 rows that audit_nyrr_links.py flagged as age-inconsistent:
-- more than 5 years from the member's modal implied birth year, for members
-- whose modal cluster covers >=60% of their rows.
-- Generated from the live values immediately before the UPDATE.

UPDATE nyrr_event_runners SET mmr_member_id='A0424', match_method='auto_lastname', matched_by='System', matched_at='2026-03-29 05:41:24' WHERE id=53068;
UPDATE nyrr_event_runners SET mmr_member_id='A0432', match_method='auto_lastname', matched_by='System', matched_at='2026-03-29 05:45:36' WHERE id=53210;
UPDATE nyrr_event_runners SET mmr_member_id='A0539', match_method='auto_lastname', matched_by='System', matched_at='2026-05-26 02:23:50' WHERE id=353317;
UPDATE nyrr_event_runners SET mmr_member_id='A0305', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-05-31 22:01:32' WHERE id=429695;
UPDATE nyrr_event_runners SET mmr_member_id='A0539', match_method='auto_name', matched_by='System', matched_at='2026-05-26 08:04:40' WHERE id=442242;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 02:06:01' WHERE id=515913;
UPDATE nyrr_event_runners SET mmr_member_id='A0233', match_method='auto_name', matched_by='System', matched_at='2026-05-26 08:01:44' WHERE id=540840;
UPDATE nyrr_event_runners SET mmr_member_id='A0107', match_method='auto_lastname', matched_by='System', matched_at='2026-05-26 08:04:44' WHERE id=541046;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 02:06:01' WHERE id=577204;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 02:06:01' WHERE id=580895;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 02:06:01' WHERE id=593325;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 02:06:01' WHERE id=607566;
UPDATE nyrr_event_runners SET mmr_member_id='A0546', match_method='auto_name', matched_by='System', matched_at='2026-05-26 19:56:13' WHERE id=778625;
UPDATE nyrr_event_runners SET mmr_member_id='A0137', match_method='auto_name', matched_by='System', matched_at='2026-05-26 22:58:45' WHERE id=815579;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 02:06:01' WHERE id=847363;
UPDATE nyrr_event_runners SET mmr_member_id='A0137', match_method='auto_lastname', matched_by='System', matched_at='2026-05-26 22:58:45' WHERE id=906292;
UPDATE nyrr_event_runners SET mmr_member_id='A0010', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 19:35:54' WHERE id=947422;
UPDATE nyrr_event_runners SET mmr_member_id='A0107', match_method='auto_name', matched_by='System', matched_at='2026-05-27 01:57:27' WHERE id=947427;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:03:28' WHERE id=947851;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 02:03:48' WHERE id=947878;
UPDATE nyrr_event_runners SET mmr_member_id='A0013', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:03:59' WHERE id=947892;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 02:05:16' WHERE id=947985;
UPDATE nyrr_event_runners SET mmr_member_id='A0137', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:05:17' WHERE id=947987;
UPDATE nyrr_event_runners SET mmr_member_id='A0137', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:05:25' WHERE id=947990;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 02:05:47' WHERE id=948023;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:06:01' WHERE id=948042;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 02:06:00' WHERE id=948048;
UPDATE nyrr_event_runners SET mmr_member_id='A0137', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:06:51' WHERE id=948134;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 02:06:50' WHERE id=948139;
UPDATE nyrr_event_runners SET mmr_member_id='A0137', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:06:52' WHERE id=948153;
UPDATE nyrr_event_runners SET mmr_member_id='A0137', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:07:06' WHERE id=948158;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 02:07:19' WHERE id=948163;
UPDATE nyrr_event_runners SET mmr_member_id='A0137', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:08:50' WHERE id=948284;
UPDATE nyrr_event_runners SET mmr_member_id='A0137', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:09:13' WHERE id=948315;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 02:11:50' WHERE id=948450;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 02:12:41' WHERE id=948494;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:14:04' WHERE id=948571;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:14:47' WHERE id=948621;
UPDATE nyrr_event_runners SET mmr_member_id='A0137', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:15:07' WHERE id=948641;
UPDATE nyrr_event_runners SET mmr_member_id='A0137', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:15:26' WHERE id=948651;
UPDATE nyrr_event_runners SET mmr_member_id='A0137', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 02:16:04' WHERE id=948691;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 03:48:29' WHERE id=948938;
UPDATE nyrr_event_runners SET mmr_member_id='A0046', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 12:22:54' WHERE id=948942;
UPDATE nyrr_event_runners SET mmr_member_id='A0022', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 03:48:27' WHERE id=948948;
UPDATE nyrr_event_runners SET mmr_member_id='A0361', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 12:22:54' WHERE id=948955;
UPDATE nyrr_event_runners SET mmr_member_id='A0518', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 09:27:20' WHERE id=949481;
UPDATE nyrr_event_runners SET mmr_member_id='A0147', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 03:53:31' WHERE id=949606;
UPDATE nyrr_event_runners SET mmr_member_id='A0518', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 10:03:32' WHERE id=949681;
UPDATE nyrr_event_runners SET mmr_member_id='A0022', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 03:56:08' WHERE id=949939;
UPDATE nyrr_event_runners SET mmr_member_id='A0147', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 03:57:11' WHERE id=950084;
UPDATE nyrr_event_runners SET mmr_member_id='A0361', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 05:37:34' WHERE id=950109;
UPDATE nyrr_event_runners SET mmr_member_id='A0077', match_method='auto_name', matched_by='System', matched_at='2026-05-27 03:58:44' WHERE id=950302;
UPDATE nyrr_event_runners SET mmr_member_id='A0147', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 04:01:14' WHERE id=950656;
UPDATE nyrr_event_runners SET mmr_member_id='A0147', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 04:01:37' WHERE id=950687;
UPDATE nyrr_event_runners SET mmr_member_id='A0147', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 04:01:51' WHERE id=950717;
UPDATE nyrr_event_runners SET mmr_member_id='A0147', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 04:02:02' WHERE id=950741;
UPDATE nyrr_event_runners SET mmr_member_id='A0147', match_method='auto_lastname', matched_by='System', matched_at='2026-05-27 04:02:59' WHERE id=950885;
UPDATE nyrr_event_runners SET mmr_member_id='A0107', match_method='auto_name', matched_by='System', matched_at='2026-05-27 04:12:39' WHERE id=952237;
UPDATE nyrr_event_runners SET mmr_member_id='A0107', match_method='auto_name', matched_by='System', matched_at='2026-05-27 04:15:20' WHERE id=952592;
UPDATE nyrr_event_runners SET mmr_member_id='A0305', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 03:13:43' WHERE id=1058118;
UPDATE nyrr_event_runners SET mmr_member_id='A0056', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 03:13:43' WHERE id=1061743;
UPDATE nyrr_event_runners SET mmr_member_id='A0305', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 03:50:27' WHERE id=1088389;
UPDATE nyrr_event_runners SET mmr_member_id='A0305', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 05:19:25' WHERE id=1170478;
UPDATE nyrr_event_runners SET mmr_member_id='A0139', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 06:15:36' WHERE id=1214230;
UPDATE nyrr_event_runners SET mmr_member_id='A0497', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 06:35:25' WHERE id=1231257;
UPDATE nyrr_event_runners SET mmr_member_id='A0501', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 09:35:14' WHERE id=1382905;
UPDATE nyrr_event_runners SET mmr_member_id='A0562', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 09:35:14' WHERE id=1386220;
UPDATE nyrr_event_runners SET mmr_member_id='A0354', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 10:53:36' WHERE id=1459374;
UPDATE nyrr_event_runners SET mmr_member_id='A0360', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 11:52:28' WHERE id=1492964;
UPDATE nyrr_event_runners SET mmr_member_id='A0543', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 12:07:49' WHERE id=1522536;
UPDATE nyrr_event_runners SET mmr_member_id='A0501', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 12:28:16' WHERE id=1533630;
UPDATE nyrr_event_runners SET mmr_member_id='A0349', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 13:09:04' WHERE id=1572323;
UPDATE nyrr_event_runners SET mmr_member_id='A0501', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 14:20:32' WHERE id=1636223;
UPDATE nyrr_event_runners SET mmr_member_id='A0501', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 15:25:36' WHERE id=1704139;
UPDATE nyrr_event_runners SET mmr_member_id='A0056', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 17:38:14' WHERE id=1828473;
UPDATE nyrr_event_runners SET mmr_member_id='A0354', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 19:35:54' WHERE id=1912932;
UPDATE nyrr_event_runners SET mmr_member_id='A0541', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 19:35:54' WHERE id=1914557;
UPDATE nyrr_event_runners SET mmr_member_id='A0179', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 19:47:03' WHERE id=1948797;
UPDATE nyrr_event_runners SET mmr_member_id='A0098', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 20:17:37' WHERE id=1973451;
UPDATE nyrr_event_runners SET mmr_member_id='A0098', match_method='auto_firstlast', matched_by='Viewer', matched_at='2026-07-22 20:37:32' WHERE id=1996666;

-- Then refresh the per-event counters:
UPDATE nyrr_events ne SET ne.mmr_matched_count = (
  SELECT COUNT(*) FROM nyrr_event_runners
  WHERE nyrr_event_id = ne.id AND mmr_member_id IS NOT NULL);
