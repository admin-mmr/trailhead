section
=== 1. TABLES ===
table	engine	collation	comment
activity_log	InnoDB	utf8mb4_unicode_ci	
admins	InnoDB	utf8mb4_unicode_ci	
config	InnoDB	utf8mb4_unicode_ci	
gmail_transactions	InnoDB	utf8mb4_unicode_ci	
member_log	InnoDB	utf8mb4_unicode_ci	
members	InnoDB	utf8mb4_unicode_ci	
nyrr_event_runners	InnoDB	utf8mb4_unicode_ci	
nyrr_events	InnoDB	utf8mb4_unicode_ci	
nyrr_processing_log	InnoDB	utf8mb4_unicode_ci	
password_reset_tokens	InnoDB	utf8mb4_unicode_ci	
payments	InnoDB	utf8mb4_unicode_ci	
schema_migrations	InnoDB	utf8mb4_unicode_ci	
sync_changes	InnoDB	utf8mb4_unicode_ci	
sync_metadata	InnoDB	utf8mb4_unicode_ci	
sync_snapshots	InnoDB	utf8mb4_unicode_ci	
viewer_admins	InnoDB	utf8mb4_unicode_ci	
webapp_events	InnoDB	utf8mb4_unicode_ci	
section
=== 2. COLUMNS ===
table	#	column_name	col_type	nullable	default	extra	key	comment
activity_log	1	LogID	varchar(50)	NO	NULL		PRI	
activity_log	2	Timestamp	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED	MUL	
activity_log	3	SessionID	varchar(50)	YES	NULL		MUL	
activity_log	4	MemberID	varchar(10)	YES	NULL		MUL	
activity_log	5	Email	varchar(255)	YES	NULL			
activity_log	6	EventID	varchar(50)	YES	NULL			
activity_log	7	Action	varchar(100)	NO	NULL		MUL	
activity_log	8	State	varchar(50)	YES	NULL			
activity_log	9	ErrorCode	varchar(50)	YES	NULL			
activity_log	10	ErrorMessage	text	YES	NULL			
admins	1	id	int	NO	NULL	auto_increment	PRI	
admins	2	email	varchar(255)	NO	NULL		UNI	
admins	3	added_by	varchar(255)	NO	system			
admins	4	added_at	timestamp	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
config	1	ConfigKey	varchar(100)	NO	NULL		PRI	
config	2	ConfigValue	varchar(500)	NO	NULL			
config	3	Description	varchar(500)	YES	NULL			
config	4	UpdatedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		
gmail_transactions	1	MessageId	varchar(100)	NO	NULL		PRI	
gmail_transactions	2	TimeStamp	datetime	NO	NULL			
gmail_transactions	3	Sender	varchar(255)	YES	NULL			
gmail_transactions	4	Amount	decimal(10,2)	YES	NULL			
gmail_transactions	5	Memo	text	YES	NULL			
gmail_transactions	6	TransactionDate	date	YES	NULL		MUL	
gmail_transactions	7	TransactionNumber	varchar(100)	YES	NULL		MUL	
gmail_transactions	8	Subject	varchar(500)	YES	NULL			
gmail_transactions	9	OriginalMemo	text	YES	NULL			
gmail_transactions	10	Notes	text	YES	NULL			
gmail_transactions	11	ProcessedTime	datetime	YES	NULL			
gmail_transactions	12	Source	varchar(50)	YES	NULL		MUL	
gmail_transactions	13	WebAppID	varchar(50)	YES	NULL		MUL	
gmail_transactions	14	IsArchived	tinyint(1)	NO	0		MUL	
gmail_transactions	15	SyncedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		
member_log	1	LogID	varchar(50)	NO	NULL		PRI	
member_log	2	LoggingTime	datetime	NO	NULL		MUL	
member_log	3	MemberID	varchar(10)	NO	NULL		MUL	
member_log	4	ChangeType	varchar(20)	YES	NULL			
member_log	5	Status	varchar(50)	YES	NULL			
member_log	6	Created	datetime	YES	NULL			
member_log	7	Expiration	datetime	YES	NULL			
member_log	8	Email	varchar(255)	YES	NULL			
member_log	9	FirstName	varchar(100)	YES	NULL			
member_log	10	LastName	varchar(100)	YES	NULL			
member_log	11	Type	varchar(50)	YES	NULL			
member_log	12	FamilyID	varchar(10)	YES	NULL			
member_log	13	Gender	varchar(20)	YES	NULL			
member_log	14	WeChatID	varchar(100)	YES	NULL			
member_log	15	District	varchar(100)	YES	NULL			
member_log	16	WebApp	varchar(50)	YES	NULL			
member_log	17	PaymentCheck	varchar(50)	YES	NULL			
member_log	18	Info	text	YES	NULL			
member_log	19	LastUpdated	datetime	YES	NULL			
member_log	20	MembershipFeePaid	decimal(10,2)	YES	NULL			
member_log	21	PaymentDate	datetime	YES	NULL			
member_log	22	PaymentTransaction	varchar(100)	YES	NULL			
member_log	23	JoinYear	smallint	YES	NULL			
member_log	24	PhoneNumber	varchar(30)	YES	NULL			
member_log	25	LastLoginDate	datetime	YES	NULL			
member_log	26	Notes	text	YES	NULL			
member_log	27	NYRRRunnerName	varchar(100)	YES	NULL			
member_log	28	YearBorn	smallint	YES	NULL			
members	1	MemberID	varchar(10)	NO	NULL		PRI	
members	2	Status	enum('active','not active','pending')	NO	pending		MUL	
members	3	Created	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
members	4	Expiration	datetime	YES	NULL		MUL	
members	5	Email	varchar(255)	NO	NULL		UNI	
members	6	FirstName	varchar(100)	NO	NULL			
members	7	LastName	varchar(100)	NO	NULL			
members	8	Type	enum('Individual','Family')	NO	Individual			
members	9	FamilyID	varchar(10)	YES	NULL		MUL	
members	10	Gender	varchar(20)	YES	NULL			
members	11	WeChatID	varchar(100)	YES	NULL			
members	12	District	varchar(100)	YES	NULL			
members	13	WebApp	varchar(50)	YES	NULL			
members	14	PaymentCheck	varchar(50)	YES	NULL			
members	15	Info	text	YES	NULL			
members	16	LastUpdated	datetime	YES	NULL			
members	17	MembershipFeePaid	decimal(10,2)	YES	NULL			
members	18	PaymentDate	datetime	YES	NULL			
members	19	PaymentTransaction	varchar(100)	YES	NULL			
members	20	JoinYear	smallint	YES	NULL		MUL	
members	21	PhoneNumber	varchar(30)	YES	NULL			
members	22	LastLoginDate	datetime	YES	NULL			
members	23	ProfileLastUpdated	datetime	YES	NULL			When member profile was last updated (from Google Sheets)
members	24	Notes	text	YES	NULL			
members	25	NYRRRunnerName	varchar(100)	YES	NULL			
members	26	YearBorn	smallint	YES	NULL			
members	27	YearBornGuess	smallint	YES	NULL			System-inferred birth year from NYRR age data
members	28	password_hash	varchar(255)	YES	NULL			
members	29	google_sub	varchar(255)	YES	NULL		UNI	
members	30	microsoft_sub	varchar(255)	YES	NULL		UNI	
members	31	apple_sub	varchar(255)	YES	NULL		UNI	
members	32	yahoo_sub	varchar(255)	YES	NULL		UNI	
members	33	facebook_sub	varchar(255)	YES	NULL		UNI	Facebook user ID (sub) for Sign in with Facebook
members	34	CreatedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
members	35	UpdatedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		
nyrr_event_runners	1	id	int	NO	NULL	auto_increment	PRI	
nyrr_event_runners	2	nyrr_event_id	int	NO	NULL		MUL	
nyrr_event_runners	3	nyrr_runner_id	varchar(20)	NO	NULL		MUL	
nyrr_event_runners	4	runner_name	varchar(200)	NO	NULL		MUL	
nyrr_event_runners	5	first_name	varchar(100)	YES	NULL			
nyrr_event_runners	6	last_name	varchar(100)	YES	NULL		MUL	
nyrr_event_runners	7	age	smallint	YES	NULL			
nyrr_event_runners	8	gender	varchar(10)	YES	NULL			
nyrr_event_runners	9	state_province	varchar(50)	YES	NULL			
nyrr_event_runners	10	bib_number	varchar(20)	YES	NULL			
nyrr_event_runners	11	finish_time	varchar(20)	YES	NULL			
nyrr_event_runners	12	pace	varchar(20)	YES	NULL			
nyrr_event_runners	13	overall_place	int	YES	NULL			
nyrr_event_runners	14	gender_place	int	YES	NULL			
nyrr_event_runners	15	team_code	varchar(20)	YES	NULL		MUL	
nyrr_event_runners	16	is_registered_only	tinyint(1)	NO	0			
nyrr_event_runners	17	mmr_member_id	varchar(10)	YES	NULL		MUL	
nyrr_event_runners	18	match_method	enum('auto_name','auto_lastname','manual','not_member','unmatched')	YES	NULL		MUL	
nyrr_event_runners	19	matched_by	varchar(100)	YES	NULL			
nyrr_event_runners	20	matched_at	datetime	YES	NULL			
nyrr_event_runners	21	scan_timestamp	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
nyrr_event_runners	22	created_at	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
nyrr_event_runners	23	updated_at	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		
nyrr_events	1	id	int	NO	NULL	auto_increment	PRI	
nyrr_events	2	event_code	varchar(30)	NO	NULL		UNI	
nyrr_events	3	event_name	varchar(255)	NO	NULL			
nyrr_events	4	event_url	varchar(500)	YES	NULL			
nyrr_events	5	location	varchar(255)	YES	NULL			
nyrr_events	6	distance	varchar(50)	YES	NULL			
nyrr_events	7	event_date	date	YES	NULL		MUL	
nyrr_events	8	event_year	smallint	YES	NULL		MUL	
nyrr_events	9	is_upcoming	tinyint(1)	NO	0		MUL	
nyrr_events	10	is_virtual	tinyint(1)	NO	0			
nyrr_events	11	processing_status	enum('Pending','InProgress','Completed','Error')	NO	Pending		MUL	
nyrr_events	12	processed_at	datetime	YES	NULL			
nyrr_events	13	processed_by	varchar(100)	YES	NULL			
nyrr_events	14	result_count	int	NO	0			
nyrr_events	15	mmr_runner_count	int	NO	0			
nyrr_events	16	mmr_matched_count	int	NO	0			
nyrr_events	17	notes	text	YES	NULL			
nyrr_events	18	created_at	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
nyrr_events	19	updated_at	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		
nyrr_processing_log	1	id	int	NO	NULL	auto_increment	PRI	
nyrr_processing_log	2	run_timestamp	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED	MUL	
nyrr_processing_log	3	triggered_by	varchar(100)	YES	NULL			
nyrr_processing_log	4	nyrr_event_id	int	YES	NULL		MUL	
nyrr_processing_log	5	run_status	enum('Success','PartialSuccess','Failed')	NO	NULL		MUL	
nyrr_processing_log	6	rows_written	int	NO	0			
nyrr_processing_log	7	error_details	text	YES	NULL			
nyrr_processing_log	8	created_at	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
password_reset_tokens	1	TokenID	varchar(50)	NO	NULL		PRI	
password_reset_tokens	2	Email	varchar(255)	NO	NULL		MUL	
password_reset_tokens	3	TokenHash	varchar(255)	NO	NULL			
password_reset_tokens	4	ExpiresAt	datetime	NO	NULL		MUL	
password_reset_tokens	5	Used	tinyint(1)	NO	0			
password_reset_tokens	6	CreatedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
payments	1	PaymentID	varchar(50)	NO	NULL		PRI	
payments	2	EventID	varchar(50)	YES	NULL		MUL	
payments	3	MemberID	varchar(10)	YES	NULL		MUL	
payments	4	PaymentDate	datetime	YES	NULL		MUL	
payments	5	Amount	decimal(10,2)	NO	NULL			
payments	6	PaymentIntent	varchar(100)	YES	NULL			Payment intent ID (from webapp_events)
payments	7	MembershipType	varchar(100)	YES	NULL			
payments	8	PaymentMethod	varchar(50)	YES	NULL			
payments	9	PayerName	varchar(100)	YES	NULL			
payments	10	MemoField	text	YES	NULL			
payments	11	Last4Digits	varchar(10)	YES	NULL			
payments	12	TransactionReference	varchar(100)	YES	NULL			
payments	13	PeriodStart	date	YES	NULL			
payments	14	PeriodEnd	date	YES	NULL		MUL	
payments	15	ProcessedBy	varchar(255)	YES	NULL			
payments	16	ProcessedDate	datetime	YES	NULL			
payments	17	Source	varchar(50)	YES	NULL			
payments	18	Notes	text	YES	NULL			
payments	19	CreatedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
schema_migrations	1	version	varchar(50)	NO	NULL		PRI	
schema_migrations	2	description	varchar(255)	YES	NULL			
schema_migrations	3	executed_at	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
sync_changes	1	change_id	int	NO	NULL	auto_increment	PRI	
sync_changes	2	sheet_name	varchar(255)	YES	NULL		MUL	
sync_changes	3	snapshot_id	int	YES	NULL		MUL	
sync_changes	4	change_type	varchar(20)	YES	NULL			
sync_changes	5	row_key	varchar(255)	YES	NULL			
sync_changes	6	old_values	json	YES	NULL			
sync_changes	7	new_values	json	YES	NULL			
sync_changes	8	created_at	datetime	YES	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
sync_metadata	1	sheet_name	varchar(255)	NO	NULL		PRI	
sync_metadata	2	spreadsheet_id	varchar(255)	YES	NULL			
sync_metadata	3	sync_status	varchar(50)	YES	NULL			
sync_metadata	4	last_synced_at	datetime	YES	NULL			
sync_metadata	5	created_at	datetime	YES	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
sync_metadata	6	updated_at	datetime	YES	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		
sync_snapshots	1	snapshot_id	int	NO	NULL	auto_increment	PRI	
sync_snapshots	2	sheet_name	varchar(255)	YES	NULL		MUL	
sync_snapshots	3	snapshot_hash	varchar(255)	YES	NULL			
sync_snapshots	4	row_count	int	YES	NULL			
sync_snapshots	5	snapshot_timestamp	datetime	YES	NULL		MUL	
sync_snapshots	6	google_modified_at	datetime	YES	NULL			
sync_snapshots	7	snapshot_data_url	longtext	YES	NULL			
sync_snapshots	8	status	varchar(50)	YES	pending			
sync_snapshots	9	created_at	datetime	YES	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
v_family_members	1	FamilyID	varchar(10)	YES	NULL			
v_family_members	2	primary_member_id	varchar(10)	YES	NULL			
v_family_members	3	member_id	varchar(10)	NO	NULL			
v_family_members	4	FirstName	varchar(100)	NO	NULL			
v_family_members	5	LastName	varchar(100)	NO	NULL			
v_family_members	6	Email	varchar(255)	NO	NULL			
v_family_members	7	Status	enum('active','not active','pending')	NO	pending			
v_family_members	8	Expiration	datetime	YES	NULL			
v_family_members	9	Type	enum('Individual','Family')	NO	Individual			
viewer_admins	1	id	int	NO	NULL	auto_increment	PRI	
viewer_admins	2	email	varchar(255)	NO	NULL		UNI	
viewer_admins	3	role	enum('admin','super_admin')	NO	admin			
viewer_admins	4	created_at	datetime	YES	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
webapp_events	1	EventID	varchar(50)	NO	NULL		PRI	
webapp_events	2	EventType	varchar(50)	NO	NULL			
webapp_events	3	Timestamp	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED	MUL	
webapp_events	4	ExpiresAt	datetime	YES	NULL			
webapp_events	5	MemberID	varchar(10)	YES	NULL		MUL	
webapp_events	6	Email	varchar(255)	NO	NULL		MUL	
webapp_events	7	PaymentIntent	varchar(100)	YES	NULL			
webapp_events	8	Amount	decimal(10,2)	YES	NULL			
webapp_events	9	PaymentMethod	varchar(50)	YES	NULL			
webapp_events	10	PayerName	varchar(100)	YES	NULL			
webapp_events	11	MemoField	text	YES	NULL			
webapp_events	12	Last4Digits	varchar(10)	YES	NULL			
webapp_events	13	FamilyMemberEmails	text	YES	NULL			
webapp_events	14	Status	enum('pending','approved','rejected')	NO	pending		MUL	
webapp_events	15	MatchedMessageId	varchar(100)	YES	NULL		MUL	
webapp_events	16	MatchedTransactionNumber	varchar(100)	YES	NULL			
webapp_events	17	AdminApprover	varchar(255)	YES	NULL			
webapp_events	18	ApprovalDate	datetime	YES	NULL			
webapp_events	19	Notes	text	YES	NULL			
webapp_events	20	PaymentDate	datetime	YES	NULL			
webapp_events	21	ScreenshotFileId	varchar(255)	YES	NULL			
webapp_events	22	GDriveFilePath	varchar(500)	YES	NULL			
webapp_events	23	OCRText	text	YES	NULL			
webapp_events	24	OCRTimestamp	datetime	YES	NULL			
webapp_events	25	CreatedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
webapp_events	26	UpdatedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		
section
=== 3. INDEXES ===
table	index_name	non_unique	seq	column_name	index_type	nullable
activity_log	idx_actlog_action	1	1	Action	BTREE	
activity_log	idx_actlog_memberid	1	1	MemberID	BTREE	YES
activity_log	idx_actlog_sessionid	1	1	SessionID	BTREE	YES
activity_log	idx_actlog_timestamp	1	1	Timestamp	BTREE	
activity_log	PRIMARY	0	1	LogID	BTREE	
admins	email	0	1	email	BTREE	
admins	PRIMARY	0	1	id	BTREE	
config	PRIMARY	0	1	ConfigKey	BTREE	
gmail_transactions	idx_gmail_isarchived	1	1	IsArchived	BTREE	
gmail_transactions	idx_gmail_source	1	1	Source	BTREE	YES
gmail_transactions	idx_gmail_transactiondate	1	1	TransactionDate	BTREE	YES
gmail_transactions	idx_gmail_transactionnumber	1	1	TransactionNumber	BTREE	YES
gmail_transactions	idx_gmail_webappid	1	1	WebAppID	BTREE	YES
gmail_transactions	PRIMARY	0	1	MessageId	BTREE	
member_log	idx_loggingtime	1	1	LoggingTime	BTREE	
member_log	idx_memberid	1	1	MemberID	BTREE	
member_log	PRIMARY	0	1	LogID	BTREE	
members	apple_sub	0	1	apple_sub	BTREE	YES
members	google_sub	0	1	google_sub	BTREE	YES
members	idx_expiration	1	1	Expiration	BTREE	YES
members	idx_family	1	1	FamilyID	BTREE	YES
members	idx_joinyear	1	1	JoinYear	BTREE	YES
members	idx_status	1	1	Status	BTREE	
members	microsoft_sub	0	1	microsoft_sub	BTREE	YES
members	PRIMARY	0	1	MemberID	BTREE	
members	uq_members_email	0	1	Email	BTREE	
members	uq_members_facebook	0	1	facebook_sub	BTREE	YES
members	yahoo_sub	0	1	yahoo_sub	BTREE	YES
nyrr_event_runners	idx_match_method	1	1	match_method	BTREE	YES
nyrr_event_runners	idx_mmr_member_id	1	1	mmr_member_id	BTREE	YES
nyrr_event_runners	idx_nyrr_runner_id	1	1	nyrr_runner_id	BTREE	
nyrr_event_runners	idx_runner_last_name	1	1	last_name	BTREE	YES
nyrr_event_runners	idx_runner_name	1	1	runner_name	BTREE	
nyrr_event_runners	idx_team_code	1	1	team_code	BTREE	YES
nyrr_event_runners	PRIMARY	0	1	id	BTREE	
nyrr_event_runners	uq_event_runner	0	1	nyrr_event_id	BTREE	
nyrr_event_runners	uq_event_runner	0	2	nyrr_runner_id	BTREE	
nyrr_events	idx_event_date	1	1	event_date	BTREE	YES
nyrr_events	idx_event_year	1	1	event_year	BTREE	YES
nyrr_events	idx_is_upcoming	1	1	is_upcoming	BTREE	
nyrr_events	idx_processing_status	1	1	processing_status	BTREE	
nyrr_events	PRIMARY	0	1	id	BTREE	
nyrr_events	uq_event_code	0	1	event_code	BTREE	
nyrr_processing_log	idx_log_event_id	1	1	nyrr_event_id	BTREE	YES
nyrr_processing_log	idx_log_run_status	1	1	run_status	BTREE	
nyrr_processing_log	idx_log_run_timestamp	1	1	run_timestamp	BTREE	
nyrr_processing_log	PRIMARY	0	1	id	BTREE	
password_reset_tokens	idx_prt_email	1	1	Email	BTREE	
password_reset_tokens	idx_prt_expiresat	1	1	ExpiresAt	BTREE	
password_reset_tokens	PRIMARY	0	1	TokenID	BTREE	
payments	idx_payments_eventid	1	1	EventID	BTREE	YES
payments	idx_payments_memberid	1	1	MemberID	BTREE	YES
payments	idx_payments_paymentdate	1	1	PaymentDate	BTREE	YES
payments	idx_payments_periodend	1	1	PeriodEnd	BTREE	YES
payments	PRIMARY	0	1	PaymentID	BTREE	
schema_migrations	PRIMARY	0	1	version	BTREE	
sync_changes	idx_sheet	1	1	sheet_name	BTREE	YES
sync_changes	idx_snapshot	1	1	snapshot_id	BTREE	YES
sync_changes	PRIMARY	0	1	change_id	BTREE	
sync_metadata	PRIMARY	0	1	sheet_name	BTREE	
sync_snapshots	idx_sheet	1	1	sheet_name	BTREE	YES
sync_snapshots	idx_timestamp	1	1	snapshot_timestamp	BTREE	YES
sync_snapshots	PRIMARY	0	1	snapshot_id	BTREE	
viewer_admins	email	0	1	email	BTREE	
viewer_admins	PRIMARY	0	1	id	BTREE	
webapp_events	idx_pe_email	1	1	Email	BTREE	
webapp_events	idx_pe_matchedmessageid	1	1	MatchedMessageId	BTREE	YES
webapp_events	idx_pe_memberid	1	1	MemberID	BTREE	YES
webapp_events	idx_pe_status	1	1	Status	BTREE	
webapp_events	idx_pe_timestamp	1	1	Timestamp	BTREE	
webapp_events	PRIMARY	0	1	EventID	BTREE	
section
=== 4. FOREIGN KEYS ===
table	column_name	constraint_name	ref_table	ref_column	UPDATE_RULE	DELETE_RULE
nyrr_event_runners	nyrr_event_id	fk_event_runners_event	nyrr_events	id	NO ACTION	CASCADE
nyrr_processing_log	nyrr_event_id	fk_processing_log_event	nyrr_events	id	NO ACTION	SET NULL
payments	EventID	fk_payments_event	webapp_events	EventID	NO ACTION	SET NULL
payments	MemberID	fk_payments_member	members	MemberID	NO ACTION	SET NULL
webapp_events	MatchedMessageId	fk_pe_gmail	gmail_transactions	MessageId	NO ACTION	SET NULL
webapp_events	MemberID	fk_pe_member	members	MemberID	NO ACTION	SET NULL
section
=== 5. VIEWS ===
view_name	VIEW_DEFINITION
v_family_members	select `m`.`FamilyID` AS `FamilyID`,min(`m`.`MemberID`) OVER (PARTITION BY `m`.`FamilyID` )  AS `primary_member_id`,`m`.`MemberID` AS `member_id`,`m`.`FirstName` AS `FirstName`,`m`.`LastName` AS `LastName`,`m`.`Email` AS `Email`,`m`.`Status` AS `Status`,`m`.`Expiration` AS `Expiration`,`m`.`Type` AS `Type` from `mmrdb`.`members` `m` where (`m`.`FamilyID` is not null)
section
=== 6. ROUTINES ===
type	name	return_type	body
PROCEDURE	generate_member_id		BEGIN\n    DECLARE max_num INT DEFAULT 0;\n    START TRANSACTION;\n        SELECT COALESCE(MAX(CAST(SUBSTRING(MemberID, 2) AS UNSIGNED)), 0) INTO max_num FROM members FOR UPDATE;\n        SET new_id = CONCAT('A', LPAD(max_num + 1, 4, '0'));\n    COMMIT;\nEND
