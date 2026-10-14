import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: './src/index.ts' },
  format: 'esm',
  target: 'es2024',
  dts: true,
  sourcemap: true,
  clean: true,
})
