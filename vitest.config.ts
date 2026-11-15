import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: 1,
    fileParallelism: false,
    include: ['tests/unit/**/*.test.ts', 'tests/architecture/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/application/**', 'src/security/**', 'src/codecs/**'],
    },
  },
});
