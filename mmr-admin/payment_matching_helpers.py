"""
Payment Matching Helpers — pure text/fuzzy functions for payment reconciliation.
No DB access, no Flask routes. Extracted from payment_matching.py to keep files
under the code-health line limit. Re-exported by payment_matching for compatibility.
"""
from __future__ import annotations


def build_member_text(member: dict) -> str:
    """
    Build searchable member text from member record.
    Format: "FirstName LastName WeChatID email_local NYRRRunnerName"
    """
    parts = [
        member.get('FirstName', ''),
        member.get('LastName', ''),
        member.get('WeChatID', ''),
    ]

    # Extract email local part (before @)
    email = member.get('Email', '')
    if email and '@' in email:
        parts.append(email.split('@')[0])

    # Add NYRR runner name if available
    if member.get('NYRRRunnerName'):
        parts.append(member['NYRRRunnerName'])

    # Join and normalize: lowercase, remove empty parts, single space separation
    text = ' '.join(p for p in parts if p).lower()
    return text


def build_transaction_text(gmail: dict) -> str:
    """
    Build searchable transaction text from Gmail transaction.
    Format: "Sender Memo Notes"
    """
    parts = [
        gmail.get('Sender', ''),
        gmail.get('Memo', ''),
        gmail.get('Notes', ''),
    ]
    text = ' '.join(p for p in parts if p).lower()
    return text


def fuzzy_match_transaction_to_member(gmail: dict, member: dict) -> tuple[bool, int]:
    """
    Fuzzy match a Gmail transaction to a member using 4 priority rules.

    Rules (in priority order):
    1. MemberID is substring of transaction text
    2. Last 4 digits of TransactionNumber match MemberID
    3. Every word in Sender is substring of member_text
    4. Any word in member_text is substring of transaction_text

    Returns: (matched: bool, priority: int)
      - priority 0 = payment-linked (caller sets; not returned by this fn)
      - priority 1 = rule 1, 2 = rule 2, 3 = rule 3, 4 = rule 4
      - priority 0 / matched=False = no match
    """
    member_id = (member.get('MemberID') or '').upper()
    tx_number = gmail.get('TransactionNumber') or ''
    sender = (gmail.get('Sender') or '').lower()
    memo = (gmail.get('Memo') or '').lower()
    notes = (gmail.get('Notes') or '').lower()

    member_text = build_member_text(member)
    tx_text = build_transaction_text(gmail)

    # Rule 1: MemberID is substring of transaction text
    if member_id and member_id.lower() in tx_text:
        return True, 1

    # Rule 2: Last 4 digits of TransactionNumber match MemberID (without A prefix)
    if tx_number and len(member_id) >= 2 and member_id[1:].isdigit():
        member_digits = member_id[1:]  # Remove 'A' prefix
        tx_last_4 = tx_number[-4:] if len(tx_number) >= 4 else tx_number
        if tx_last_4 == member_digits:
            return True, 2

    # Rule 3: Every word in Sender is substring of member_text
    if sender:
        sender_words = sender.split()
        if sender_words and all(word in member_text for word in sender_words):
            return True, 3

    # Rule 4: Any word in member_text is substring of transaction_text
    if member_text:
        member_words = member_text.split()
        if any(word in tx_text for word in member_words):
            return True, 4

    return False, 0
