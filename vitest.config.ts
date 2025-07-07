import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [ 'test/**/*.test.ts'],
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.test.json',
      include: ['test/**/*.test.ts'],
    },
  },
  resolve: {
    alias: {
      '#@': '/dist',
      'modstack/utils/env-vars-proxy': '/dist/utils/env-vars-proxy.js',
      'modstack': '/',
    },
  },
});

