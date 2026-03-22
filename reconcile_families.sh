#!/bin/bash
set -e

echo ""
echo "======================================================================"
echo "    MMR MEMBERS RECONCILIATION"
echo "======================================================================"
echo ""

source load-env.sh

MYSQL_CMD="mysql --login-path=mmr -D mmrdb"

echo "1. Analyzing family structure..."
echo "----------------------------------------------------------------------"
$MYSQL_CMD << 'EOF'
SELECT
    FamilyID,
    COUNT(*) as members,
    SUM(CASE WHEN Type = 'Family' THEN 1 ELSE 0 END) as family_type_count,
    SUM(CASE WHEN Status = 'active' THEN 1 ELSE 0 END) as active_count
FROM members
WHERE FamilyID IS NOT NULL
GROUP BY FamilyID
ORDER BY members DESC
LIMIT 15;
EOF

echo ""
echo "2. Checking for inconsistencies..."
echo "----------------------------------------------------------------------"
$MYSQL_CMD << 'EOF'
SELECT COUNT(*) as individual_with_familyid
FROM members
WHERE FamilyID IS NOT NULL AND Type = 'Individual';
EOF

echo ""
echo "3. Populating families table..."
echo "----------------------------------------------------------------------"
$MYSQL_CMD << 'EOF'
INSERT INTO families (FamilyID, PrimaryMemberID)
SELECT DISTINCT
    m1.FamilyID,
    (SELECT MemberID FROM members m2
     WHERE m2.FamilyID = m1.FamilyID
     ORDER BY m2.MembershipFeePaid DESC, m2.Created ASC
     LIMIT 1)
FROM members m1
WHERE m1.FamilyID IS NOT NULL
ON DUPLICATE KEY UPDATE PrimaryMemberID = VALUES(PrimaryMemberID);
EOF

echo ""
echo "4. Final summary..."
echo "----------------------------------------------------------------------"
$MYSQL_CMD << 'EOF'
SELECT
    'Families' as table_name, COUNT(*) as row_count
FROM families
UNION ALL
SELECT 'Members with FamilyID', COUNT(*)
FROM members
WHERE FamilyID IS NOT NULL
UNION ALL
SELECT 'Total members', COUNT(*)
FROM members;
EOF

echo ""
echo "======================================================================"
echo "    RECONCILIATION COMPLETE"
echo "======================================================================"
cd ~/github/mmr/trailhead
./reconcile_families.shcd ~/github/mmr/trailhead
./reconcile_families.shcd ~/github/mmr/trailhead
./reconcile_families.shcd ~/github/mmr/trailhead
./reconcile_families.shecho ""
