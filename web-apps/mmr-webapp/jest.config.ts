import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'lib/**/*.{ts,tsx}',
    'app/api/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  // Ratchet floor — set just below the current baseline (lines/stmts ~33%,
  // branches ~79%, funcs ~47%) so coverage can only go up. Raise these as
  // tests are added; CI (npm test -- --coverage) fails if any drops below.
  coverageThreshold: {
    global: {
      statements: 30,
      branches: 75,
      functions: 43,
      lines: 30,
    },
  },
}

export default createJestConfig(config)
