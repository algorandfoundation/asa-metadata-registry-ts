import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import prettierPlugin from 'eslint-plugin-prettier'
import unusedImports from 'eslint-plugin-unused-imports'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { builtinModules } from 'module'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// The SDK also runs in browsers, where bundlers drop Node built-ins or replace them with polyfills
// (e.g. crypto-browserify has no SHA-512/256)
const nodeBuiltinMessage = 'The SDK also runs in browsers: do not import Node built-ins in src/.'

// Source ignored files from prettier to have a single source of truth
const prettierIgnore = fs
  .readFileSync(resolve(__dirname, '.prettierignore'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: resolve(__dirname, './tsconfig.eslint.json'),
        tsconfigRootDir: __dirname,
      },
      globals: globals.node, // console, process, Buffer, etc.
    },
    plugins: {
      '@typescript-eslint': tseslint,
      prettier: prettierPlugin,
      'unused-imports': unusedImports,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'prettier/prettier': 'warn',
      'no-console': 'warn',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          ignoreRestSiblings: true,
          argsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-unused-expressions': 'off',
      'prefer-template': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      // Only the globals that browsers also have, so that no-undef reports process, Buffer, setImmediate and others
      // (flat config merges `globals` with the block above, so every Node global is switched off first)
      globals: {
        ...Object.fromEntries(Object.keys(globals.node).map((name) => [name, 'off'])),
        ...globals['shared-node-browser'],
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: builtinModules.map((name) => ({ name, message: nodeBuiltinMessage })),
          patterns: [{ group: ['node:*'], message: nodeBuiltinMessage }],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message: 'Do not use import() in src/: no-restricted-imports does not check dynamic imports.',
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: [...prettierIgnore, '*.js'],
  },
  prettierConfig,
]
