/**
 * ESLint flat config (#148).
 *
 * Minimal gate: react-hooks/rules-of-hooks as an error so hook calls inside
 * plain callbacks (e.g. useMemo inside a FlatList renderItem) fail the build
 * instead of crashing the app at runtime with "Invalid hook call".
 * exhaustive-deps stays a warning by design - informational, never blocking.
 */
const reactHooks = require('eslint-plugin-react-hooks');
const tsParser = require('@typescript-eslint/parser');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'android/**',
      '.expo/**',
      'graphify-out/**',
      'coverage/**',
      'assets/**',
    ],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      // TS/TSX files cannot be parsed by espree.
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
