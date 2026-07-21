/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json',
    },
  },
  testMatch: ['**/tests/**/*.test.ts'],
  setupFilesAfterEnv: ['./tests/setup.ts'],
  // Coverage ratchet. collectCoverage is on so the CI `npm test` (unchanged)
  // enforces the floor without a workflow-file edit. Floors set just below the
  // current baseline (stmts 39 / branches 29 / funcs 39 / lines 39) so coverage
  // can only go up — raise these as tests are added.
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageReporters: ['text-summary'],
  coverageThreshold: {
    global: {
      statements: 35,
      branches: 25,
      functions: 35,
      lines: 35,
    },
  },
};
