"use strict";
// ============================================================
// Family member management
// Depends on: config.ts, sheets.ts, logger.ts
// Exposed GAS functions: getFamilyMembers, addFamilyMember, removeFamilyMember
// ============================================================
// Returns all members sharing the acting member's FamilyID.
function getFamilyMembers(jsonRequest) {
    const req = JSON.parse(jsonRequest);
    const { payload } = req;
    try {
        const result = findMemberByID(payload.memberID);
        if (!result)
            return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');
        const { member } = result;
        if (member.type !== 'Family') {
            return jsonError(req.requestId, 'INVALID_STATE', 'Only Family-type members can manage family members.');
        }
        if (!member.familyID) {
            return jsonOk(req.requestId, { members: [] });
        }
        const members = getMembersByFamilyID(member.familyID);
        return jsonOk(req.requestId, { members, familyID: member.familyID });
    }
    catch (e) {
        return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
    }
}
// Add a member to the acting member's family group.
// The target member must already exist in Membership Master.
// If Status = pending_upgrade, the new member gets Expiration = yesterday (inactive).
function addFamilyMember(jsonRequest) {
    const req = JSON.parse(jsonRequest);
    const { payload } = req;
    try {
        const actor = findMemberByID(payload.memberID);
        if (!actor)
            return jsonError(req.requestId, 'NOT_FOUND', 'Acting member not found.');
        if (actor.member.type !== 'Family') {
            return jsonError(req.requestId, 'INVALID_STATE', 'Only Family-type members can add family members.');
        }
        if (!actor.member.familyID) {
            return jsonError(req.requestId, 'INVALID_STATE', 'Acting member has no FamilyID.');
        }
        const target = findMemberByEmail(payload.targetEmail);
        if (!target) {
            return jsonError(req.requestId, 'NOT_FOUND', `No member found with email: ${payload.targetEmail}`);
        }
        if (target.member.familyID && target.member.familyID !== actor.member.familyID) {
            return jsonError(req.requestId, 'CONFLICT', 'This member is already part of a different family group.');
        }
        if (target.member.memberID === payload.memberID) {
            return jsonError(req.requestId, 'INVALID_STATE', 'Cannot add yourself as a family member.');
        }
        // Log before write
        logMainTableRow(target.member.memberID);
        const now = new Date().toISOString();
        // If acting member is in pending_upgrade, new member gets yesterday's date (inactive)
        const isPendingUpgrade = actor.member.status === 'pending_upgrade';
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        const updates = {
            TYPE: 'Family',
            FAMILY_ID: actor.member.familyID,
            LAST_UPDATED: now,
        };
        if (isPendingUpgrade) {
            updates['EXPIRATION'] = yesterdayStr;
            updates['STATUS'] = 'pending_upgrade';
        }
        updateMemberRow(target.rowIndex, updates);
        auditLog('FAMILY_MEMBER_ADDED', {
            memberID: payload.memberID,
            sessionID: payload.sessionID,
            state: { targetMemberID: target.member.memberID, familyID: actor.member.familyID },
        });
        const updated = findMemberByID(target.member.memberID);
        return jsonOk(req.requestId, {
            member: updated === null || updated === void 0 ? void 0 : updated.member,
            message: `${target.member.firstName || target.member.email} added to family.`,
        });
    }
    catch (e) {
        return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
    }
}
// Remove a member from the acting member's family group.
// The removed member reverts to Individual; their status is recalculated from expiration.
function removeFamilyMember(jsonRequest) {
    const req = JSON.parse(jsonRequest);
    const { payload } = req;
    try {
        const actor = findMemberByID(payload.memberID);
        if (!actor)
            return jsonError(req.requestId, 'NOT_FOUND', 'Acting member not found.');
        if (actor.member.type !== 'Family') {
            return jsonError(req.requestId, 'INVALID_STATE', 'Only Family-type members can remove family members.');
        }
        const target = findMemberByEmail(payload.targetEmail);
        if (!target) {
            return jsonError(req.requestId, 'NOT_FOUND', `No member found with email: ${payload.targetEmail}`);
        }
        if (target.member.memberID === payload.memberID) {
            return jsonError(req.requestId, 'INVALID_STATE', 'Cannot remove yourself. Use Cancel Upgrade or contact admin.');
        }
        if (target.member.familyID !== actor.member.familyID) {
            return jsonError(req.requestId, 'CONFLICT', 'This member is not in your family group.');
        }
        // Log before write
        logMainTableRow(target.member.memberID);
        const now = new Date().toISOString();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expDate = target.member.expiration ? new Date(target.member.expiration) : null;
        const revertedStatus = expDate && !isNaN(expDate.getTime()) && expDate >= today ? 'active' : 'inactive';
        updateMemberRow(target.rowIndex, {
            TYPE: 'Individual',
            FAMILY_ID: '',
            STATUS: revertedStatus,
            LAST_UPDATED: now,
        });
        auditLog('FAMILY_MEMBER_REMOVED', {
            memberID: payload.memberID,
            sessionID: payload.sessionID,
            state: { targetMemberID: target.member.memberID },
        });
        return jsonOk(req.requestId, {
            message: `${target.member.firstName || target.member.email} removed from family and reverted to Individual.`,
        });
    }
    catch (e) {
        return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
    }
}
globalThis.getFamilyMembers = getFamilyMembers;
globalThis.addFamilyMember = addFamilyMember;
globalThis.removeFamilyMember = removeFamilyMember;
