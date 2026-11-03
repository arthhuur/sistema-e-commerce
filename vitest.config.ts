import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Fase 2: os testes agora compartilham UM banco de Postgres. Rodando os
    // arquivos em paralelo, o TRUNCATE de um apagaria as tabelas no meio do
    // outro. Serializar os arquivos custa alguns segundos e devolve o
    // isolamento que cada teste tinha quando os dados viviam em memória.
    fileParallelism: false,
  },
});
