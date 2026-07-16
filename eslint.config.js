// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Configuration ESLint (flat config). Socle lean, non « type-checked » (rapide) : Prettier
 * gère le style, ESLint cible les vrais défauts. Le contrôle de types reste `tsc --noEmit`.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Underscore = paramètre/variable volontairement inutilisé (convention du dépôt).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    // Tests : autoriser les casts délibérés (mocks de fetch, etc.).
    files: ['**/*.test.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);
