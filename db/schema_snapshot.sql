section
=== 1. TABLES ===
table	engine	collation	comment
activity_log	InnoDB	utf8mb4_unicode_ci	
admin_member_overrides	InnoDB	utf8mb4_unicode_ci	
admin_users	InnoDB	utf8mb4_unicode_ci	
config	InnoDB	utf8mb4_unicode_ci	
error_context	InnoDB	utf8mb4_unicode_ci	
gmail_transactions	InnoDB	utf8mb4_unicode_ci	
member_log	InnoDB	utf8mb4_unicode_ci	
members	InnoDB	utf8mb4_unicode_ci	
nyrr_event_runners	InnoDB	utf8mb4_unicode_ci	
nyrr_events	InnoDB	utf8mb4_unicode_ci	
nyrr_processing_log	InnoDB	utf8mb4_unicode_ci	
password_reset_tokens	InnoDB	utf8mb4_unicode_ci	
payments	InnoDB	utf8mb4_unicode_ci	
schema_migrations	InnoDB	utf8mb4_unicode_ci	
sheets_sync_log	InnoDB	utf8mb4_unicode_ci	Tracks sheets sync batches for resume capability and monitoring
submissions	InnoDB	utf8mb4_unicode_ci	
sync_jobs	InnoDB	utf8mb4_unicode_ci	
viewer_user_settings	InnoDB	utf8mb4_unicode_ci	
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
activity_log	9	ErrorCode	varchar(50)	YES	NULL		MUL	
activity_log	10	ErrorMessage	text	YES	NULL			
activity_log	11	ErrorContext	json	YES	NULL			Detailed error info: {field, value, constraint, suggestion}
activity_log	12	ErrorSeverity	enum('INFO','WARNING','ERROR','CRITICAL')	YES	ERROR		MUL	Error classification level
activity_log	13	StackTrace	text	YES	NULL			Python/Node stack trace if available
admin_member_overrides	1	OverrideID	int	NO	NULL	auto_increment	PRI	
admin_member_overrides	2	AdminEmail	varchar(255)	NO	NULL			Admin who performed the manual change
admin_member_overrides	3	TargetMemberID	varchar(10)	NO	NULL		MUL	
admin_member_overrides	4	ImpactedMemberIDs	text	YES	NULL			Family members affected
admin_member_overrides	5	ActionType	enum('STATUS_CHANGE','EXPIRATION_OVERRIDE','LIFETIME_SET','INACTIVE_SET','MARK_ACTIVE','REVERT')	NO	NULL			
admin_member_overrides	6	OldValue	varchar(255)	YES	NULL			
admin_member_overrides	7	NewValue	varchar(255)	YES	NULL			
admin_member_overrides	8	AdminNotes	text	NO	NULL			
admin_member_overrides	9	Timestamp	datetime	YES	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
admin_users	1	id	int	NO	NULL	auto_increment	PRI	
admin_users	2	email	varchar(255)	NO	NULL		UNI	
admin_users	3	role	enum('admin','super_admin')	NO	admin		MUL	
admin_users	4	added_by	varchar(255)	NO	system			
admin_users	5	added_at	timestamp	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
admin_users	6	updated_at	timestamp	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		
config	1	ConfigKey	varchar(100)	NO	NULL		PRI	
config	2	ConfigValue	varchar(500)	NO	NULL			
config	3	Description	varchar(500)	YES	NULL			
config	4	UpdatedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		
error_context	1	ErrorContextID	varchar(50)	NO	NULL		PRI	UUID for error tracking
error_context	2	ErrorCode	varchar(50)	NO	NULL		MUL	Matches activity_log.ErrorCode
error_context	3	ErrorMessage	text	NO	NULL			User-friendly error message
error_context	4	TechnicalMessage	text	YES	NULL			Technical details for debugging
error_context	5	SuggestedFix	text	YES	NULL			Recommended resolution action
error_context	6	TableName	varchar(100)	NO	NULL		MUL	Which table had the issue
error_context	7	ColumnName	varchar(100)	YES	NULL			Which column (if applicable)
error_context	8	ConstraintName	varchar(100)	YES	NULL		MUL	Which constraint was violated
error_context	9	ProblematicValue	text	YES	NULL			The actual value that caused error
error_context	10	ValidValueExamples	text	YES	NULL			JSON array of valid example values
error_context	11	AllowedRange	varchar(200)	YES	NULL			If numeric: min-max; if enum: allowed values
error_context	12	OffendingRowID	varchar(255)	YES	NULL			Row identifier (JSON for compound keys)
error_context	13	OffendingRowContext	json	YES	NULL			Full row data (sensitive fields masked)
error_context	14	DetectedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED	MUL	When error was first logged
error_context	15	FirstOccurrence	datetime	YES	CURRENT_TIMESTAMP	DEFAULT_GENERATED		When this error first happened
error_context	16	LastOccurrence	datetime	YES	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		Most recent occurrence
error_context	17	OccurrenceCount	int	YES	1			How many times this error occurred
error_context	18	Severity	enum('INFO','WARNING','ERROR','CRITICAL')	YES	ERROR		MUL	
error_context	19	Status	enum('NEW','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','DUPLICATE','WONTFIX')	YES	NEW		MUL	
error_context	20	AssignedTo	varchar(255)	YES	NULL			Admin email responsible for fix
error_context	21	ResolutionNotes	text	YES	NULL			How it was fixed
error_context	22	ResolvedAt	datetime	YES	NULL			
gmail_transactions	1	TransactionNumber	varchar(100)	NO	NULL		PRI	
gmail_transactions	2	Timestamp	datetime	YES	NULL			From Sheets/GAS
gmail_transactions	3	Sender	varchar(255)	YES	NULL			
gmail_transactions	4	Amount	decimal(10,2)	YES	NULL			Total original amount
gmail_transactions	5	Memo	text	YES	NULL			
gmail_transactions	6	TransactionDate	date	YES	NULL			
gmail_transactions	7	PaymentMethod	varchar(100)	YES	NULL			Zelle, Venmo, etc.
gmail_transactions	8	MessageId	varchar(100)	NO	NULL			
gmail_transactions	9	Subject	text	YES	NULL			
gmail_transactions	10	OriginalMemo	text	YES	NULL			
gmail_transactions	11	Notes	text	YES	NULL			User friendly split summary
gmail_transactions	12	UpdatedAt	datetime	YES	NULL			Last linked time
member_log	1	LogID	varchar(50)	NO	NULL		PRI	
member_log	2	LoggingTime	datetime	NO	NULL		MUL	
member_log	3	MemberID	varchar(10)	NO	NULL		MUL	
member_log	4	ChangeType	varchar(20)	YES	NULL			
member_log	5	Status	varchar(50)	YES	NULL			
member_log	6	Created	datetime	YES	NULL			
member_log	7	Expiration	date	YES	NULL			
member_log	8	Email	varchar(255)	YES	NULL			
member_log	9	FirstName	varchar(100)	YES	NULL			
member_log	10	LastName	varchar(100)	YES	NULL			
member_log	11	Type	varchar(50)	YES	NULL			
member_log	12	FamilyID	varchar(10)	YES	NULL			
member_log	13	Gender	varchar(20)	YES	NULL			
member_log	14	WeChatID	varchar(100)	YES	NULL			
member_log	15	District	varchar(100)	YES	NULL			
member_log	16	MembershipFeePaid	decimal(10,2)	YES	NULL			
member_log	17	PaymentDate	date	YES	NULL			
member_log	18	PaymentTransaction	varchar(100)	YES	NULL			
member_log	19	JoinYear	smallint	YES	NULL			
member_log	20	PhoneNumber	varchar(30)	YES	NULL			
member_log	21	Notes	text	YES	NULL			
member_log	22	NYRRRunnerName	varchar(100)	YES	NULL			
member_log	23	YearBorn	smallint	YES	NULL			
members	1	MemberID	varchar(10)	NO	NULL		PRI	
members	2	Status	enum('active','expired','inactive','pending','pending_upgrade','lifetime')	NO	pending		MUL	active=paying; expired=may renew; inactive=left; pending=awaiting payment; pending_upgrade=upgrading to family; lifetime=lifetime member
members	3	Created	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
members	4	Expiration	date	YES	NULL		MUL	
members	5	Email	varchar(255)	NO	NULL		UNI	
members	6	FirstName	varchar(100)	NO	NULL			
members	7	LastName	varchar(100)	NO	NULL			
members	8	Type	enum('Individual','Family')	NO	Individual			
members	9	FamilyID	varchar(10)	YES	NULL		MUL	
members	10	Gender	varchar(20)	YES	NULL			
members	11	WeChatID	varchar(100)	YES	NULL			
members	12	District	varchar(100)	YES	NULL			
members	13	MembershipFeePaid	decimal(10,2)	YES	NULL			
members	14	PaymentDate	date	YES	NULL			
members	15	PaymentTransaction	varchar(100)	YES	NULL			
members	16	JoinYear	smallint	YES	NULL		MUL	
members	17	PhoneNumber	varchar(30)	YES	NULL			
members	18	Notes	text	YES	NULL			
members	19	NYRRRunnerName	varchar(100)	YES	NULL			
members	20	YearBorn	smallint	YES	NULL			
members	21	YearBornGuess	smallint	YES	NULL			System-inferred birth year from NYRR age data
members	22	password_hash	varchar(255)	YES	NULL			
members	23	google_sub	varchar(255)	YES	NULL		UNI	
members	24	microsoft_sub	varchar(255)	YES	NULL		UNI	
members	25	UpdatedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		
nyrr_event_runners	1	id	int	NO	NULL	auto_increment	PRI	
nyrr_event_runners	2	nyrr_event_id	int	NO	NULL		MUL	
nyrr_event_runners	3	nyrr_runner_id	varchar(20)	YES	NULL		MUL	
nyrr_event_runners	4	runner_name	varchar(200)	NO	NULL		MUL	
nyrr_event_runners	5	first_name	varchar(100)	YES	NULL			
nyrr_event_runners	6	last_name	varchar(100)	YES	NULL		MUL	
nyrr_event_runners	7	age	smallint	YES	NULL			
nyrr_event_runners	8	gender	varchar(10)	YES	NULL			
nyrr_event_runners	9	state_province	varchar(50)	YES	NULL			
nyrr_event_runners	10	city	varchar(100)	YES	NULL			
nyrr_event_runners	11	bib_number	varchar(20)	NO	NULL			
nyrr_event_runners	12	finish_time	varchar(20)	YES	NULL			
nyrr_event_runners	13	pace	varchar(20)	YES	NULL			
nyrr_event_runners	14	overall_place	int	YES	NULL			
nyrr_event_runners	15	gender_place	int	YES	NULL			
nyrr_event_runners	16	age_grade_time	varchar(20)	YES	NULL			
nyrr_event_runners	17	age_grade_place	int	YES	NULL			
nyrr_event_runners	18	age_grade_percent	decimal(5,2)	YES	NULL			
nyrr_event_runners	19	team_code	varchar(20)	YES	NULL		MUL	
nyrr_event_runners	20	sync_source	enum('finishers','mmr_team','both')	YES	NULL			
nyrr_event_runners	21	is_registered_only	tinyint(1)	NO	0			
nyrr_event_runners	22	mmr_member_id	varchar(10)	YES	NULL		MUL	
nyrr_event_runners	23	match_method	enum('auto_name','auto_lastname','auto_firstlast','auto_partial_name','manual','not_member','unmatched')	YES	NULL		MUL	
nyrr_event_runners	24	matched_by	varchar(100)	YES	NULL			
nyrr_event_runners	25	matched_at	datetime	YES	NULL			
nyrr_event_runners	26	scan_timestamp	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
nyrr_event_runners	27	created_at	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
nyrr_event_runners	28	updated_at	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		
nyrr_events	1	id	int	NO	NULL	auto_increment	PRI	
nyrr_events	2	event_code	varchar(255)	YES	NULL		UNI	
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
nyrr_events	15	nyrr_finisher_count	int	YES	NULL		MUL	
nyrr_events	16	mmr_runner_count	int	NO	0			
nyrr_events	17	mmr_matched_count	int	NO	0			
nyrr_events	18	notes	text	YES	NULL			
nyrr_events	19	created_at	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
nyrr_events	20	updated_at	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		
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
payments	2	MemberID	varchar(10)	YES	NULL		MUL	
payments	3	PaymentDate	date	YES	NULL		MUL	
payments	4	Amount	decimal(10,2)	NO	NULL			
payments	5	PaymentMethod	varchar(50)	YES	NULL			
payments	6	PayerName	varchar(100)	YES	NULL			
payments	7	MemoField	text	YES	NULL			
payments	8	Last4Digits	varchar(10)	YES	NULL			
payments	9	ProcessedBy	varchar(255)	YES	NULL			
payments	10	Source	varchar(50)	YES	NULL			
payments	11	Notes	text	YES	NULL			
payments	12	CreatedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
payments	13	TransactionNumber	varchar(100)	YES	NULL		MUL	Linked to gmail_transactions.TransactionNumber
payments	14	SubmissionID	varchar(50)	YES	NULL			Optional: Link to the user submission that started this
payments	15	PaymentType	varchar(50)	YES	NULL			Set at creation (e.g., Membership, Donation)
payments	16	UpdatedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP	MUL	Last modified timestamp for incremental sync
schema_migrations	1	version	varchar(50)	NO	NULL		PRI	
schema_migrations	2	description	varchar(255)	YES	NULL			
schema_migrations	3	executed_at	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
sheets_sync_log	1	SyncLogID	int	NO	NULL	auto_increment	PRI	
sheets_sync_log	2	JobID	varchar(36)	NO	NULL		MUL	Foreign key to sync_jobs.JobID
sheets_sync_log	3	ConfigKey	varchar(50)	NO	NULL		MUL	Sync config key (e.g., export_members, import_transactions)
sheets_sync_log	4	Direction	varchar(20)	NO	NULL			sheet_to_mysql or mysql_to_sheet
sheets_sync_log	5	BatchNumber	int	NO	NULL			Batch sequence (0, 1, 2, ...)
sheets_sync_log	6	BatchSize	int	NO	NULL			Number of rows in this batch
sheets_sync_log	7	TotalRows	int	NO	NULL			Total rows in entire sync operation
sheets_sync_log	8	StartedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED	MUL	When batch processing started
sheets_sync_log	9	CompletedAt	datetime	YES	NULL			When batch processing completed
sheets_sync_log	10	Status	enum('pending','processing','success','error')	NO	pending		MUL	
sheets_sync_log	11	ErrorMessage	text	YES	NULL			Error details if Status=error
sheets_sync_log	12	RowsProcessed	int	NO	0			Rows attempted in this batch
sheets_sync_log	13	RowsInserted	int	NO	0			Rows successfully inserted
sheets_sync_log	14	RowsUpdated	int	NO	0			Rows successfully updated
sheets_sync_log	15	RowsSkipped	int	NO	0			Rows skipped (duplicates, validation failures)
submissions	1	CreatedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		Timestamp when the user hits submit button
submissions	2	SubmissionID	varchar(50)	NO	NULL		PRI	auto gen unique identifier (migrated from EventID)
submissions	3	Status	enum('pending','approved','cancelled','expired')	NO	pending		MUL	Logic: once submitted=pending; matched payment=approved; past ExpiresAt=expired; user action=cancelled
submissions	4	MemberID	varchar(10)	NO	NULL		MUL	submitter MemberID from members table
submissions	5	SubmissionType	varchar(100)	NO	NULL			set at creation time (migrated from EventType)
submissions	6	ExpiresAt	datetime	YES	NULL		MUL	set at creation time
submissions	7	PaymentIntent	varchar(100)	YES	NULL			set at creation time
submissions	8	Amount	decimal(10,2)	YES	NULL			set at creation time
submissions	9	PaymentMethod	varchar(50)	YES	NULL			user input
submissions	10	PayerName	varchar(100)	YES	NULL			user input
submissions	11	PaymentDate	date	YES	NULL			user input
submissions	12	MemoField	text	YES	NULL			user input
submissions	13	Last4Digits	varchar(10)	YES	NULL			user input
submissions	14	PaymentID	varchar(50)	YES	NULL			added when approved; links to payments table
submissions	15	UpdatedByID	varchar(255)	YES	NULL			ID who updated this record the last time
submissions	16	UpdatedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		trigger at update
sync_jobs	1	JobID	varchar(16)	NO	NULL		PRI	
sync_jobs	2	Operation	varchar(100)	NO	NULL			
sync_jobs	3	Status	enum('queued','running','done','error')	NO	queued		MUL	
sync_jobs	4	Message	text	YES	NULL			
sync_jobs	5	Progress	int	YES	0			
sync_jobs	6	Result	longtext	YES	NULL			
sync_jobs	7	StartedAt	timestamp	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED	MUL	
sync_jobs	8	UpdatedAt	timestamp	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP	MUL	
sync_jobs	9	CompletedAt	timestamp	YES	NULL			
v_family_members	1	FamilyID	varchar(10)	YES	NULL			
v_family_members	2	primary_member_id	varchar(10)	YES	NULL			
v_family_members	3	member_id	varchar(10)	NO	NULL			
v_family_members	4	FirstName	varchar(100)	NO	NULL			
v_family_members	5	LastName	varchar(100)	NO	NULL			
v_family_members	6	Email	varchar(255)	NO	NULL			
v_family_members	7	Status	enum('active','expired','inactive','pending','pending_upgrade','lifetime')	NO	pending			active=paying; expired=may renew; inactive=left; pending=awaiting payment; pending_upgrade=upgrading to family; lifetime=lifetime member
v_family_members	8	Expiration	date	YES	NULL			
v_family_members	9	Type	enum('Individual','Family')	NO	Individual			
v_gmail_split_audit	1	TransactionNumber	varchar(100)	NO	NULL			
v_gmail_split_audit	2	Total	decimal(10,2)	YES	NULL			Total original amount
v_gmail_split_audit	3	Allocated	decimal(32,2)	NO	0.00			
v_gmail_split_audit	4	Balance	decimal(33,2)	YES	NULL			
v_gmail_split_audit	5	SplitHistory	text	YES	NULL			User friendly split summary
v_inconsistent_family_data	1	FamilyID	varchar(10)	YES	NULL			
v_inconsistent_family_data	2	TotalMembers	bigint	NO	0			
v_inconsistent_family_data	3	DistinctStatuses	bigint	NO	0			
v_inconsistent_family_data	4	DistinctExpirations	bigint	NO	0			
v_inconsistent_family_data	5	StatusesFound	text	YES	NULL			
v_inconsistent_family_data	6	ExpirationsFound	text	YES	NULL			
v_last_successful_batch	1	JobID	varchar(36)	NO	NULL			Foreign key to sync_jobs.JobID
v_last_successful_batch	2	ConfigKey	varchar(50)	NO	NULL			Sync config key (e.g., export_members, import_transactions)
v_last_successful_batch	3	LastSuccessfulBatch	int	YES	NULL			Batch sequence (0, 1, 2, ...)
v_last_successful_batch	4	LastSyncTime	datetime	YES	NULL			When batch processing started
v_payment_details	1	PaymentID	varchar(50)	NO	NULL			
v_payment_details	2	CreatedAt	datetime	NO	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
v_payment_details	3	MemberID	varchar(10)	NO	NULL			
v_payment_details	4	MemberFullName	varchar(201)	NO				
v_payment_details	5	FamilyID	varchar(10)	YES	NULL			
v_payment_details	6	PaymentType	varchar(50)	YES	NULL			Set at creation (e.g., Membership, Donation)
v_payment_details	7	Amount	decimal(10,2)	NO	NULL			
v_payment_details	8	PaymentDate	date	YES	NULL			
v_payment_details	9	TransactionNumber	varchar(100)	YES	NULL			Linked to gmail_transactions.TransactionNumber
v_payment_details	10	SubmissionType	varchar(100)	YES	NULL			set at creation time (migrated from EventType)
v_payment_details	11	ProcessedBy	varchar(255)	YES	NULL			
v_payment_details	12	Source	varchar(50)	YES	NULL			
v_payment_splits	1	TransactionNumber	varchar(100)	YES	NULL			
v_payment_splits	2	OriginalTotal	decimal(10,2)	YES	NULL			Total original amount
v_payment_splits	3	TotalAllocated	decimal(32,2)	YES	NULL			
v_payment_splits	4	RemainingBalance	decimal(33,2)	YES	NULL			
v_sync_summary	1	JobID	varchar(36)	NO	NULL			Foreign key to sync_jobs.JobID
v_sync_summary	2	ConfigKey	varchar(50)	NO	NULL			Sync config key (e.g., export_members, import_transactions)
v_sync_summary	3	TotalBatches	bigint	NO	0			
v_sync_summary	4	TotalInserted	decimal(32,0)	YES	NULL			
v_sync_summary	5	TotalUpdated	decimal(32,0)	YES	NULL			
v_sync_summary	6	TotalSkipped	decimal(32,0)	YES	NULL			
v_sync_summary	7	SuccessfulBatches	decimal(23,0)	YES	NULL			
v_sync_summary	8	FailedBatches	decimal(23,0)	YES	NULL			
v_sync_summary	9	LastCompletedAt	datetime	YES	NULL			When batch processing completed
v_unresolved_errors	1	ErrorContextID	varchar(50)	NO	NULL			UUID for error tracking
v_unresolved_errors	2	ErrorCode	varchar(50)	NO	NULL			Matches activity_log.ErrorCode
v_unresolved_errors	3	ErrorMessage	text	NO	NULL			User-friendly error message
v_unresolved_errors	4	TableName	varchar(100)	NO	NULL			Which table had the issue
v_unresolved_errors	5	ColumnName	varchar(100)	YES	NULL			Which column (if applicable)
v_unresolved_errors	6	Severity	enum('INFO','WARNING','ERROR','CRITICAL')	YES	ERROR			
v_unresolved_errors	7	OccurrenceCount	int	YES	1			How many times this error occurred
v_unresolved_errors	8	LastOccurrence	datetime	YES	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		Most recent occurrence
v_unresolved_errors	9	AssignedTo	varchar(255)	YES	NULL			Admin email responsible for fix
v_unresolved_errors	10	SuggestedFix	text	YES	NULL			Recommended resolution action
v_unresolved_errors	11	priority	varchar(6)	NO				
viewer_user_settings	1	id	int	NO	NULL	auto_increment	PRI	
viewer_user_settings	2	email	varchar(255)	NO	NULL		MUL	
viewer_user_settings	3	table_name	varchar(255)	NO	NULL			
viewer_user_settings	4	visible_columns	json	YES	NULL			
viewer_user_settings	5	created_at	datetime	YES	CURRENT_TIMESTAMP	DEFAULT_GENERATED		
viewer_user_settings	6	updated_at	datetime	YES	CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP		
section
=== 3. INDEXES ===
table	index_name	non_unique	seq	column_name	index_type	nullable
activity_log	idx_actlog_action	1	1	Action	BTREE	
activity_log	idx_actlog_memberid	1	1	MemberID	BTREE	YES
activity_log	idx_actlog_sessionid	1	1	SessionID	BTREE	YES
activity_log	idx_actlog_timestamp	1	1	Timestamp	BTREE	
activity_log	idx_error_code	1	1	ErrorCode	BTREE	YES
activity_log	idx_error_severity	1	1	ErrorSeverity	BTREE	YES
activity_log	PRIMARY	0	1	LogID	BTREE	
admin_member_overrides	fk_override_member	1	1	TargetMemberID	BTREE	
admin_member_overrides	PRIMARY	0	1	OverrideID	BTREE	
admin_users	email	0	1	email	BTREE	
admin_users	idx_admin_email	1	1	email	BTREE	
admin_users	idx_admin_role	1	1	role	BTREE	
admin_users	PRIMARY	0	1	id	BTREE	
config	PRIMARY	0	1	ConfigKey	BTREE	
error_context	idx_constraint	1	1	ConstraintName	BTREE	YES
error_context	idx_detected_at	1	1	DetectedAt	BTREE	
error_context	idx_error_code	1	1	ErrorCode	BTREE	
error_context	idx_severity_status	1	1	Severity	BTREE	YES
error_context	idx_severity_status	1	2	Status	BTREE	YES
error_context	idx_status	1	1	Status	BTREE	YES
error_context	idx_table_column	1	1	TableName	BTREE	
error_context	idx_table_column	1	2	ColumnName	BTREE	YES
error_context	PRIMARY	0	1	ErrorContextID	BTREE	
gmail_transactions	PRIMARY	0	1	TransactionNumber	BTREE	
member_log	idx_loggingtime	1	1	LoggingTime	BTREE	
member_log	idx_member_log_member_time	1	1	MemberID	BTREE	
member_log	idx_member_log_member_time	1	2	LoggingTime	BTREE	
member_log	idx_memberid	1	1	MemberID	BTREE	
member_log	PRIMARY	0	1	LogID	BTREE	
members	google_sub	0	1	google_sub	BTREE	YES
members	idx_expiration	1	1	Expiration	BTREE	YES
members	idx_family	1	1	FamilyID	BTREE	YES
members	idx_joinyear	1	1	JoinYear	BTREE	YES
members	idx_status	1	1	Status	BTREE	
members	microsoft_sub	0	1	microsoft_sub	BTREE	YES
members	PRIMARY	0	1	MemberID	BTREE	
members	uq_members_email	0	1	Email	BTREE	
nyrr_event_runners	idx_last_name	1	1	last_name	BTREE	YES
nyrr_event_runners	idx_match_method	1	1	match_method	BTREE	YES
nyrr_event_runners	idx_mmr_member	1	1	mmr_member_id	BTREE	YES
nyrr_event_runners	idx_runner_id	1	1	nyrr_runner_id	BTREE	YES
nyrr_event_runners	idx_runner_name	1	1	runner_name	BTREE	
nyrr_event_runners	idx_team_code	1	1	team_code	BTREE	YES
nyrr_event_runners	PRIMARY	0	1	id	BTREE	
nyrr_event_runners	uq_event_bib	0	1	nyrr_event_id	BTREE	
nyrr_event_runners	uq_event_bib	0	2	bib_number	BTREE	
nyrr_events	idx_event_date	1	1	event_date	BTREE	YES
nyrr_events	idx_event_year	1	1	event_year	BTREE	YES
nyrr_events	idx_finisher_count	1	1	nyrr_finisher_count	BTREE	YES
nyrr_events	idx_finisher_gap	1	1	event_date	BTREE	YES
nyrr_events	idx_finisher_gap	1	2	nyrr_finisher_count	BTREE	YES
nyrr_events	idx_finisher_gap	1	3	result_count	BTREE	
nyrr_events	idx_is_upcoming	1	1	is_upcoming	BTREE	
nyrr_events	idx_processing_status	1	1	processing_status	BTREE	
nyrr_events	PRIMARY	0	1	id	BTREE	
nyrr_events	uq_event_code	0	1	event_code	BTREE	YES
nyrr_processing_log	idx_log_event_id	1	1	nyrr_event_id	BTREE	YES
nyrr_processing_log	idx_log_run_status	1	1	run_status	BTREE	
nyrr_processing_log	idx_log_run_timestamp	1	1	run_timestamp	BTREE	
nyrr_processing_log	PRIMARY	0	1	id	BTREE	
password_reset_tokens	idx_prt_email	1	1	Email	BTREE	
password_reset_tokens	idx_prt_expiresat	1	1	ExpiresAt	BTREE	
password_reset_tokens	PRIMARY	0	1	TokenID	BTREE	
payments	idx_pay_tx	1	1	TransactionNumber	BTREE	YES
payments	idx_payments_memberid	1	1	MemberID	BTREE	YES
payments	idx_payments_paymentdate	1	1	PaymentDate	BTREE	YES
payments	idx_payments_updated_at	1	1	UpdatedAt	BTREE	
payments	PRIMARY	0	1	PaymentID	BTREE	
schema_migrations	PRIMARY	0	1	version	BTREE	
sheets_sync_log	idx_config_key	1	1	ConfigKey	BTREE	
sheets_sync_log	idx_jobid	1	1	JobID	BTREE	
sheets_sync_log	idx_started_at	1	1	StartedAt	BTREE	
sheets_sync_log	idx_status	1	1	Status	BTREE	
sheets_sync_log	PRIMARY	0	1	SyncLogID	BTREE	
sheets_sync_log	uk_job_batch	0	1	JobID	BTREE	
sheets_sync_log	uk_job_batch	0	2	BatchNumber	BTREE	
submissions	fk_submission_member	1	1	MemberID	BTREE	
submissions	idx_submissions_expires	1	1	ExpiresAt	BTREE	YES
submissions	idx_submissions_status	1	1	Status	BTREE	
submissions	idx_submissions_status_expires	1	1	Status	BTREE	
submissions	idx_submissions_status_expires	1	2	ExpiresAt	BTREE	YES
submissions	PRIMARY	0	1	SubmissionID	BTREE	
sync_jobs	PRIMARY	0	1	JobID	BTREE	
sync_jobs	StartedAt	1	1	StartedAt	BTREE	
sync_jobs	Status	1	1	Status	BTREE	
sync_jobs	UpdatedAt	1	1	UpdatedAt	BTREE	
viewer_user_settings	PRIMARY	0	1	id	BTREE	
viewer_user_settings	uq_user_table	0	1	email	BTREE	
viewer_user_settings	uq_user_table	0	2	table_name	BTREE	
section
=== 4. FOREIGN KEYS ===
table	column_name	constraint_name	ref_table	ref_column	UPDATE_RULE	DELETE_RULE
admin_member_overrides	TargetMemberID	fk_override_member	members	MemberID	NO ACTION	CASCADE
nyrr_event_runners	nyrr_event_id	fk_event_runners_event	nyrr_events	id	NO ACTION	CASCADE
nyrr_processing_log	nyrr_event_id	fk_processing_log_event	nyrr_events	id	NO ACTION	SET NULL
payments	MemberID	fk_payments_member	members	MemberID	NO ACTION	SET NULL
sheets_sync_log	JobID	fk_sheets_sync_log_jobid	sync_jobs	JobID	NO ACTION	CASCADE
submissions	MemberID	fk_submission_member	members	MemberID	NO ACTION	CASCADE
section
=== 5. VIEWS ===
view_name	VIEW_DEFINITION
v_family_members	select `m`.`FamilyID` AS `FamilyID`,min(`m`.`MemberID`) OVER (PARTITION BY `m`.`FamilyID` )  AS `primary_member_id`,`m`.`MemberID` AS `member_id`,`m`.`FirstName` AS `FirstName`,`m`.`LastName` AS `LastName`,`m`.`Email` AS `Email`,`m`.`Status` AS `Status`,`m`.`Expiration` AS `Expiration`,`m`.`Type` AS `Type` from `mmrdb`.`members` `m` where (`m`.`FamilyID` is not null)
v_gmail_split_audit	select `gt`.`TransactionNumber` AS `TransactionNumber`,`gt`.`Amount` AS `Total`,ifnull(sum(`p`.`Amount`),0) AS `Allocated`,(`gt`.`Amount` - ifnull(sum(`p`.`Amount`),0)) AS `Balance`,`gt`.`Notes` AS `SplitHistory` from (`mmrdb`.`gmail_transactions` `gt` left join `mmrdb`.`payments` `p` on((`gt`.`TransactionNumber` = `p`.`TransactionNumber`))) group by `gt`.`TransactionNumber`
v_inconsistent_family_data	select `m`.`FamilyID` AS `FamilyID`,count(`m`.`MemberID`) AS `TotalMembers`,count(distinct `m`.`Status`) AS `DistinctStatuses`,count(distinct `m`.`Expiration`) AS `DistinctExpirations`,group_concat(distinct `m`.`Status` order by `m`.`Status` ASC separator ', ') AS `StatusesFound`,group_concat(distinct ifnull(`m`.`Expiration`,'NULL') order by `m`.`Expiration` ASC separator ', ') AS `ExpirationsFound` from `mmrdb`.`members` `m` where (`m`.`FamilyID` is not null) group by `m`.`FamilyID` having ((`DistinctStatuses` > 1) or (`DistinctExpirations` > 1))
v_last_successful_batch	select `mmrdb`.`sheets_sync_log`.`JobID` AS `JobID`,`mmrdb`.`sheets_sync_log`.`ConfigKey` AS `ConfigKey`,max(`mmrdb`.`sheets_sync_log`.`BatchNumber`) AS `LastSuccessfulBatch`,max(`mmrdb`.`sheets_sync_log`.`StartedAt`) AS `LastSyncTime` from `mmrdb`.`sheets_sync_log` where (`mmrdb`.`sheets_sync_log`.`Status` = 'success') group by `mmrdb`.`sheets_sync_log`.`JobID`,`mmrdb`.`sheets_sync_log`.`ConfigKey`
v_payment_details	select `p`.`PaymentID` AS `PaymentID`,`p`.`CreatedAt` AS `CreatedAt`,`m`.`MemberID` AS `MemberID`,concat(`m`.`FirstName`,' ',`m`.`LastName`) AS `MemberFullName`,`m`.`FamilyID` AS `FamilyID`,`p`.`PaymentType` AS `PaymentType`,`p`.`Amount` AS `Amount`,`p`.`PaymentDate` AS `PaymentDate`,`p`.`TransactionNumber` AS `TransactionNumber`,`s`.`SubmissionType` AS `SubmissionType`,`p`.`ProcessedBy` AS `ProcessedBy`,`p`.`Source` AS `Source` from ((`mmrdb`.`payments` `p` join `mmrdb`.`members` `m` on((`p`.`MemberID` = `m`.`MemberID`))) left join `mmrdb`.`submissions` `s` on((`p`.`SubmissionID` = `s`.`SubmissionID`)))
v_payment_splits	select `gt`.`TransactionNumber` AS `TransactionNumber`,`gt`.`Amount` AS `OriginalTotal`,(select sum(`p`.`Amount`) from `mmrdb`.`payments` `p` where (`p`.`TransactionNumber` = `gt`.`TransactionNumber`)) AS `TotalAllocated`,(`gt`.`Amount` - (select ifnull(sum(`p`.`Amount`),0) from `mmrdb`.`payments` `p` where (`p`.`TransactionNumber` = `gt`.`TransactionNumber`))) AS `RemainingBalance` from `mmrdb`.`gmail_transactions` `gt`
v_sync_summary	select `mmrdb`.`sheets_sync_log`.`JobID` AS `JobID`,`mmrdb`.`sheets_sync_log`.`ConfigKey` AS `ConfigKey`,count(0) AS `TotalBatches`,sum(`mmrdb`.`sheets_sync_log`.`RowsInserted`) AS `TotalInserted`,sum(`mmrdb`.`sheets_sync_log`.`RowsUpdated`) AS `TotalUpdated`,sum(`mmrdb`.`sheets_sync_log`.`RowsSkipped`) AS `TotalSkipped`,sum((case when (`mmrdb`.`sheets_sync_log`.`Status` = 'success') then 1 else 0 end)) AS `SuccessfulBatches`,sum((case when (`mmrdb`.`sheets_sync_log`.`Status` = 'error') then 1 else 0 end)) AS `FailedBatches`,max(`mmrdb`.`sheets_sync_log`.`CompletedAt`) AS `LastCompletedAt` from `mmrdb`.`sheets_sync_log` group by `mmrdb`.`sheets_sync_log`.`JobID`,`mmrdb`.`sheets_sync_log`.`ConfigKey`
v_unresolved_errors	select `mmrdb`.`error_context`.`ErrorContextID` AS `ErrorContextID`,`mmrdb`.`error_context`.`ErrorCode` AS `ErrorCode`,`mmrdb`.`error_context`.`ErrorMessage` AS `ErrorMessage`,`mmrdb`.`error_context`.`TableName` AS `TableName`,`mmrdb`.`error_context`.`ColumnName` AS `ColumnName`,`mmrdb`.`error_context`.`Severity` AS `Severity`,`mmrdb`.`error_context`.`OccurrenceCount` AS `OccurrenceCount`,`mmrdb`.`error_context`.`LastOccurrence` AS `LastOccurrence`,`mmrdb`.`error_context`.`AssignedTo` AS `AssignedTo`,`mmrdb`.`error_context`.`SuggestedFix` AS `SuggestedFix`,(case when (`mmrdb`.`error_context`.`Severity` = 'CRITICAL') then 'URGENT' when ((`mmrdb`.`error_context`.`Severity` = 'ERROR') and (`mmrdb`.`error_context`.`OccurrenceCount` > 5)) then 'HIGH' when (`mmrdb`.`error_context`.`Severity` = 'ERROR') then 'MEDIUM' else 'LOW' end) AS `priority` from `mmrdb`.`error_context` where (`mmrdb`.`error_context`.`Status` in ('NEW','ACKNOWLEDGED','IN_PROGRESS')) order by field(`mmrdb`.`error_context`.`Severity`,'CRITICAL','ERROR','WARNING','INFO') desc,`mmrdb`.`error_context`.`OccurrenceCount` desc,`mmrdb`.`error_context`.`LastOccurrence` desc
section
=== 6. ROUTINES ===
type	name	return_type	body
PROCEDURE	generate_member_id		BEGIN
    DECLARE max_num INT DEFAULT 0;
    START TRANSACTION;
        SELECT COALESCE(MAX(CAST(SUBSTRING(MemberID, 2) AS UNSIGNED)), 0) INTO max_num FROM members FOR UPDATE;
        SET new_id = CONCAT('A', LPAD(max_num + 1, 4, '0'));
    COMMIT;
