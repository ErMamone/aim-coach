/* eslint.config.js — flat config LEAN. Atrapa bugs reales (dupe-keys, unreachable, cond-assign, etc.)
 * sin ahogarse en ruido estilístico: este repo usa `any` a propósito (callbacks de Overwolf sin tipar),
 * `catch (_) {}` y `() => {}` como defaults. Los tipos/undefined los cubre `tsc` (yarn typecheck).
 */
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  { ignores: ['dist/**', '.tmp-tests/**', '.tmp/**', 'native/**', 'node_modules/**', '.yarn/**'] },

  // Código TypeScript (src + tests)
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      'no-undef': 'off',                                   // TS/tsc ya valida identificadores (overwolf, DOM, etc.)
      '@typescript-eslint/no-explicit-any': 'off',         // `any` es intencional (Overwolf sin tipos)
      '@typescript-eslint/no-empty-function': 'off',       // `() => {}` como default de callback
      '@typescript-eslint/no-unused-expressions': 'off',   // idiom `cond ? a() : b()` (dibujo de canvas)
      'no-empty': ['error', { allowEmptyCatch: true }],    // `catch (_) {}` permitido
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },

  // Archivos de config JS (CommonJS, Node)
  {
    files: ['*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', __dirname: 'readonly', process: 'readonly', console: 'readonly' },
    },
  },
);
