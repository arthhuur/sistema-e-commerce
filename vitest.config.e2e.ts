import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Mesmo motivo do vitest.config.ts: os arquivos compartilham o banco de
    // teste, e um TRUNCATE não pode cair no meio da execução de outro arquivo.
    fileParallelism: false,
  },
});
