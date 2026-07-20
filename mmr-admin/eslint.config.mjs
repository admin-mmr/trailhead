// ESLint flat config for mmr-admin/static/ — browser React components loaded
// via <script type="text/babel"> tags (no modules, no bundler, JSX in .js).
//
// Philosophy (P1j): start LOW and ratchet later. Correctness rules that catch
// real defects (no-undef, no-dupe-keys, no-unreachable, use-isnan, ...) are
// errors; style/pattern rules the existing 33 files violate en masse are off.
// `npx eslint static/` must exit 0 on healthy code.

import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['static/**/*.backup', 'node_modules/**'],
  },
  {
    files: ['static/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script', // classic <script> tags, not ES modules
      parserOptions: {
        ecmaFeatures: { jsx: true }, // files are Babel-in-browser JSX
      },
      globals: {
        ...globals.browser,

        // ── Vendor globals (CDN <script> tags in templates/index.html) ──
        React: 'readonly',
        ReactDOM: 'readonly',

        // ── React hooks destructured globally in index.html ──
        // `const { useState, useEffect, useCallback, useRef } = React;`
        useState: 'readonly',
        useEffect: 'readonly',
        useCallback: 'readonly',
        useRef: 'readonly',
        useMemo: 'readonly',

        // ── App-level helpers defined in index.html / component-loader.js ──
        initComponent: 'readonly', // /static/component-loader.js
        api: 'readonly', // fetch wrapper (also window.api)
        pollUntilDone: 'readonly', // shared job-polling utility (window.pollUntilDone)
        StatusBadge: 'readonly', // shared badge component from index.html
        mmrUtils: 'readonly', // shared UI utilities (window.mmrUtils, /static/utils.js)
      },
    },
    rules: {
      ...js.configs.recommended.rules,

      // ── Keep as errors: these catch real defects ──
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'use-isnan': 'error',
      'no-dupe-args': 'error',
      'no-const-assign': 'error',
      'no-self-assign': 'error',
      'no-cond-assign': 'error',
      'no-func-assign': 'error',
      'no-obj-calls': 'error',
      'no-sparse-arrays': 'error',
      'valid-typeof': 'error',
      'no-compare-neg-zero': 'error',
      'no-constant-binary-expression': 'error',

      // ── Downgraded/disabled: violated en masse by existing code; ratchet later ──
      // `catch (_) {}` and intentionally-ignored args are idiomatic here.
      'no-unused-vars': [
        'warn',
        {
          args: 'none',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      // Components share one global scope across <script> tags; hooks pattern
      // and same-file helper shadowing make this noisy rather than useful.
      'no-redeclare': 'off',
      // `while (true)` polling loops and `if (true)` feature toggles exist.
      'no-constant-condition': ['error', { checkLoops: false }],
      // Empty catch blocks are the established error-swallowing pattern.
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Regex escapes copied from working code; harmless.
      'no-useless-escape': 'warn',
      // `case X: const y = ...` appears in existing switches; not a defect.
      'no-case-declarations': 'warn',
      // hasOwnProperty direct calls exist and are safe on plain objects here.
      'no-prototype-builtins': 'warn',
    },
  },
];
