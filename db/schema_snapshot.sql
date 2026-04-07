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
admin_member_overrides	5	ActionType	enum('STATUS_CHANGE','EXPIRATION_OVERRIDE','LIFETIME_SET','INACTIVE_SET')	NO	NULL			
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
PROCEDURE	generate_member_id		BEGIN\n    DECLARE max_num INT DEFAULT 0;\n    START TRANSACTION;\n        SELECT COALESCE(MAX(CAST(SUBSTRING(MemberID, 2) AS UNSIGNED)), 0) INTO max_num FROM members FOR UPDATE;\n        SET new_id = CONCAT('A', LPAD(max_num + 1, 4, '0'));\n    COMMIT;\nEND
PROCEDURE	sp_admin_update_member_status		BEGIN\n    DECLARE v_FamilyID VARCHAR(10);\n    DECLARE v_OldStatus VARCHAR(20);\n    DECLARE v_ImpactedIDs TEXT;\n    DECLARE v_CalculatedAction VARCHAR(50);\n\n    SELECT Status, FamilyID INTO v_OldStatus, v_FamilyID FROM members WHERE MemberID = p_MemberID;\n\n    SET v_CalculatedAction = CASE\n        WHEN p_NewStatus = 'lifetime' THEN 'LIFETIME_SET'\n        WHEN v_OldStatus = 'expired' AND p_NewStatus = 'inactive' THEN 'INACTIVE_SET'\n        WHEN p_NewExpiration IS NOT NULL THEN 'EXPIRATION_OVERRIDE'\n        ELSE 'STATUS_CHANGE'\n    END;\n\n    IF v_FamilyID IS NOT NULL THEN\n        SELECT GROUP_CONCAT(MemberID) INTO v_ImpactedIDs FROM members WHERE FamilyID = v_FamilyID;\n    ELSE\n        SET v_ImpactedIDs = p_MemberID;\n    END IF;\n\n    SET @internal_proc = 1;\n\n    UPDATE members\n    SET\n        Status = IFNULL(p_NewStatus, Status),\n        Expiration = IFNULL(p_NewExpiration, Expiration),\n        Notes = CONCAT(IFNULL(Notes, ''), '\n--- Admin Override (', p_AdminEmail, ' ', NOW(), ') ---\n', p_NewNotes)\n    WHERE (v_FamilyID IS NOT NULL AND FamilyID = v_FamilyID) OR MemberID = p_MemberID;\n\n    SET @internal_proc = NULL;\n\n    INSERT INTO admin_member_overrides (\n        AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType, OldValue, NewValue, AdminNotes\n    )\n    VALUES (\n        p_AdminEmail, p_MemberID, v_ImpactedIDs, v_CalculatedAction, v_OldStatus, IFNULL(p_NewStatus, v_OldStatus), p_NewNotes\n    );\nEND
PROCEDURE	sp_error_summary_report		BEGIN\n  \n  SELECT\n    `ErrorCode`,\n    `TableName`,\n    `ColumnName`,\n    `Severity`,\n    `Status`,\n    COUNT(*) as occurrence_count,\n    MIN(`FirstOccurrence`) as first_seen,\n    MAX(`LastOccurrence`) as last_seen,\n    GROUP_CONCAT(DISTINCT `OffendingRowID` SEPARATOR ', ') as sample_row_ids,\n    MAX(`SuggestedFix`) as recommended_fix\n  FROM `error_context`\n  WHERE `DetectedAt` >= NOW() - INTERVAL days_back DAY\n  GROUP BY `ErrorCode`, `Severity`, `Status`\n  ORDER BY occurrence_count DESC, `Severity` DESC;\nEND
PROCEDURE	sp_link_transaction		BEGIN\n    -- 1. Validation: Ensure the transaction exists in Gmail records\n    IF NOT EXISTS (SELECT 1 FROM gmail_transactions WHERE TransactionNumber = p_transaction_number) THEN\n        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Error: TransactionNumber not found in gmail_transactions.';\n    END IF;\n\n    -- 2. Validation: Ensure the member exists\n    IF NOT EXISTS (SELECT 1 FROM members WHERE MemberID = p_member_id) THEN\n        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Error: MemberID not found.';\n    END IF;\n\n    -- 3. Create the payment record.\n    -- This single insert will trigger:\n    --   - trg_payments_auto_fill: Pulls Date/Sender/Memo from Gmail\n    --   - trg_payments_sync_membership_only: Updates member status/expiration/fee\n    --   - trg_payments_approve_submission: Marks web form as 'approved'\n    --   - trg_payments_sync_to_gmail_on_change: Updates the Notes on the Gmail record\n    INSERT INTO `payments` (\n        `PaymentID`,\n        `MemberID`,\n        `TransactionNumber`,\n        `PaymentType`,\n        `Amount`,\n        `SubmissionID`,\n        `UpdatedAt`\n    ) VALUES (\n        REPLACE(UUID(), '-', ''), -- Generate a clean ID\n        p_member_id,\n        p_transaction_number,\n        p_payment_type,\n        p_amount,\n        p_submission_id,\n        NOW()\n    );\n\nEND
PROCEDURE	sp_reconcile_member_payments		BEGIN\n    DECLARE v_start_date DATE;\n    DECLARE v_target_expiration DATE;\n\n    -- Fetch config\n    SELECT CAST(ConfigValue AS DATE) INTO v_start_date FROM config WHERE ConfigKey = 'MembershipCollectionStart';\n    SELECT CAST(ConfigValue AS DATE) INTO v_target_expiration FROM config WHERE ConfigKey = 'MembershipYearEnd';\n\n    DROP TEMPORARY TABLE IF EXISTS tmp_to_update;\n    CREATE TEMPORARY TABLE tmp_to_update AS\n    SELECT DISTINCT\n        m.MemberID,\n        m.FamilyID,\n        p.TransactionNumber AS actual_tx,\n        p.PaymentDate AS actual_date,\n        p.Amount AS actual_amount\n    FROM members m\n    INNER JOIN payments p ON m.MemberID = p.MemberID\n    WHERE LOWER(p.PaymentType) LIKE '%membership%'\n      AND p.PaymentDate >= v_start_date\n      AND m.Status <> 'lifetime'\n      AND (m.Expiration <> v_target_expiration OR m.PaymentTransaction <> p.TransactionNumber);\n\n    IF p_dry_run THEN\n        SELECT 'DRY RUN' as Status, t.* FROM tmp_to_update t;\n    ELSE\n        -- THE FIX: Start a formal transaction\n        START TRANSACTION;\n        \n        SET @internal_proc = 1;\n\n        -- Step A: Update Primary Payers\n        UPDATE members m\n        INNER JOIN tmp_to_update t ON m.MemberID = t.MemberID\n        SET \n            m.Status = 'active',\n            m.Expiration = v_target_expiration,\n            m.PaymentTransaction = t.actual_tx,\n            m.PaymentDate = t.actual_date,\n            m.MembershipFeePaid = t.actual_amount,\n            m.UpdatedAt = NOW();\n\n        -- Step B: Update Family (using a subquery to avoid join-locking)\n        UPDATE members \n        SET \n            Status = 'active',\n            Expiration = v_target_expiration,\n            UpdatedAt = NOW()\n        WHERE FamilyID IN (SELECT DISTINCT FamilyID FROM tmp_to_update WHERE FamilyID <> '' AND FamilyID IS NOT NULL);\n\n        COMMIT;\n        SET @internal_proc = NULL;\n        \n        SELECT 'SUCCESS' as Status, t.* FROM tmp_to_update t;\n    END IF;\nEND
PROCEDURE	sp_renewal_audit		BEGIN\n  \n  DROP TEMPORARY TABLE IF EXISTS tmp_audit_results;\n  DROP TEMPORARY TABLE IF EXISTS tmp_matching_txns;\n\n  \n  CREATE TEMPORARY TABLE tmp_audit_results (\n    message_id VARCHAR(100),\n    amount DECIMAL(10,2),\n    transaction_date DATE,\n    sender VARCHAR(255),\n    memo TEXT,\n    member_id VARCHAR(10),\n    member_name VARCHAR(255),\n    current_expiration DATE,\n    target_expiration DATE,\n    status_match VARCHAR(20),\n    trace_route VARCHAR(100),\n    family_members_checked INT DEFAULT NULL,\n    family_all_match CHAR(1) DEFAULT NULL\n  );\n\n  \n  CREATE TEMPORARY TABLE tmp_matching_txns (\n    message_id VARCHAR(100),\n    amount DECIMAL(10,2),\n    transaction_date DATE,\n    transaction_number VARCHAR(100),\n    sender VARCHAR(255),\n    memo TEXT,\n    original_memo TEXT,\n    traced BOOLEAN DEFAULT FALSE,\n    member_id VARCHAR(10)\n  );\n\n  \n  INSERT INTO tmp_matching_txns (message_id, amount, transaction_date, transaction_number, sender, memo, original_memo)\n  SELECT MessageId, Amount, TransactionDate, TransactionNumber, Sender, Memo, OriginalMemo\n  FROM gmail_transactions\n  WHERE TransactionDate BETWEEN p_start_date AND p_end_date\n    AND Amount IN (30.00, 50.00);\n\n  \n  UPDATE tmp_matching_txns txn\n  INNER JOIN members m ON txn.transaction_number = m.PaymentTransaction\n  SET txn.member_id = m.MemberID, txn.traced = TRUE;\n\n  \n  UPDATE tmp_matching_txns txn\n  INNER JOIN payments p ON txn.transaction_number = p.TransactionNumber\n  INNER JOIN members m ON p.MemberID = m.MemberID\n  SET txn.member_id = m.MemberID, txn.traced = TRUE\n  WHERE txn.traced = FALSE;\n\n  \n  INSERT INTO tmp_audit_results (\n    message_id, amount, transaction_date, sender, memo,\n    member_id, member_name, current_expiration, target_expiration,\n    status_match, trace_route\n  )\n  SELECT\n    txn.message_id, txn.amount, txn.transaction_date, txn.sender,\n    COALESCE(txn.memo, txn.original_memo, ''),\n    txn.member_id, CONCAT(m.FirstName, ' ', m.LastName),\n    m.Expiration, p_target_expiration,\n    CASE\n      WHEN m.Expiration IS NULL THEN 'ERROR'\n      WHEN m.Expiration >= p_target_expiration THEN 'MATCH'\n      ELSE 'MISMATCH'\n    END,\n    CASE\n      WHEN m.PaymentTransaction = txn.transaction_number THEN 'members.PaymentTransaction'\n      WHEN txn.traced THEN 'payments.TransactionNumber'\n      ELSE 'UNKNOWN'\n    END\n  FROM tmp_matching_txns txn\n  INNER JOIN members m ON txn.member_id = m.MemberID\n  WHERE (p_membership_type = 'both')\n     OR (p_membership_type = 'individual' AND LOWER(m.Type) = 'individual')\n     OR (p_membership_type = 'family' AND LOWER(m.Type) = 'family');\n\n  \n  INSERT INTO tmp_audit_results (message_id, amount, transaction_date, sender, memo, status_match, trace_route)\n  SELECT message_id, amount, transaction_date, sender, COALESCE(memo, original_memo, ''), 'NOT TRACED', 'NOT FOUND'\n  FROM tmp_matching_txns WHERE member_id IS NULL;\n\n  \n  UPDATE tmp_audit_results audit\n  INNER JOIN members m ON audit.member_id = m.MemberID\n  SET\n    audit.family_members_checked = (SELECT COUNT(*) FROM members m2 WHERE m2.FamilyID = m.FamilyID),\n    audit.family_all_match = (\n        SELECT IF(MIN(m3.Expiration >= p_target_expiration) = 1, 'Y', 'N')\n        FROM members m3 WHERE m3.FamilyID = m.FamilyID\n    )\n  WHERE m.FamilyID IS NOT NULL;\n\n  \n  SELECT * FROM tmp_audit_results \n  WHERE (p_only_mismatches IS FALSE OR status_match <> 'MATCH')\n  ORDER BY \n    FIELD(status_match, 'MISMATCH', 'NOT TRACED', 'MATCH', 'ERROR'),\n    transaction_date DESC;\n\n  DROP TEMPORARY TABLE IF EXISTS tmp_audit_results;\n  DROP TEMPORARY TABLE IF EXISTS tmp_matching_txns;\nEND
PROCEDURE	sp_renewal_audit_default		BEGIN\n    CALL sp_renewal_audit('2025-10-01', CURDATE(), '2027-03-31', 'both', TRUE);\nEND
PROCEDURE	sp_search_members_advanced		BEGIN\n    DECLARE v_done INT DEFAULT 0;\n    DECLARE v_term VARCHAR(255);\n    DECLARE v_where_clause TEXT DEFAULT '1=1';\n    DECLARE v_remaining_query VARCHAR(255);\n    \n    SET v_remaining_query = TRIM(p_search_string);\n    WHILE CHAR_LENGTH(v_remaining_query) > 0 AND v_done = 0 DO\n        SET v_term = SUBSTRING_INDEX(v_remaining_query, ' ', 1);\n        IF LOCATE(' ', v_remaining_query) > 0 THEN\n            SET v_remaining_query = TRIM(SUBSTRING(v_remaining_query, LOCATE(' ', v_remaining_query) + 1));\n        ELSE\n            SET v_remaining_query = '';\n            SET v_done = 1;\n        END IF;\n        SET v_where_clause = CONCAT(v_where_clause, ' AND (',\n            'FirstName LIKE ', QUOTE(CONCAT('%', v_term, '%')), \n            ' OR LastName LIKE ', QUOTE(CONCAT('%', v_term, '%')), \n            ' OR Email LIKE ', QUOTE(CONCAT('%', v_term, '%')), \n            ' OR Notes LIKE ', QUOTE(CONCAT('%', v_term, '%')), \n            ' OR NYRRunnerName LIKE ', QUOTE(CONCAT('%', v_term, '%')), \n            ' OR WeChatID LIKE ', QUOTE(CONCAT('%', v_term, '%')), \n            ' OR MemberID LIKE ', QUOTE(CONCAT('%', v_term, '%')), \n            ')');\n    END WHILE;\n    SET @final_query = CONCAT(\n        'SELECT MemberID, FirstName, LastName, Email, Type, Status, Expiration, WeChatID, Notes, NYRRRunnerName ',\n        'FROM members ',\n        'WHERE ', v_where_clause, ' ',\n        'ORDER BY FirstName, LastName ',\n        'LIMIT ', p_limit\n    );\n    PREPARE stmt FROM @final_query;\n    EXECUTE stmt;\n    DEALLOCATE PREPARE stmt;\nEND
section
=== 7. TRIGGERS ===
trigger_name	event	table	timing	body
trg_members_insert_validate	INSERT	members	BEFORE	BEGIN\n  DECLARE error_context_id VARCHAR(50);\n  DECLARE error_msg TEXT;\n\n  SET error_context_id = UUID();\n\n  IF NEW.`Email` IS NOT NULL AND NEW.`Email` NOT LIKE '%@%' THEN\n    SET error_msg = CONCAT(\n      'Invalid email format: "', NEW.`Email`, '". Must contain @. ',\n      'Error: ', error_context_id\n    );\n    INSERT INTO `error_context` (\n      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,\n      `TableName`, `ColumnName`, `ProblematicValue`,\n      `ValidValueExamples`, `SuggestedFix`, `Severity`\n    ) VALUES (\n      error_context_id, 'MEM_INVALID_EMAIL',\n      CONCAT('Email format invalid: ', NEW.`Email`),\n      'Email validation failed: missing @ symbol',\n      'members', 'Email', NEW.`Email`,\n      '["john@example.com", "jane.doe@company.org"]',\n      'Verify email address format matches standard email pattern (user@domain.com)',\n      'WARNING'\n    );\n    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;\n  END IF;\n\n  IF NEW.`Status` NOT IN ('active','expired','inactive','pending', 'pending_upgrade', 'lifetime') THEN\n    SET error_msg = CONCAT(\n      'Invalid Status: "', NEW.`Status`, '". ',\n      'Allowed: active, expired, inactive, pending, pending_upgrade, lifetime. ',\n      'Error: ', error_context_id\n    );\n    INSERT INTO `error_context` (\n      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,\n      `TableName`, `ColumnName`, `ProblematicValue`,\n      `AllowedRange`, `SuggestedFix`, `Severity`\n    ) VALUES (\n      error_context_id, 'MEM_INVALID_STATUS',\n      CONCAT('Invalid member status: ', NEW.`Status`),\n      'Status enum constraint violated on members table',\n      'members', 'Status', NEW.`Status`,\n      'active | expired | inactive | pending | pending_upgrade | lifetime',\n      'Status must be one of: active (paying), expired (may renew), inactive (left), pending (awaiting payment), pending_upgrade (upgrading to family), lifetime (lifetime member)',\n      'ERROR'\n    );\n    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;\n  END IF;\nEND
members_before_update	UPDATE	members	BEFORE	BEGIN\n    IF NEW.Expiration <> OLD.Expiration THEN\n        IF @internal_proc IS NULL OR @internal_proc <> 1 THEN\n            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Direct update to Expiration column is not allowed. Use the approved Procedure.';\n        END IF;\n    END IF;\nEND
trg_members_after_insert	INSERT	members	AFTER	BEGIN\n  INSERT INTO member_log (\n    LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,\n    Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,\n    MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, Notes,\n    NYRRRunnerName, YearBorn\n  )\n  VALUES (\n    UUID(), NOW(), NEW.MemberID, 'INSERT', NEW.Status, NEW.Created, NEW.Expiration,\n    NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District,\n    NEW.MembershipFeePaid, NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.Notes,\n    NEW.NYRRRunnerName, NEW.YearBorn\n  );\nEND
trg_members_family_inheritance	INSERT	members	AFTER	BEGIN\n  IF NEW.FamilyID IS NOT NULL THEN\n    UPDATE members\n    SET \n      Expiration = (\n        SELECT Expiration FROM members \n        WHERE FamilyID = NEW.FamilyID AND Status IN ('active','lifetime') \n        LIMIT 1\n      ),\n      MembershipFeePaid = (\n        SELECT MembershipFeePaid FROM members \n        WHERE FamilyID = NEW.FamilyID AND Status IN ('active','lifetime')\n        LIMIT 1\n      ),\n      PaymentDate = (\n        SELECT PaymentDate FROM members \n        WHERE FamilyID = NEW.FamilyID AND Status IN ('active','lifetime')\n        LIMIT 1\n      ),\n      PaymentTransaction = (\n        SELECT PaymentTransaction FROM members \n        WHERE FamilyID = NEW.FamilyID AND Status IN ('active','lifetime')\n        LIMIT 1\n      )\n    WHERE MemberID = NEW.MemberID \n      AND FamilyID = NEW.FamilyID\n      AND Status IN ('pending', 'pending_ungrade', 'expired', 'inactive');\n  END IF;\nEND
trg_members_after_update	UPDATE	members	AFTER	BEGIN\n  INSERT INTO member_log (\n    LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,\n    Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,\n    MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, Notes,\n    NYRRRunnerName, YearBorn\n  )\n  VALUES (\n    UUID(), NOW(), NEW.MemberID, 'UPDATE', NEW.Status, NEW.Created, NEW.Expiration,\n    NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District,\n    NEW.MembershipFeePaid, NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.Notes,\n    NEW.NYRRRunnerName, NEW.YearBorn\n  );\nEND
trg_payments_limit_check_insert	INSERT	payments	BEFORE	BEGIN\n    DECLARE v_max DECIMAL(10,2);\n    DECLARE v_used DECIMAL(10,2);\n    SELECT Amount INTO v_max FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;\n    SELECT IFNULL(SUM(Amount), 0) INTO v_used FROM payments WHERE TransactionNumber = NEW.TransactionNumber;\n    IF (v_used + NEW.Amount) > v_max THEN\n        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Split Error: Total payments exceed Gmail Transaction amount.';\n    END IF;\nEND
trg_payments_insert_validate	INSERT	payments	BEFORE	BEGIN\n  DECLARE error_context_id VARCHAR(50);\n  DECLARE error_msg TEXT;\n\n  SET error_context_id = UUID();\n\n  IF NEW.`Amount` IS NOT NULL AND NEW.`Amount` < 0 THEN\n    SET error_msg = CONCAT(\n      'Payment amount cannot be negative: ', NEW.`Amount`, '. ',\n      'Error: ', error_context_id\n    );\n    INSERT INTO `error_context` (\n      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,\n      `TableName`, `ColumnName`, `ProblematicValue`,\n      `AllowedRange`, `SuggestedFix`, `Severity`\n    ) VALUES (\n      error_context_id, 'PAY_NEGATIVE_AMOUNT',\n      'Payment amount is negative',\n      CONCAT('Amount validation failed: ', NEW.`Amount`),\n      'payments', 'Amount', CAST(NEW.`Amount` AS CHAR),\n      '>= 0',\n      'Check payment amount calculation. Use absolute value if needed.',\n      'WARNING'\n    );\n    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;\n  END IF;\n\n  IF NEW.`SubmissionID` IS NOT NULL THEN\n    IF NOT EXISTS (SELECT 1 FROM `submissions` WHERE `SubmissionID` = NEW.`SubmissionID`) THEN\n      SET error_msg = CONCAT(\n        'SubmissionID "', NEW.`SubmissionID`, '" does not exist. ',\n        'Error: ', error_context_id\n      );\n      INSERT INTO `error_context` (\n        `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,\n        `TableName`, `ColumnName`, `ConstraintName`, `ProblematicValue`,\n        `SuggestedFix`, `Severity`\n      ) VALUES (\n        error_context_id, 'PAY_FK_INVALID_SUBMISSION',\n        CONCAT('Referenced submission not found: ', NEW.`SubmissionID`),\n        'Foreign key validation failed on payments.SubmissionID',\n        'payments', 'SubmissionID', 'fk_payments_submissions',\n        NEW.`SubmissionID`,\n        'Verify SubmissionID exists before linking payment. Or leave NULL if payment is standalone.',\n        'WARNING'\n      );\n      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;\n    END IF;\n  END IF;\nEND
trg_payments_auto_fill	INSERT	payments	BEFORE	BEGIN\n    IF NEW.TransactionNumber IS NOT NULL THEN\n        SELECT TransactionDate, PaymentMethod, Sender, Memo\n        INTO @d, @m, @p, @memo\n        FROM gmail_transactions\n        WHERE TransactionNumber = NEW.TransactionNumber\n        LIMIT 1;\n        SET NEW.PaymentDate = @d;\n        SET NEW.PaymentMethod = @m;\n        SET NEW.PayerName = @p;\n        SET NEW.MemoField = @memo;\n    END IF;\nEND
trg_payments_limit_check_update	UPDATE	payments	BEFORE	BEGIN\n    DECLARE v_max_total DECIMAL(10,2);\nDECLARE v_used_others DECIMAL(10,2);\nDECLARE v_rem DECIMAL(10,2);\nDECLARE v_msg VARCHAR(128);\nSELECT Amount INTO v_max_total \n    FROM gmail_transactions \n    WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;\nSELECT IFNULL(SUM(Amount), 0) INTO v_used_others \n    FROM payments \n    WHERE TransactionNumber = NEW.TransactionNumber AND PaymentID <> OLD.PaymentID;\nSET v_rem = v_max_total - v_used_others;\nIF NEW.Amount > v_rem THEN\n        SET v_msg = CONCAT('Limit Exceeded: Try $', NEW.Amount, ', but only $', v_rem, ' left on TX: ', LEFT(NEW.TransactionNumber, 20));\nSIGNAL SQLSTATE '45000' \n        SET MESSAGE_TEXT = v_msg;\nEND IF;\nEND
trg_payments_approve_submission	INSERT	payments	AFTER	BEGIN\n    IF NEW.SubmissionID IS NOT NULL THEN\n        UPDATE submissions\n        SET\n            Status = 'approved',\n            PaymentID = NEW.PaymentID,\n            UpdatedByID = NEW.ProcessedBy\n        WHERE SubmissionID = NEW.SubmissionID;\n    END IF;\nEND
trg_payments_sync_to_gmail_on_change_after_payment_insert	INSERT	payments	AFTER	BEGIN\n    DECLARE v_new_notes TEXT;\n    DECLARE v_old_notes TEXT;\n    DECLARE v_latest_update DATETIME;\n    SELECT \n        GROUP_CONCAT(CONCAT('(', MemberID, ', ', IFNULL(PaymentType, 'N/A'), ', ', Amount, ')') SEPARATOR '; '),\n        MAX(UpdatedAt)\n    INTO v_new_notes, v_latest_update\n    FROM payments\n    WHERE TransactionNumber = NEW.TransactionNumber;\n    SELECT Notes INTO v_old_notes \n    FROM gmail_transactions \n    WHERE TransactionNumber = NEW.TransactionNumber;\n    IF v_old_notes IS NULL OR v_new_notes <> v_old_notes THEN\n        UPDATE gmail_transactions\n        SET \n            Notes = v_new_notes,\n            UpdatedAt = v_latest_update\n        WHERE TransactionNumber = NEW.TransactionNumber;\n    END IF;\nEND
trg_payments_sync_membership_only	INSERT	payments	AFTER	BEGIN\n    -- Declare local variables at the very top\n    DECLARE v_target_expiration DATE;\n    DECLARE v_calc_expiration DATE;\n    DECLARE v_family_id VARCHAR(50);\n\n    -- 1. Only proceed if this is a membership-related payment\n    -- Note: Used LOWER() to ensure case-insensitive matching\n    IF LOWER(NEW.PaymentType) LIKE '%membership%' THEN\n        \n        -- 2. Fetch config and Member's FamilyID\n        SELECT CAST(ConfigValue AS DATE) INTO v_target_expiration \n        FROM config \n        WHERE ConfigKey = 'MembershipYearEnd' \n        LIMIT 1;\n\n        SELECT FamilyID INTO v_family_id \n        FROM members \n        WHERE MemberID = NEW.MemberID \n        LIMIT 1;\n\n        -- 3. Calculate fallback expiration (the NEW_EXP logic)\n        SET v_calc_expiration = CASE \n            WHEN MONTH(NEW.PaymentDate) >= 10 \n                THEN DATE(CONCAT(YEAR(NEW.PaymentDate) + 2, '-03-31'))\n            ELSE DATE(CONCAT(YEAR(NEW.PaymentDate) + 1, '-03-31'))\n        END;\n\n        -- 4. LOCK: Prevent recursive trigger firing\n        SET @internal_proc = 1;\n\n        -- 5. UPDATE MEMBERS (Self + Family)\n        -- Handles your logic: Check both NULL and empty string for FamilyID\n        UPDATE members\n        SET \n            Status = 'active',\n            MembershipFeePaid = NEW.Amount,\n            PaymentDate = NEW.PaymentDate,\n            PaymentTransaction = NEW.TransactionNumber,\n            Expiration = IFNULL(v_target_expiration, v_calc_expiration),\n            UpdatedAt = NOW()\n        WHERE \n            MemberID = NEW.MemberID \n            OR (\n                v_family_id IS NOT NULL \n                AND v_family_id <> '' \n                AND FamilyID = v_family_id\n            );\n\n        -- 6. UNLOCK\n        SET @internal_proc = NULL;\n        \n    END IF;\nEND
trg_payments_sync_to_gmail_on_change	UPDATE	payments	AFTER	BEGIN\n    DECLARE v_new_notes TEXT;\n    DECLARE v_old_notes TEXT;\n    DECLARE v_latest_update DATETIME;\n    SELECT \n        GROUP_CONCAT(CONCAT('(', MemberID, ', ', IFNULL(PaymentType, 'N/A'), ', ', Amount, ')') SEPARATOR '; '),\n        MAX(UpdatedAt)\n    INTO v_new_notes, v_latest_update\n    FROM payments\n    WHERE TransactionNumber = NEW.TransactionNumber;\n    SELECT Notes INTO v_old_notes \n    FROM gmail_transactions \n    WHERE TransactionNumber = NEW.TransactionNumber;\n    IF v_old_notes IS NULL OR v_new_notes <> v_old_notes THEN\n        UPDATE gmail_transactions\n        SET \n            Notes = v_new_notes,\n            UpdatedAt = v_latest_update\n        WHERE TransactionNumber = NEW.TransactionNumber;\n    END IF;\nEND
trg_submissions_insert_validate	INSERT	submissions	BEFORE	BEGIN\n  DECLARE error_context_id VARCHAR(50);\n  DECLARE error_msg TEXT;\n  DECLARE error_code VARCHAR(50);\n\n  SET error_context_id = UUID();\n\n  IF NEW.`SubmissionID` IS NULL THEN\n    SET error_code = 'SUBM_NULL_ID';\n    SET error_msg = CONCAT(\n      'Submission ID cannot be NULL. ',\n      'Error: ', error_context_id\n    );\n    INSERT INTO `error_context` (\n      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,\n      `TableName`, `ColumnName`, `ProblematicValue`,\n      `ValidValueExamples`, `SuggestedFix`, `Severity`\n    ) VALUES (\n      error_context_id, error_code,\n      'Cannot create submission without unique ID',\n      'SubmissionID column received NULL value on INSERT',\n      'submissions', 'SubmissionID', 'NULL',\n      '["sub_abc123xyz", "sub_2026_001"]',\n      'Ensure UUID is generated before INSERT. Check application code.',\n      'CRITICAL'\n    );\n    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;\n  END IF;\n\n  IF NOT EXISTS (SELECT 1 FROM `members` WHERE `MemberID` = NEW.`MemberID`) THEN\n    SET error_code = 'SUBM_FK_INVALID_MEMBER';\n    SET error_msg = CONCAT(\n      'MemberID "', NEW.`MemberID`, '" does not exist in members table. ',\n      'Error: ', error_context_id\n    );\n    INSERT INTO `error_context` (\n      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,\n      `TableName`, `ColumnName`, `ConstraintName`, `ProblematicValue`,\n      `SuggestedFix`, `Severity`\n    ) VALUES (\n      error_context_id, error_code,\n      CONCAT('Invalid MemberID: ', NEW.`MemberID`),\n      'Foreign key validation failed: referenced member does not exist',\n      'submissions', 'MemberID', 'fk_submissions_members',\n      NEW.`MemberID`,\n      'Verify MemberID exists in members table before creating submission',\n      'ERROR'\n    );\n    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;\n  END IF;\n\n  IF NEW.`Status` NOT IN ('pending','approved','cancelled','expired') THEN\n    SET error_code = 'SUBM_INVALID_STATUS';\n    SET error_msg = CONCAT(\n      'Invalid Status value: "', NEW.`Status`, '". ',\n      'Allowed: pending, approved, cancelled, expired. ',\n      'Error: ', error_context_id\n    );\n    INSERT INTO `error_context` (\n      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,\n      `TableName`, `ColumnName`, `ProblematicValue`,\n      `AllowedRange`, `ValidValueExamples`, `SuggestedFix`, `Severity`\n    ) VALUES (\n      error_context_id, error_code,\n      CONCAT('Invalid submission status: ', NEW.`Status`),\n      'Status enum constraint violated',\n      'submissions', 'Status', NEW.`Status`,\n      'pending | approved | cancelled | expired',\n      '["pending", "approved"]',\n      'Use one of the allowed status values. Default is "pending".',\n      'ERROR'\n    );\n    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;\n  END IF;\n\n  IF NEW.`Amount` IS NOT NULL AND NEW.`Amount` < 0 THEN\n    SET error_code = 'SUBM_NEGATIVE_AMOUNT';\n    SET error_msg = CONCAT(\n      'Amount cannot be negative: ', NEW.`Amount`, '. ',\n      'Error: ', error_context_id\n    );\n    INSERT INTO `error_context` (\n      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,\n      `TableName`, `ColumnName`, `ProblematicValue`,\n      `AllowedRange`, `SuggestedFix`, `Severity`\n    ) VALUES (\n      error_context_id, error_code,\n      'Submission amount is negative',\n      'Amount validation failed: received negative value',\n      'submissions', 'Amount', CAST(NEW.`Amount` AS CHAR),\n      '>= 0',\n      'Ensure amount is positive. Use absolute value or check calculation logic.',\n      'WARNING'\n    );\n    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;\n  END IF;\nEND
