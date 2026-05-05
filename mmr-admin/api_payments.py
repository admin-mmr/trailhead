"""
Payment Reconciliation API — orchestrator.

Blueprint: payments_bp
Prefix:    /api/payments

Routes are split across sibling modules so each file stays under the 400-LOC
limit (CLAUDE.md hard rule). All modules import `payments_bp` from here and
register their handlers via `@payments_bp.route(...)`. Importing those modules
at the bottom of this file is what triggers route registration.

Module breakdown:
  api_payments_listings — read-only lists (dashboard, pending subs, unmatched
                          gmail, history, cancel, search, autoguess-log)
  api_payments_actions  — write mutations (autoguess-all, manual-approve,
                          admin-create)
  api_payments_lookups  — per-member / per-submission lookups + match
                          inspection used by the admin UI
  api_payments_debug    — diagnostic endpoints (debug-autoguess,
                          test-fuzzy-match)

Flow recap:
  1. Dashboard counts pending submissions, unmatched gmail_transactions, and
     recently approved/rejected/error rows.
  2. /pending-submissions and /unmatched-gmail feed the two queues in the UI.
  3. Autoguess scans unmatched gmail → checks renewal logic → links to a
     pending membership submission when one exists.
  4. Manual approval lets an admin pick memberID + gmail tx → create payment.
  5. Database triggers handle member status updates, submission approvals, and
     gmail Notes sync — see CLAUDE.md "PAYMENT API" for trigger names.
"""

from __future__ import annotations

from flask import Blueprint

payments_bp = Blueprint('payments', __name__)

# Import route modules to register handlers on payments_bp.
# These imports MUST come after the blueprint is defined (the modules import it
# from this file). The noqa pragmas suppress "unused import" warnings — the
# import itself is the side-effect that registers the routes.
from api_payments_listings import *  # noqa: E402, F401, F403
from api_payments_actions import *   # noqa: E402, F401, F403
from api_payments_lookups import *   # noqa: E402, F401, F403
from api_payments_debug import *     # noqa: E402, F401, F403
