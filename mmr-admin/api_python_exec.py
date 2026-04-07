"""
Python Execution Engine for MMR Admin Portal

Provides a safe, sandboxed way to execute diagnostic Python functions
in Azure for debugging data sync and import issues.

Functions can be registered and executed via REST API.
"""

from __future__ import annotations

import json
import traceback
from datetime import datetime
from flask import Blueprint, request, jsonify
from auth import login_required
import db as dbmod
from diagnostics import FUNCTIONS

py_exec_bp = Blueprint('py_exec', __name__, url_prefix='/api/py-exec')


# ─────────────────────────────────────────────────────────────────────────────
# API Routes
# ─────────────────────────────────────────────────────────────────────────────

@py_exec_bp.route('/list', methods=['GET'])
@login_required
def list_functions():
    """Return list of available diagnostic functions."""
    functions = []
    for name, func in FUNCTIONS.items():
        functions.append({
            'name': name,
            'description': (func.__doc__ or '').strip()
        })
    return jsonify({'functions': functions})


@py_exec_bp.route('/run/<fn_name>', methods=['POST'])
@login_required
def run_function(fn_name):
    """Execute a diagnostic function and return results."""
    execution_start = datetime.utcnow()

    if fn_name not in FUNCTIONS:
        return jsonify({
            'status': 'error',
            'error': f'Function "{fn_name}" not found',
            'available': list(FUNCTIONS.keys()),
            'timestamp': execution_start.isoformat()
        }), 404

    try:
        func = FUNCTIONS[fn_name]

        # Get any kwargs from request body
        data = request.get_json() or {}
        kwargs = data.get('kwargs', {})

        # Log execution
        print(f"[PY_EXEC] Executing: {fn_name}")
        if kwargs:
            print(f"[PY_EXEC] With kwargs: {kwargs}")

        # Execute function
        result = func(**kwargs)

        # Ensure result is JSON-serializable
        execution_end = datetime.utcnow()
        elapsed_ms = (execution_end - execution_start).total_seconds() * 1000

        result['executed_at'] = execution_end.isoformat()
        result['execution_time_ms'] = round(elapsed_ms, 2)
        result['function'] = fn_name

        print(f"[PY_EXEC] ✓ {fn_name} completed in {elapsed_ms:.0f}ms (status: {result.get('status', 'unknown')})")
        return jsonify(result)

    except Exception as e:
        execution_end = datetime.utcnow()
        elapsed_ms = (execution_end - execution_start).total_seconds() * 1000
        print(f"[PY_EXEC] ✗ {fn_name} failed in {elapsed_ms:.0f}ms: {type(e).__name__}: {str(e)}")

        return jsonify({
            'status': 'error',
            'function': fn_name,
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc(),
            'executed_at': execution_end.isoformat(),
            'execution_time_ms': round(elapsed_ms, 2)
        }), 500


@py_exec_bp.route('/code', methods=['POST'])
@login_required
def execute_code():
    """Execute arbitrary Python code with access to db helper functions."""
    execution_start = datetime.utcnow()
    data = request.get_json() or {}
    code = data.get('code', '').strip()

    if not code:
        return jsonify({
            'status': 'error',
            'error': 'No code provided',
            'executed_at': execution_start.isoformat()
        }), 400

    # Create safe execution environment with useful helpers
    exec_globals = {
        'query': dbmod.query,  # Direct DB query helper
        'execute': dbmod.execute,  # Direct DB execute helper
        'datetime': datetime,
        'json': json,
        'traceback': traceback,
    }

    output_lines = []
    debug = {
        'code_length': len(code),
        'code_lines': len(code.split('\n')),
        'available_helpers': list(exec_globals.keys()),
    }

    try:
        # Capture print output
        import io
        import sys

        old_stdout = sys.stdout
        sys.stdout = io.StringIO()

        # Execute user code
        exec(code, exec_globals)

        # Get captured output
        output = sys.stdout.getvalue()
        sys.stdout = old_stdout

        if output:
            output_lines = output.strip().split('\n')

        execution_end = datetime.utcnow()
        elapsed_ms = (execution_end - execution_start).total_seconds() * 1000

        result = {
            'status': 'ok',
            'output': output_lines,
            'output_text': output,
            'executed_at': execution_end.isoformat(),
            'execution_time_ms': round(elapsed_ms, 2),
            'debug': debug
        }

        print(f"[PY_EXEC] Code executed successfully in {elapsed_ms:.0f}ms", file=sys.stderr)
        return jsonify(result)

    except SyntaxError as e:
        sys.stdout = old_stdout
        return jsonify({
            'status': 'error',
            'error_type': 'SyntaxError',
            'error': str(e),
            'line': e.lineno,
            'offset': e.offset,
            'traceback': traceback.format_exc(),
            'debug': debug
        }), 400

    except Exception as e:
        sys.stdout = old_stdout
        execution_end = datetime.utcnow()
        elapsed_ms = (execution_end - execution_start).total_seconds() * 1000

        return jsonify({
            'status': 'error',
            'error_type': type(e).__name__,
            'error': str(e),
            'traceback': traceback.format_exc(),
            'executed_at': execution_end.isoformat(),
            'execution_time_ms': round(elapsed_ms, 2),
            'debug': debug
        }), 500


@py_exec_bp.route('/health', methods=['GET'])
@login_required
def health_check():
    """Health check for python execution engine."""
    return jsonify({
        'status': 'ok',
        'service': 'py-exec',
        'timestamp': datetime.utcnow().isoformat(),
        'available_functions': list(FUNCTIONS.keys()),
    })
