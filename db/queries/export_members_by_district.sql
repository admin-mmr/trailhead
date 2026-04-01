-- ═══════════════════════════════════════════════════════════════════════════
-- Export Members by District Template
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Purpose: Export member information filtered by district
-- Columns: District, MemberID, Name (First+Last), Expiration, Gender, WeChatID,
--          Email, Type, FamilyID, PaymentDate, MembershipFeePaid, PaymentTransaction
--
-- Usage:
--   1. Replace :district with specific district name (e.g., 'Manhattan', 'Brooklyn')
--   2. Or use WHERE clause with IN () for multiple districts
--   3. Modify ORDER BY clause as needed
--
-- ═══════════════════════════════════════════════════════════════════════════

-- Basic template: Single district
SELECT
    District,
    MemberID,
    CONCAT(FirstName, ' ', LastName) AS Name,
    Expiration,
    Gender,
    WeChatID,
    Email,
    Type,
    FamilyID,
    PaymentDate,
    MembershipFeePaid,
    PaymentTransaction
FROM members
WHERE District = :district
ORDER BY LastName, FirstName;


-- ═══════════════════════════════════════════════════════════════════════════
-- Variants
-- ═══════════════════════════════════════════════════════════════════════════

-- Multiple districts (comma-separated)
-- SELECT ... WHERE District IN ('District1', 'District2', 'District3') ...

-- By district + status
-- SELECT ... WHERE District = :district AND Status = 'active' ...

-- By district + expiration status (e.g., expired, active)
-- SELECT ... WHERE District = :district AND Expiration < CURDATE() ...

-- All districts (no filter)
-- SELECT ... FROM members ORDER BY District, LastName, FirstName;

-- By district + membership type
-- SELECT ... WHERE District = :district AND Type = 'Family' ...


-- ═══════════════════════════════════════════════════════════════════════════
-- Production Query: All districts with optional filters
-- ═══════════════════════════════════════════════════════════════════════════

-- Flexible query with optional WHERE clauses
SELECT
    District,
    MemberID,
    CONCAT(FirstName, ' ', LastName) AS Name,
    DATE(Expiration) AS Expiration,
    Gender,
    WeChatID,
    Email,
    Type,
    FamilyID,
    DATE(PaymentDate) AS PaymentDate,
    MembershipFeePaid,
    PaymentTransaction,
    Status,
    LastUpdated
FROM members
WHERE 1=1
-- AND District = 'Manhattan'                    -- Filter by specific district
-- AND District IN ('Manhattan', 'Brooklyn')     -- Filter by multiple districts
-- AND Status = 'active'                         -- Filter by status
-- AND Expiration >= CURDATE()                   -- Active memberships only
-- AND Expiration < CURDATE()                    -- Expired memberships only
-- AND Type = 'Family'                           -- Filter by membership type
-- AND PaymentDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)  -- Recent payments only
ORDER BY District, LastName, FirstName;


-- ═══════════════════════════════════════════════════════════════════════════
-- SQL for Python/API (parameterized to prevent SQL injection)
-- ═══════════════════════════════════════════════════════════════════════════

/*
Python equivalent:

def export_members_by_district(district=None, status=None, type_filter=None):
    sql = """
    SELECT
        District,
        MemberID,
        CONCAT(FirstName, ' ', LastName) as Name,
        DATE(Expiration) as Expiration,
        Gender,
        WeChatID,
        Email,
        Type,
        FamilyID,
        DATE(PaymentDate) as PaymentDate,
        MembershipFeePaid,
        PaymentTransaction
    FROM members
    WHERE 1=1
    """
    params = []

    if district:
        sql += " AND District = %s"
        params.append(district)

    if status:
        sql += " AND Status = %s"
        params.append(status)

    if type_filter:
        sql += " AND Type = %s"
        params.append(type_filter)

    sql += " ORDER BY District, LastName, FirstName"

    return query(sql, params)

*/