END
PROCEDURE	sp_admin_update_member_status		BEGIN
    DECLARE v_OldStatus     VARCHAR(50);
    DECLARE v_OldExpiration DATE;
    DECLARE v_OldNotes      TEXT;
    DECLARE v_FamilyID      VARCHAR(20);
    DECLARE v_ActionType    VARCHAR(50);

    -- If the audit INSERT into admin_member_overrides fails (FK, constraint, etc.),
    -- continue so the members table changes are not rolled back and the SP still
    -- returns normally (idempotency preserved; Sheets sync cannot overwrite changes).
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;

    -- Snapshot current state
    SELECT Status, Expiration, Notes, FamilyID
    INTO v_OldStatus, v_OldExpiration, v_OldNotes, v_FamilyID
    FROM members
    WHERE MemberID = p_MemberID;

    -- Dynamic ActionType for audit trail
    SET v_ActionType = CASE p_NewStatus
        WHEN 'active'   THEN 'MARK_ACTIVE'
        WHEN 'lifetime' THEN 'LIFETIME_SET'
        ELSE                 'INACTIVE_SET'
    END;

    -- Allow Expiration changes (members_before_update trigger guard)
    SET @internal_proc = 1;

    IF v_FamilyID IS NOT NULL AND v_FamilyID != '' THEN
        UPDATE members
        SET Status     = p_NewStatus,
            Expiration = CASE
                WHEN p_NewExpiration IS NOT NULL THEN p_NewExpiration
                WHEN p_NewStatus = 'lifetime'    THEN '2126-03-31'
                ELSE Expiration
            END,
            Notes      = CONCAT(IFNULL(Notes, ''), '
', p_NewNotes),
            UpdatedAt  = NOW()
        WHERE FamilyID = v_FamilyID
           OR MemberID = p_MemberID;
    ELSE
        UPDATE members
        SET Status     = p_NewStatus,
            Expiration = CASE
                WHEN p_NewExpiration IS NOT NULL THEN p_NewExpiration
                WHEN p_NewStatus = 'lifetime'    THEN '2126-03-31'
                ELSE Expiration
            END,
            Notes      = CONCAT(IFNULL(Notes, ''), '
', p_NewNotes),
            UpdatedAt  = NOW()
        WHERE MemberID = p_MemberID;
    END IF;

    SET @internal_proc = NULL;

    -- Log to member_log (ChangeType reflects the actual action)
    INSERT INTO member_log (LogID, MemberID, ChangeType, Status, Expiration, LoggingTime)
    VALUES (UUID(), p_MemberID, v_ActionType, p_NewStatus, p_NewExpiration, NOW());

    -- Build impacted member ID list for audit
    SET @impacted_ids = p_MemberID;
    IF v_FamilyID IS NOT NULL AND v_FamilyID != '' THEN
        SELECT GROUP_CONCAT(MemberID ORDER BY MemberID SEPARATOR ',')
        INTO @impacted_ids
        FROM members
        WHERE FamilyID = v_FamilyID;
    END IF;

    -- Audit trail
    INSERT INTO admin_member_overrides
        (AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType,
         OldValue, NewValue, AdminNotes, Timestamp)
    VALUES
        (p_AdminEmail, p_MemberID, @impacted_ids,
         v_ActionType, v_OldStatus, p_NewStatus, p_NewNotes, NOW());

END
PROCEDURE	sp_cancel_payment		BEGIN
    DECLARE v_member_id      VARCHAR(10)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_payment_type   VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_submission_id  VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_tx_number      VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_family_id      VARCHAR(10)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

    DECLARE v_prev_status     VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_prev_expiration DATE;
    DECLARE v_prev_fee_paid   DECIMAL(10,2);
    DECLARE v_prev_pay_date   DATE;
    DECLARE v_prev_pay_tx     VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- 1. Fetch payment record
    SELECT MemberID, PaymentType, SubmissionID, TransactionNumber
    INTO v_member_id, v_payment_type, v_submission_id, v_tx_number
    FROM payments
    WHERE PaymentID = p_payment_id
    FOR UPDATE;

    IF v_member_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment not found.';
    END IF;

    -- 2. If Membership — restore member from member_log
    IF LOWER(v_payment_type) LIKE '%membership%' THEN

        SELECT Status, Expiration, MembershipFeePaid, PaymentDate, PaymentTransaction
        INTO v_prev_status, v_prev_expiration, v_prev_fee_paid, v_prev_pay_date, v_prev_pay_tx
        FROM member_log
        WHERE MemberID = v_member_id
          AND LoggingTime < (SELECT CreatedAt FROM payments WHERE PaymentID = p_payment_id)
        ORDER BY LoggingTime DESC
        LIMIT 1;

        SELECT FamilyID INTO v_family_id FROM members WHERE MemberID = v_member_id LIMIT 1;

        SET @internal_proc = 1;
        UPDATE members
        SET
            Status             = IFNULL(v_prev_status, 'inactive'),
            Expiration         = v_prev_expiration,
            MembershipFeePaid  = v_prev_fee_paid,
            PaymentDate        = v_prev_pay_date,
            PaymentTransaction = v_prev_pay_tx,
            UpdatedAt          = NOW()
        WHERE MemberID = v_member_id
           OR (v_family_id IS NOT NULL AND v_family_id <> '' AND FamilyID = v_family_id);
        SET @internal_proc = NULL;

    END IF;

    -- 3. Revert submission → pending
    IF v_submission_id IS NOT NULL THEN
        UPDATE submissions
        SET Status = 'pending', PaymentID = NULL
        WHERE SubmissionID = v_submission_id;
    END IF;

    -- 4. Clear gmail_transactions payment-link columns
    IF v_tx_number IS NOT NULL THEN
        UPDATE gmail_transactions
        SET Notes = NULL, UpdatedAt = NULL
        WHERE TransactionNumber = v_tx_number;
    END IF;

    -- 5. Audit log
    INSERT INTO activity_log (LogID, Timestamp, MemberID, Action, State, ErrorSeverity)
    VALUES (UUID(), NOW(), v_member_id, 'PAYMENT_CANCELLED', p_payment_id, 'INFO');

    -- 6. Delete the payment
    DELETE FROM payments WHERE PaymentID = p_payment_id;

    COMMIT;

    SELECT CONCAT('Payment ', p_payment_id, ' cancelled successfully.') AS result;

END
PROCEDURE	sp_clear_transaction		BEGIN
    DECLARE done         INT DEFAULT 0;
    DECLARE v_payment_id VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_member_id  VARCHAR(10)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_pay_type   VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_sub_id     VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_family_id  VARCHAR(10)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_prev_status    VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_prev_pay_tx    VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_prev_expiration DATE;
    DECLARE v_prev_fee_paid   DECIMAL(10,2);
    DECLARE v_prev_pay_date   DATE;
    DECLARE v_pay_created_at  DATETIME;
    DECLARE done2 INT DEFAULT 0;

    -- Cursor 1: payments → submission revert
    DECLARE cur_payments CURSOR FOR
        SELECT PaymentID, MemberID, PaymentType, SubmissionID, CreatedAt
        FROM payments
        WHERE TransactionNumber = p_tx_number;

    -- Cursor 2: membership members snapshot (populated into temp table before any deletes)
    DECLARE cur_members CURSOR FOR
        SELECT member_id, min_created_at FROM tmp_tx_members;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_dry_run = 0 THEN ROLLBACK; END IF;
        DROP TEMPORARY TABLE IF EXISTS tmp_tx_members;
        RESIGNAL;
    END;

    -- Validate
    IF NOT EXISTS (SELECT 1 FROM gmail_transactions WHERE TransactionNumber = p_tx_number) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'TransactionNumber not found in gmail_transactions.';
    END IF;

    -- =========================================================================
    -- DRY RUN — preview only, no writes
    -- =========================================================================
    IF p_dry_run = 1 THEN

        SELECT
            'gmail_transactions' AS target_table,
            p_tx_number          AS TransactionNumber,
            Notes                AS current_Notes,
            'NULL'               AS new_Notes,
            UpdatedAt            AS current_UpdatedAt,
            'NULL'               AS new_UpdatedAt
        FROM gmail_transactions
        WHERE TransactionNumber = p_tx_number;

        SELECT
            'payments' AS target_table,
            PaymentID, MemberID, PaymentType, Amount, SubmissionID,
            'DELETE'   AS action
        FROM payments
        WHERE TransactionNumber = p_tx_number;

        SELECT
            'submissions'    AS target_table,
            s.SubmissionID,
            s.Status         AS current_status,
            'pending'        AS new_status,
            s.PaymentID      AS current_PaymentID,
            'NULL'           AS new_PaymentID
        FROM submissions s
        INNER JOIN payments p ON s.SubmissionID = p.SubmissionID
        WHERE p.TransactionNumber = p_tx_number;

        SELECT
            'members'              AS target_table,
            p.MemberID,
            m.Status               AS current_status,
            ml.Status              AS restore_status,
            m.Expiration           AS current_expiration,
            ml.Expiration          AS restore_expiration,
            m.MembershipFeePaid    AS current_fee_paid,
            ml.MembershipFeePaid   AS restore_fee_paid,
            m.PaymentDate          AS current_pay_date,
            ml.PaymentDate         AS restore_pay_date,
            m.PaymentTransaction   AS current_pay_tx,
            ml.PaymentTransaction  AS restore_pay_tx
        FROM payments p
        INNER JOIN members m ON p.MemberID = m.MemberID
        LEFT JOIN member_log ml ON ml.MemberID = p.MemberID
            AND ml.LoggingTime = (
                SELECT MAX(LoggingTime) FROM member_log
                WHERE MemberID = p.MemberID
                  AND LoggingTime < p.CreatedAt
            )
        WHERE p.TransactionNumber = p_tx_number
          AND LOWER(p.PaymentType) LIKE '%membership%';

    -- =========================================================================
    -- EXECUTE
    -- =========================================================================
    ELSE
        START TRANSACTION;

        -- Step 0: Snapshot affected membership members BEFORE any deletes
        DROP TEMPORARY TABLE IF EXISTS tmp_tx_members;
        CREATE TEMPORARY TABLE tmp_tx_members AS
            SELECT MemberID AS member_id, MIN(CreatedAt) AS min_created_at
            FROM payments
            WHERE TransactionNumber = p_tx_number
              AND LOWER(PaymentType) LIKE '%membership%'
            GROUP BY MemberID;

        -- Step 1: Revert linked submissions → pending
        OPEN cur_payments;
        sub_loop: LOOP
            FETCH cur_payments INTO v_payment_id, v_member_id, v_pay_type, v_sub_id, v_pay_created_at;
            IF done THEN LEAVE sub_loop; END IF;
            IF v_sub_id IS NOT NULL THEN
                UPDATE submissions
                SET Status = 'pending', PaymentID = NULL
                WHERE SubmissionID = v_sub_id;
            END IF;
        END LOOP;
        CLOSE cur_payments;

        -- Step 2: Delete all payments for this transaction
        DELETE FROM payments WHERE TransactionNumber = p_tx_number;

        -- Step 3: Clear gmail_transactions payment-link columns
        UPDATE gmail_transactions
        SET Notes = NULL, UpdatedAt = NULL
        WHERE TransactionNumber = p_tx_number;

        -- Step 4: Revert members independently (runs even if no submissions/payments remain)
        SET done2 = 0;
        OPEN cur_members;
        member_loop: LOOP
            FETCH cur_members INTO v_member_id, v_pay_created_at;
            IF done2 THEN LEAVE member_loop; END IF;

            SELECT FamilyID INTO v_family_id
            FROM members WHERE MemberID = v_member_id LIMIT 1;

            SELECT Status, Expiration, MembershipFeePaid, PaymentDate, PaymentTransaction
            INTO v_prev_status, v_prev_expiration, v_prev_fee_paid, v_prev_pay_date, v_prev_pay_tx
            FROM member_log
            WHERE MemberID = v_member_id
              AND LoggingTime < v_pay_created_at
            ORDER BY LoggingTime DESC
            LIMIT 1;

            SET @internal_proc = 1;
            UPDATE members
            SET
                Status             = IFNULL(v_prev_status, 'inactive'),
                Expiration         = v_prev_expiration,
                MembershipFeePaid  = v_prev_fee_paid,
                PaymentDate        = v_prev_pay_date,
                PaymentTransaction = v_prev_pay_tx,
                UpdatedAt          = NOW()
            WHERE MemberID = v_member_id
               OR (v_family_id IS NOT NULL AND v_family_id <> ''
                   AND FamilyID = v_family_id);
            SET @internal_proc = NULL;

        END LOOP;
        CLOSE cur_members;

        DROP TEMPORARY TABLE IF EXISTS tmp_tx_members;

        -- Step 5: Audit log
        INSERT INTO activity_log (LogID, Timestamp, Action, State, ErrorSeverity)
        VALUES (UUID(), NOW(), 'TRANSACTION_CLEARED', p_tx_number, 'INFO');

        COMMIT;

        SELECT CONCAT('Transaction ', p_tx_number, ' cleared successfully.') AS result;

    END IF;

END
PROCEDURE	sp_delink_member_payment		BEGIN
    DECLARE v_current_tx        VARCHAR(100);
    DECLARE v_tx_first_set_at   DATETIME;
    DECLARE v_prev_status       VARCHAR(50);
    DECLARE v_prev_expiration   DATE;
    DECLARE v_prev_fee_paid     DECIMAL(10,2);
    DECLARE v_prev_pay_date     DATE;
    DECLARE v_prev_pay_tx       VARCHAR(100);
    DECLARE v_payment_id        VARCHAR(100) DEFAULT NULL;
    DECLARE v_recomputed_notes  TEXT DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_dry_run = 0 THEN ROLLBACK; END IF;
        RESIGNAL;
    END;

    -- 1. Validate member exists and has a PaymentTransaction set
    SELECT PaymentTransaction
    INTO v_current_tx
    FROM members
    WHERE MemberID = p_member_id
    LIMIT 1;

    IF v_current_tx IS NULL OR v_current_tx = '' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Member has no PaymentTransaction to delink.';
    END IF;

    -- 2. Find when PaymentTransaction was first set to the current value in member_log
    SELECT MIN(LoggingTime)
    INTO v_tx_first_set_at
    FROM member_log
    WHERE MemberID = p_member_id
      AND PaymentTransaction = v_current_tx;

    IF v_tx_first_set_at IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'No member_log entry found where PaymentTransaction matches current value. Cannot safely determine restore point.';
    END IF;

    -- 3. Get the member_log snapshot just BEFORE the bad stamp
    --    If no prior entry exists (member was new when stamped), all v_prev_* stay NULL —
    --    payment fields will be cleared to NULL, status falls back to 'inactive'.
    SELECT Status, Expiration, MembershipFeePaid, PaymentDate, PaymentTransaction
    INTO v_prev_status, v_prev_expiration, v_prev_fee_paid, v_prev_pay_date, v_prev_pay_tx
    FROM member_log
    WHERE MemberID = p_member_id
      AND LoggingTime < v_tx_first_set_at
    ORDER BY LoggingTime DESC
    LIMIT 1;

    -- 4. Validate restored Status against members ENUM; fall back to 'inactive' if invalid/null
    SET v_prev_status = CASE
        WHEN v_prev_status IN ('active','expired','inactive','pending','pending_upgrade','lifetime')
        THEN v_prev_status
        ELSE 'inactive'
    END;

    -- 5. Check whether a payments record exists for this member+transaction
    SELECT PaymentID INTO v_payment_id
    FROM payments
    WHERE MemberID = p_member_id
      AND TransactionNumber = v_current_tx
    LIMIT 1;

    -- =========================================================
    -- DRY RUN — preview only
    -- =========================================================
    IF p_dry_run = 1 THEN

        SELECT
            p_member_id                             AS MemberID,
            v_current_tx                            AS current_PaymentTransaction,
            v_tx_first_set_at                       AS bad_stamp_first_logged_at,
            (SELECT Status      FROM members WHERE MemberID = p_member_id) AS current_Status,
            v_prev_status                           AS restore_Status,
            (SELECT Expiration  FROM members WHERE MemberID = p_member_id) AS current_Expiration,
            v_prev_expiration                       AS restore_Expiration,
            (SELECT MembershipFeePaid FROM members WHERE MemberID = p_member_id) AS current_FeePaid,
            v_prev_fee_paid                         AS restore_FeePaid,
            (SELECT PaymentDate FROM members WHERE MemberID = p_member_id) AS current_PaymentDate,
            v_prev_pay_date                         AS restore_PaymentDate,
            v_prev_pay_tx                           AS restore_PaymentTransaction,
            v_payment_id                            AS payments_record_to_delete,
            (SELECT Notes FROM gmail_transactions WHERE TransactionNumber = v_current_tx LIMIT 1)
                                                    AS current_gmail_Notes,
            IF(v_payment_id IS NOT NULL,
                'payments record will be deleted + Notes recomputed',
                'no payments record found for this member+tx'
            )                                       AS payments_action,
            IF(v_prev_pay_tx IS NULL,
                'NOTE: no prior log entry — payment fields will be cleared to NULL',
                'DRY RUN — no changes made'
            )                                       AS note;

    -- =========================================================
    -- EXECUTE
    -- =========================================================
    ELSE
        START TRANSACTION;

        -- A. Restore members fields to pre-mismatch state
        SET @internal_proc = 1;
        UPDATE members
        SET
            Status             = v_prev_status,
            Expiration         = v_prev_expiration,
            MembershipFeePaid  = v_prev_fee_paid,
            PaymentDate        = v_prev_pay_date,
            PaymentTransaction = v_prev_pay_tx,
            UpdatedAt          = NOW()
        WHERE MemberID = p_member_id;
        SET @internal_proc = NULL;

        -- B. Delete the bad payments record if one exists for this member+tx.
        --    No DELETE trigger on payments updates gmail_transactions.Notes,
        --    so we recompute it manually below.
        IF v_payment_id IS NOT NULL THEN
            DELETE FROM payments
            WHERE PaymentID = v_payment_id;
        END IF;

        -- C. Recompute gmail_transactions.Notes based on remaining payments for this tx.
        --    Uses the same GROUP_CONCAT logic as trg_payments_sync_to_gmail_on_change_after_payment_insert.
        SELECT GROUP_CONCAT(
                   CONCAT('(', MemberID, ', ', IFNULL(PaymentType, 'N/A'), ', ', Amount, ')')
                   SEPARATOR '; '
               )
        INTO v_recomputed_notes
        FROM payments
        WHERE TransactionNumber = v_current_tx;

        UPDATE gmail_transactions
        SET
            Notes     = v_recomputed_notes,
            UpdatedAt = NOW()
        WHERE TransactionNumber = v_current_tx;

        -- D. Audit log
        INSERT INTO activity_log (LogID, Timestamp, MemberID, Action, State, ErrorSeverity)
        VALUES (
            UUID(), NOW(), p_member_id,
            'PAYMENT_DELINKED',
            LEFT(CONCAT('tx=', v_current_tx, IF(v_payment_id IS NOT NULL, ' +del', '')), 50),
            'INFO'
        );

        COMMIT;

        SELECT
            CONCAT('Member ', p_member_id, ' delinked from tx ', v_current_tx) AS result,
            IF(v_payment_id IS NOT NULL, 'deleted', 'none found')               AS payments_record,
            v_recomputed_notes                                                   AS new_gmail_Notes;

    END IF;

END
PROCEDURE	sp_error_summary_report		BEGIN
  
  SELECT
    `ErrorCode`,
    `TableName`,
    `ColumnName`,
    `Severity`,
    `Status`,
    COUNT(*) as occurrence_count,
    MIN(`FirstOccurrence`) as first_seen,
    MAX(`LastOccurrence`) as last_seen,
    GROUP_CONCAT(DISTINCT `OffendingRowID` SEPARATOR ', ') as sample_row_ids,
    MAX(`SuggestedFix`) as recommended_fix
  FROM `error_context`
  WHERE `DetectedAt` >= NOW() - INTERVAL days_back DAY
  GROUP BY `ErrorCode`, `Severity`, `Status`
  ORDER BY occurrence_count DESC, `Severity` DESC;
END
PROCEDURE	sp_link_transaction		BEGIN
    -- 1. Validation: Ensure the transaction exists in Gmail records
    IF NOT EXISTS (SELECT 1 FROM gmail_transactions WHERE TransactionNumber = p_transaction_number) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Error: TransactionNumber not found in gmail_transactions.';
    END IF;

    -- 2. Validation: Ensure the member exists
    IF NOT EXISTS (SELECT 1 FROM members WHERE MemberID = p_member_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Error: MemberID not found.';
    END IF;

    -- 3. Create the payment record.
    -- This single insert will trigger:
    --   - trg_payments_auto_fill: Pulls Date/Sender/Memo from Gmail
    --   - trg_payments_sync_membership_only: Updates member status/expiration/fee
    --   - trg_payments_approve_submission: Marks web form as 'approved'
    --   - trg_payments_sync_to_gmail_on_change: Updates the Notes on the Gmail record
    INSERT INTO `payments` (
        `PaymentID`,
        `MemberID`,
        `TransactionNumber`,
        `PaymentType`,
        `Amount`,
        `SubmissionID`,
        `UpdatedAt`
    ) VALUES (
        REPLACE(UUID(), '-', ''), -- Generate a clean ID
        p_member_id,
        p_transaction_number,
        p_payment_type,
        p_amount,
        p_submission_id,
        NOW()
    );

END
PROCEDURE	sp_reconcile_member_payments		BEGIN
    DECLARE v_start_date DATE;
    DECLARE v_target_expiration DATE;

    SELECT CAST(ConfigValue AS DATE) INTO v_start_date      FROM config WHERE ConfigKey = 'MembershipCollectionStart';
    SELECT CAST(ConfigValue AS DATE) INTO v_target_expiration FROM config WHERE ConfigKey = 'MembershipYearEnd';

    DROP TEMPORARY TABLE IF EXISTS tmp_to_update;
    CREATE TEMPORARY TABLE tmp_to_update AS
    SELECT DISTINCT
        m.MemberID,
        m.FamilyID,
        p.TransactionNumber AS actual_tx,
        p.PaymentDate       AS actual_date,
        p.Amount            AS actual_amount
    FROM members m
    INNER JOIN payments p ON m.MemberID = p.MemberID
    WHERE LOWER(p.PaymentType) LIKE '%membership%'
      AND p.PaymentDate >= v_start_date
      AND m.Status <> 'lifetime'
      AND (
        m.Status         <> 'active'                     -- NEW: catch inactive despite valid payment
        OR m.Expiration  <> v_target_expiration
        OR m.PaymentTransaction <> p.TransactionNumber
        OR (p.PaymentDate IS NOT NULL AND (m.PaymentDate IS NULL OR m.PaymentDate <> p.PaymentDate))
      );

    IF p_dry_run THEN
        SELECT
            'DRY RUN'                            AS run_status,
            t.MemberID,
            CONCAT(m.FirstName, ' ', m.LastName) AS member_name,
            m.Type                               AS member_type,
            m.Status                             AS current_status,
            'active'                             AS target_status,
            CASE WHEN m.Status <> 'active' THEN 'STATUS MISMATCH' ELSE 'ok' END AS status_match,
            m.Expiration                         AS current_expiration,
            v_target_expiration                  AS target_expiration,
            CASE WHEN m.Expiration <> v_target_expiration THEN 'EXP MISMATCH' ELSE 'ok' END AS exp_match,
            m.PaymentTransaction                 AS current_tx,
            t.actual_tx                          AS new_tx,
            m.PaymentDate                        AS current_payment_date,
            t.actual_date                        AS new_payment_date,
            t.actual_amount                      AS new_amount,
            t.FamilyID
        FROM tmp_to_update t
        INNER JOIN members m ON t.MemberID = m.MemberID
        ORDER BY status_match DESC, exp_match DESC, m.LastName, m.FirstName;
    ELSE
        START TRANSACTION;
        SET @internal_proc = 1;

        -- Fix primary members
        UPDATE members m
        INNER JOIN tmp_to_update t ON m.MemberID = t.MemberID
        SET
            m.Status             = 'active',
            m.Expiration         = v_target_expiration,
            m.PaymentTransaction = t.actual_tx,
            m.PaymentDate        = t.actual_date,
            m.MembershipFeePaid  = t.actual_amount,
            m.UpdatedAt          = NOW();

        -- Cascade to family members
        UPDATE members
        SET
            Status     = 'active',
            Expiration = v_target_expiration,
            UpdatedAt  = NOW()
        WHERE FamilyID IN (SELECT DISTINCT FamilyID FROM tmp_to_update WHERE FamilyID <> '' AND FamilyID IS NOT NULL);

        COMMIT;
        SET @internal_proc = NULL;

        SELECT 'SUCCESS' AS run_status, t.* FROM tmp_to_update t;
    END IF;

    DROP TEMPORARY TABLE IF EXISTS tmp_to_update;
END
PROCEDURE	sp_renewal_audit		BEGIN
  
  DROP TEMPORARY TABLE IF EXISTS tmp_audit_results;
  DROP TEMPORARY TABLE IF EXISTS tmp_matching_txns;

  
  CREATE TEMPORARY TABLE tmp_audit_results (
    message_id VARCHAR(100),
    amount DECIMAL(10,2),
    transaction_date DATE,
    sender VARCHAR(255),
    memo TEXT,
    member_id VARCHAR(10),
    member_name VARCHAR(255),
    current_expiration DATE,
    target_expiration DATE,
    status_match VARCHAR(20),
    trace_route VARCHAR(100),
    family_members_checked INT DEFAULT NULL,
    family_all_match CHAR(1) DEFAULT NULL
  );

  
  CREATE TEMPORARY TABLE tmp_matching_txns (
    message_id VARCHAR(100),
    amount DECIMAL(10,2),
    transaction_date DATE,
    transaction_number VARCHAR(100),
    sender VARCHAR(255),
    memo TEXT,
    original_memo TEXT,
    traced BOOLEAN DEFAULT FALSE,
    member_id VARCHAR(10)
  );

  
  INSERT INTO tmp_matching_txns (message_id, amount, transaction_date, transaction_number, sender, memo, original_memo)
  SELECT MessageId, Amount, TransactionDate, TransactionNumber, Sender, Memo, OriginalMemo
  FROM gmail_transactions
  WHERE TransactionDate BETWEEN p_start_date AND p_end_date
    AND Amount IN (30.00, 50.00);

  
  UPDATE tmp_matching_txns txn
  INNER JOIN members m ON txn.transaction_number = m.PaymentTransaction
  SET txn.member_id = m.MemberID, txn.traced = TRUE;

  
  UPDATE tmp_matching_txns txn
  INNER JOIN payments p ON txn.transaction_number = p.TransactionNumber
  INNER JOIN members m ON p.MemberID = m.MemberID
  SET txn.member_id = m.MemberID, txn.traced = TRUE
  WHERE txn.traced = FALSE;

  
  INSERT INTO tmp_audit_results (
    message_id, amount, transaction_date, sender, memo,
    member_id, member_name, current_expiration, target_expiration,
    status_match, trace_route
  )
  SELECT
    txn.message_id, txn.amount, txn.transaction_date, txn.sender,
    COALESCE(txn.memo, txn.original_memo, ''),
    txn.member_id, CONCAT(m.FirstName, ' ', m.LastName),
    m.Expiration, p_target_expiration,
    CASE
      WHEN m.Expiration IS NULL THEN 'ERROR'
      WHEN m.Expiration >= p_target_expiration THEN 'MATCH'
      ELSE 'MISMATCH'
    END,
    CASE
      WHEN m.PaymentTransaction = txn.transaction_number THEN 'members.PaymentTransaction'
      WHEN txn.traced THEN 'payments.TransactionNumber'
      ELSE 'UNKNOWN'
    END
  FROM tmp_matching_txns txn
  INNER JOIN members m ON txn.member_id = m.MemberID
  WHERE (p_membership_type = 'both')
     OR (p_membership_type = 'individual' AND LOWER(m.Type) = 'individual')
     OR (p_membership_type = 'family' AND LOWER(m.Type) = 'family');

  
  INSERT INTO tmp_audit_results (message_id, amount, transaction_date, sender, memo, status_match, trace_route)
  SELECT message_id, amount, transaction_date, sender, COALESCE(memo, original_memo, ''), 'NOT TRACED', 'NOT FOUND'
  FROM tmp_matching_txns WHERE member_id IS NULL;

  
  UPDATE tmp_audit_results audit
  INNER JOIN members m ON audit.member_id = m.MemberID
  SET
    audit.family_members_checked = (SELECT COUNT(*) FROM members m2 WHERE m2.FamilyID = m.FamilyID),
    audit.family_all_match = (
        SELECT IF(MIN(m3.Expiration >= p_target_expiration) = 1, 'Y', 'N')
        FROM members m3 WHERE m3.FamilyID = m.FamilyID
    )
  WHERE m.FamilyID IS NOT NULL;

  
  SELECT * FROM tmp_audit_results 
  WHERE (p_only_mismatches IS FALSE OR status_match <> 'MATCH')
  ORDER BY 
    FIELD(status_match, 'MISMATCH', 'NOT TRACED', 'MATCH', 'ERROR'),
    transaction_date DESC;

  DROP TEMPORARY TABLE IF EXISTS tmp_audit_results;
  DROP TEMPORARY TABLE IF EXISTS tmp_matching_txns;
END
PROCEDURE	sp_renewal_audit_default		BEGIN
    DECLARE v_start_date DATE;
    DECLARE v_target_expiration DATE;

    SELECT CAST(ConfigValue AS DATE) INTO v_start_date
    FROM config WHERE ConfigKey = 'MembershipCollectionStart';

    SELECT CAST(ConfigValue AS DATE) INTO v_target_expiration
    FROM config WHERE ConfigKey = 'MembershipYearEnd';

    CALL sp_renewal_audit(v_start_date, CURDATE(), v_target_expiration, 'both', TRUE);
END
PROCEDURE	sp_revert_admin_override		proc_body: BEGIN
    DECLARE v_Done              TINYINT DEFAULT 0;
    DECLARE v_MemberID          VARCHAR(10);
    DECLARE v_PreStatus         VARCHAR(50);
    DECLARE v_PreExpiration     DATE;
    DECLARE v_OverrideTS        DATETIME;
    DECLARE v_ImpactedIDs       TEXT;
    DECLARE v_OriginalTarget    VARCHAR(10);
    DECLARE v_RevertedCount     INT DEFAULT 0;
    DECLARE v_AuditError        TEXT DEFAULT NULL;

    -- FIND_IN_SET: collation-neutral, no derived-column mismatch (V012)
    DECLARE cur CURSOR FOR
        SELECT MemberID FROM members
        WHERE FIND_IN_SET(MemberID, (
            SELECT ImpactedMemberIDs
            FROM admin_member_overrides
            WHERE OverrideID = p_OverrideID
        )) > 0;

    -- Catch audit INSERT failures without aborting the SP.
    -- Members are already updated at this point; we don't want to lose
    -- the SELECT result just because the audit record has a constraint issue.
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN
        GET DIAGNOSTICS CONDITION 1 v_AuditError = MESSAGE_TEXT;
    END;

    -- NOT FOUND handler must be declared after SQLEXCEPTION handler.
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_Done = 1;

    -- Look up override metadata (TargetMemberID reused in audit INSERT for FK, V013)
    SELECT Timestamp, ImpactedMemberIDs, TargetMemberID
    INTO v_OverrideTS, v_ImpactedIDs, v_OriginalTarget
    FROM admin_member_overrides
    WHERE OverrideID = p_OverrideID;

    IF v_OverrideTS IS NULL THEN
        SELECT
            NULL  AS reverted_override_id,
            0     AS members_restored,
            NULL  AS impacted_member_ids,
            NULL  AS original_override_time,
            NULL  AS audit_error;
        LEAVE proc_body;
    END IF;

    -- Idempotency guard: skip if already reverted
    IF EXISTS (
        SELECT 1 FROM admin_member_overrides
        WHERE ActionType = 'REVERT'
          AND OldValue = CONCAT('override_', p_OverrideID)
    ) THEN
        SELECT
            p_OverrideID            AS reverted_override_id,
            0                       AS members_restored,
            v_ImpactedIDs           AS impacted_member_ids,
            v_OverrideTS            AS original_override_time,
            'already_reverted'      AS audit_error;
        LEAVE proc_body;
    END IF;

    -- Allow Expiration updates inside this procedure (V014).
    -- The members_before_update trigger checks @internal_proc = 1.
    SET @internal_proc = 1;

    -- Cursor-based restore: one member at a time
    OPEN cur;

    read_loop: LOOP
        FETCH cur INTO v_MemberID;
        IF v_Done THEN LEAVE read_loop; END IF;

        -- Skip NULL-Status rows written by Sheets sync (V011).
        SELECT Status, Expiration INTO v_PreStatus, v_PreExpiration
        FROM member_log
        WHERE MemberID = v_MemberID
          AND LoggingTime < v_OverrideTS
          AND Status IS NOT NULL
        ORDER BY LoggingTime DESC LIMIT 1;

        IF v_PreStatus IS NOT NULL THEN
            UPDATE members
            SET Status     = v_PreStatus,
                Expiration = v_PreExpiration,
                UpdatedAt  = NOW()
            WHERE MemberID = v_MemberID;

            SET v_RevertedCount = v_RevertedCount + 1;
        END IF;

        -- Reset for next iteration
        SET v_PreStatus = NULL;
        SET v_PreExpiration = NULL;
        SET v_Done = 0;
    END LOOP;

    CLOSE cur;

    -- Restore trigger guard
    SET @internal_proc = NULL;

    -- Audit record: reuse original TargetMemberID so fk_override_member is satisfied (V013).
    -- SQLEXCEPTION handler above captures any failure into v_AuditError without aborting.
    INSERT INTO admin_member_overrides
        (AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType,
         OldValue, NewValue, AdminNotes, Timestamp)
    VALUES
        ('system', v_OriginalTarget, v_ImpactedIDs, 'REVERT',
         CONCAT('override_', p_OverrideID), 'pre_override_snapshot',
         CONCAT('Reverted override #', p_OverrideID), NOW());

    -- Always return a result, even if audit INSERT failed.
    -- audit_error = NULL means success; non-NULL means the audit record was
    -- not written (but members were updated — check and export to Sheets).
    SELECT
        p_OverrideID    AS reverted_override_id,
        v_RevertedCount AS members_restored,
        v_ImpactedIDs   AS impacted_member_ids,
        v_OverrideTS    AS original_override_time,
        v_AuditError    AS audit_error;

END
PROCEDURE	sp_search_members_advanced		BEGIN
    DECLARE v_done INT DEFAULT 0;
    DECLARE v_term VARCHAR(255);
    DECLARE v_where_clause TEXT DEFAULT '1=1';
    DECLARE v_remaining_query VARCHAR(255);
    
    SET v_remaining_query = TRIM(p_search_string);
    WHILE CHAR_LENGTH(v_remaining_query) > 0 AND v_done = 0 DO
        SET v_term = SUBSTRING_INDEX(v_remaining_query, ' ', 1);
        IF LOCATE(' ', v_remaining_query) > 0 THEN
            SET v_remaining_query = TRIM(SUBSTRING(v_remaining_query, LOCATE(' ', v_remaining_query) + 1));
        ELSE
            SET v_remaining_query = '';
            SET v_done = 1;
        END IF;
        SET v_where_clause = CONCAT(v_where_clause, ' AND (',
            'FirstName LIKE ', QUOTE(CONCAT('%', v_term, '%')), 
            ' OR LastName LIKE ', QUOTE(CONCAT('%', v_term, '%')), 
            ' OR Email LIKE ', QUOTE(CONCAT('%', v_term, '%')), 
            ' OR Notes LIKE ', QUOTE(CONCAT('%', v_term, '%')), 
            ' OR NYRRunnerName LIKE ', QUOTE(CONCAT('%', v_term, '%')), 
            ' OR WeChatID LIKE ', QUOTE(CONCAT('%', v_term, '%')), 
            ' OR MemberID LIKE ', QUOTE(CONCAT('%', v_term, '%')), 
            ')');
    END WHILE;
    SET @final_query = CONCAT(
        'SELECT MemberID, FirstName, LastName, Email, Type, Status, Expiration, WeChatID, Notes, NYRRRunnerName ',
        'FROM members ',
        'WHERE ', v_where_clause, ' ',
        'ORDER BY FirstName, LastName ',
        'LIMIT ', p_limit
    );
    PREPARE stmt FROM @final_query;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
END
section
=== 7. TRIGGERS ===
trigger_name	event	table	timing	body
trg_members_insert_validate	INSERT	members	BEFORE	BEGIN
  DECLARE error_context_id VARCHAR(50);
  DECLARE error_msg TEXT;

  SET error_context_id = UUID();

  IF NEW.`Email` IS NOT NULL AND NEW.`Email` NOT LIKE '%@%' THEN
    SET error_msg = CONCAT(
      'Invalid email format: "', NEW.`Email`, '". Must contain @. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `ValidValueExamples`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, 'MEM_INVALID_EMAIL',
      CONCAT('Email format invalid: ', NEW.`Email`),
      'Email validation failed: missing @ symbol',
      'members', 'Email', NEW.`Email`,
      '["john@example.com", "jane.doe@company.org"]',
      'Verify email address format matches standard email pattern (user@domain.com)',
      'WARNING'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NEW.`Status` NOT IN ('active','expired','inactive','pending', 'pending_upgrade', 'lifetime') THEN
    SET error_msg = CONCAT(
      'Invalid Status: "', NEW.`Status`, '". ',
      'Allowed: active, expired, inactive, pending, pending_upgrade, lifetime. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `AllowedRange`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, 'MEM_INVALID_STATUS',
      CONCAT('Invalid member status: ', NEW.`Status`),
      'Status enum constraint violated on members table',
      'members', 'Status', NEW.`Status`,
      'active | expired | inactive | pending | pending_upgrade | lifetime',
      'Status must be one of: active (paying), expired (may renew), inactive (left), pending (awaiting payment), pending_upgrade (upgrading to family), lifetime (lifetime member)',
      'ERROR'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;
END
members_before_update	UPDATE	members	BEFORE	BEGIN
    IF NEW.Expiration <> OLD.Expiration THEN
        IF @internal_proc IS NULL OR @internal_proc <> 1 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Direct update to Expiration column is not allowed. Use the approved Procedure.';
        END IF;
    END IF;
END
trg_members_before_update_lifetime	UPDATE	members	BEFORE	BEGIN
    IF @internal_proc IS NULL AND NEW.Status = 'lifetime' AND OLD.Status <> 'lifetime' THEN
        SET NEW.Expiration = '2126-03-31';
    END IF;
END
trg_members_after_insert	INSERT	members	AFTER	BEGIN
  INSERT INTO member_log (
    LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,
    Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,
    MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, Notes,
    NYRRRunnerName, YearBorn
  )
  VALUES (
    UUID(), NOW(), NEW.MemberID, 'INSERT', NEW.Status, NEW.Created, NEW.Expiration,
    NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District,
    NEW.MembershipFeePaid, NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.Notes,
    NEW.NYRRRunnerName, NEW.YearBorn
  );
END
trg_members_after_update	UPDATE	members	AFTER	BEGIN
  INSERT INTO member_log (
    LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,
    Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,
    MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, Notes,
    NYRRRunnerName, YearBorn
  )
  VALUES (
    UUID(), NOW(), NEW.MemberID, 'UPDATE', NEW.Status, NEW.Created, NEW.Expiration,
    NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District,
    NEW.MembershipFeePaid, NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.Notes,
    NEW.NYRRRunnerName, NEW.YearBorn
  );
END
trg_payments_limit_check_insert	INSERT	payments	BEFORE	BEGIN
    DECLARE v_max DECIMAL(10,2);
    DECLARE v_used DECIMAL(10,2);
    SELECT Amount INTO v_max FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;
    SELECT IFNULL(SUM(Amount), 0) INTO v_used FROM payments WHERE TransactionNumber = NEW.TransactionNumber;
    IF (v_used + NEW.Amount) > v_max THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Split Error: Total payments exceed Gmail Transaction amount.';
    END IF;
END
trg_payments_insert_validate	INSERT	payments	BEFORE	BEGIN
  DECLARE error_context_id VARCHAR(50);
  DECLARE error_msg TEXT;

  SET error_context_id = UUID();

  IF NEW.`Amount` IS NOT NULL AND NEW.`Amount` < 0 THEN
    SET error_msg = CONCAT(
      'Payment amount cannot be negative: ', NEW.`Amount`, '. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `AllowedRange`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, 'PAY_NEGATIVE_AMOUNT',
      'Payment amount is negative',
      CONCAT('Amount validation failed: ', NEW.`Amount`),
      'payments', 'Amount', CAST(NEW.`Amount` AS CHAR),
      '>= 0',
      'Check payment amount calculation. Use absolute value if needed.',
      'WARNING'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NEW.`SubmissionID` IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM `submissions` WHERE `SubmissionID` = NEW.`SubmissionID`) THEN
      SET error_msg = CONCAT(
        'SubmissionID "', NEW.`SubmissionID`, '" does not exist. ',
        'Error: ', error_context_id
      );
      INSERT INTO `error_context` (
        `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
        `TableName`, `ColumnName`, `ConstraintName`, `ProblematicValue`,
        `SuggestedFix`, `Severity`
      ) VALUES (
        error_context_id, 'PAY_FK_INVALID_SUBMISSION',
        CONCAT('Referenced submission not found: ', NEW.`SubmissionID`),
        'Foreign key validation failed on payments.SubmissionID',
        'payments', 'SubmissionID', 'fk_payments_submissions',
        NEW.`SubmissionID`,
        'Verify SubmissionID exists before linking payment. Or leave NULL if payment is standalone.',
        'WARNING'
      );
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
    END IF;
  END IF;
END
trg_payments_auto_fill	INSERT	payments	BEFORE	BEGIN
    IF NEW.TransactionNumber IS NOT NULL THEN
        SELECT TransactionDate, PaymentMethod, Sender, Memo
        INTO @d, @m, @p, @memo
        FROM gmail_transactions
        WHERE TransactionNumber = NEW.TransactionNumber
        LIMIT 1;
        SET NEW.PaymentDate = @d;
        SET NEW.PaymentMethod = @m;
        SET NEW.PayerName = @p;
        SET NEW.MemoField = @memo;
    END IF;
END
trg_payments_limit_check_update	UPDATE	payments	BEFORE	BEGIN
    DECLARE v_max_total DECIMAL(10,2);
DECLARE v_used_others DECIMAL(10,2);
DECLARE v_rem DECIMAL(10,2);
DECLARE v_msg VARCHAR(128);
SELECT Amount INTO v_max_total 
    FROM gmail_transactions 
    WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;
SELECT IFNULL(SUM(Amount), 0) INTO v_used_others 
    FROM payments 
    WHERE TransactionNumber = NEW.TransactionNumber AND PaymentID <> OLD.PaymentID;
SET v_rem = v_max_total - v_used_others;
IF NEW.Amount > v_rem THEN
        SET v_msg = CONCAT('Limit Exceeded: Try $', NEW.Amount, ', but only $', v_rem, ' left on TX: ', LEFT(NEW.TransactionNumber, 20));
SIGNAL SQLSTATE '45000' 
        SET MESSAGE_TEXT = v_msg;
END IF;
END
trg_payments_approve_submission	INSERT	payments	AFTER	BEGIN
    IF NEW.SubmissionID IS NOT NULL THEN
        UPDATE submissions
        SET
            Status = 'approved',
            PaymentID = NEW.PaymentID,
            UpdatedByID = NEW.ProcessedBy
        WHERE SubmissionID = NEW.SubmissionID;
    END IF;
END
trg_payments_sync_to_gmail_on_change_after_payment_insert	INSERT	payments	AFTER	BEGIN
    DECLARE v_new_notes TEXT;
    DECLARE v_old_notes TEXT;
    DECLARE v_latest_update DATETIME;
    SELECT 
        GROUP_CONCAT(CONCAT('(', MemberID, ', ', IFNULL(PaymentType, 'N/A'), ', ', Amount, ')') SEPARATOR '; '),
        MAX(UpdatedAt)
    INTO v_new_notes, v_latest_update
    FROM payments
    WHERE TransactionNumber = NEW.TransactionNumber;
    SELECT Notes INTO v_old_notes 
    FROM gmail_transactions 
    WHERE TransactionNumber = NEW.TransactionNumber;
    IF v_old_notes IS NULL OR v_new_notes <> v_old_notes THEN
        UPDATE gmail_transactions
        SET 
            Notes = v_new_notes,
            UpdatedAt = v_latest_update
        WHERE TransactionNumber = NEW.TransactionNumber;
    END IF;
END
trg_payments_sync_membership_only	INSERT	payments	AFTER	BEGIN
    -- Declare local variables at the very top
    DECLARE v_target_expiration DATE;
    DECLARE v_calc_expiration DATE;
    DECLARE v_family_id VARCHAR(50);

    -- 1. Only proceed if this is a membership-related payment
    -- Note: Used LOWER() to ensure case-insensitive matching
    IF LOWER(NEW.PaymentType) LIKE '%membership%' THEN
        
        -- 2. Fetch config and Member's FamilyID
        SELECT CAST(ConfigValue AS DATE) INTO v_target_expiration 
        FROM config 
        WHERE ConfigKey = 'MembershipYearEnd' 
        LIMIT 1;

        SELECT FamilyID INTO v_family_id 
        FROM members 
        WHERE MemberID = NEW.MemberID 
        LIMIT 1;

        -- 3. Calculate fallback expiration (the NEW_EXP logic)
        SET v_calc_expiration = CASE 
            WHEN MONTH(NEW.PaymentDate) >= 10 
                THEN DATE(CONCAT(YEAR(NEW.PaymentDate) + 2, '-03-31'))
            ELSE DATE(CONCAT(YEAR(NEW.PaymentDate) + 1, '-03-31'))
        END;

        -- 4. LOCK: Prevent recursive trigger firing
        SET @internal_proc = 1;

        -- 5. UPDATE MEMBERS (Self + Family)
        -- Handles your logic: Check both NULL and empty string for FamilyID
        UPDATE members
        SET 
            Status = 'active',
            MembershipFeePaid = NEW.Amount,
            PaymentDate = NEW.PaymentDate,
            PaymentTransaction = NEW.TransactionNumber,
            Expiration = IFNULL(v_target_expiration, v_calc_expiration),
            UpdatedAt = NOW()
        WHERE 
            MemberID = NEW.MemberID 
            OR (
                v_family_id IS NOT NULL 
                AND v_family_id <> '' 
                AND FamilyID = v_family_id
            );

        -- 6. UNLOCK
        SET @internal_proc = NULL;
        
    END IF;
END
trg_payments_sync_to_gmail_on_change	UPDATE	payments	AFTER	BEGIN
    DECLARE v_new_notes TEXT;
    DECLARE v_old_notes TEXT;
    DECLARE v_latest_update DATETIME;
    SELECT 
        GROUP_CONCAT(CONCAT('(', MemberID, ', ', IFNULL(PaymentType, 'N/A'), ', ', Amount, ')') SEPARATOR '; '),
        MAX(UpdatedAt)
    INTO v_new_notes, v_latest_update
    FROM payments
    WHERE TransactionNumber = NEW.TransactionNumber;
    SELECT Notes INTO v_old_notes 
    FROM gmail_transactions 
    WHERE TransactionNumber = NEW.TransactionNumber;
    IF v_old_notes IS NULL OR v_new_notes <> v_old_notes THEN
        UPDATE gmail_transactions
        SET 
            Notes = v_new_notes,
            UpdatedAt = v_latest_update
        WHERE TransactionNumber = NEW.TransactionNumber;
    END IF;
END
trg_payments_update_approve_submission	UPDATE	payments	AFTER	BEGIN
    
    IF (NEW.SubmissionID IS NOT NULL AND NEW.SubmissionID != '')
       AND (OLD.SubmissionID IS NULL OR OLD.SubmissionID = '')
    THEN
        UPDATE submissions
        SET
            Status      = 'approved',
            PaymentID   = NEW.PaymentID,
            UpdatedByID = NEW.ProcessedBy
        WHERE SubmissionID = NEW.SubmissionID
          AND Status = 'pending';
    END IF;
END
trg_submissions_insert_validate	INSERT	submissions	BEFORE	BEGIN
  DECLARE error_context_id VARCHAR(50);
  DECLARE error_msg TEXT;
  DECLARE error_code VARCHAR(50);

  SET error_context_id = UUID();

  IF NEW.`SubmissionID` IS NULL THEN
    SET error_code = 'SUBM_NULL_ID';
    SET error_msg = CONCAT(
      'Submission ID cannot be NULL. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `ValidValueExamples`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      'Cannot create submission without unique ID',
      'SubmissionID column received NULL value on INSERT',
      'submissions', 'SubmissionID', 'NULL',
      '["sub_abc123xyz", "sub_2026_001"]',
      'Ensure UUID is generated before INSERT. Check application code.',
      'CRITICAL'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM `members` WHERE `MemberID` = NEW.`MemberID`) THEN
    SET error_code = 'SUBM_FK_INVALID_MEMBER';
    SET error_msg = CONCAT(
      'MemberID "', NEW.`MemberID`, '" does not exist in members table. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ConstraintName`, `ProblematicValue`,
      `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      CONCAT('Invalid MemberID: ', NEW.`MemberID`),
      'Foreign key validation failed: referenced member does not exist',
      'submissions', 'MemberID', 'fk_submissions_members',
      NEW.`MemberID`,
      'Verify MemberID exists in members table before creating submission',
      'ERROR'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NEW.`Status` NOT IN ('pending','approved','cancelled','expired') THEN
    SET error_code = 'SUBM_INVALID_STATUS';
    SET error_msg = CONCAT(
      'Invalid Status value: "', NEW.`Status`, '". ',
      'Allowed: pending, approved, cancelled, expired. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `AllowedRange`, `ValidValueExamples`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      CONCAT('Invalid submission status: ', NEW.`Status`),
      'Status enum constraint violated',
      'submissions', 'Status', NEW.`Status`,
      'pending | approved | cancelled | expired',
      '["pending", "approved"]',
      'Use one of the allowed status values. Default is "pending".',
      'ERROR'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NEW.`Amount` IS NOT NULL AND NEW.`Amount` < 0 THEN
    SET error_code = 'SUBM_NEGATIVE_AMOUNT';
    SET error_msg = CONCAT(
      'Amount cannot be negative: ', NEW.`Amount`, '. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `AllowedRange`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      'Submission amount is negative',
      'Amount validation failed: received negative value',
      'submissions', 'Amount', CAST(NEW.`Amount` AS CHAR),
      '>= 0',
      'Ensure amount is positive. Use absolute value or check calculation logic.',
      'WARNING'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;
END
