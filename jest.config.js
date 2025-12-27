/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.mjs'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  transform: {},
  // Mock browser globals
  setupFilesAfterEnv: ['<rootDir>/jest.setup.mjs'],
};

export default config;
