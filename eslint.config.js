// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Configuration ESLint (flat config). Socle lean, non « type-checked » (rapide) : Prettier
 * gère le style, ESLint cible les vrais défauts. Le contrôle de types reste `tsc --noEmit`.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      // Harnais de capture d'écran jetable (contexte navigateur Playwright).
      'scripts/ui-audit.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Underscore = paramètre/variable volontairement inutilisé (convention du dépôt).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },
  {
    // Tests : autoriser les casts délibérés (mocks de fetch, etc.).
    files: ['**/*.test.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Scripts navigateur statiques servis depuis public/ (ex. privacy.js) : script
    // classique, pas un module TS. On leur fournit les globals du navigateur pour
    // que `no-undef` ne signale pas document/localStorage/navigator.
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        window: 'readonly',
      },
    },
  }
);
