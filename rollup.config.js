import ts from 'rollup-plugin-ts';
//import terser from '@rollup/plugin-terser';

export default {
  input: './src/thisper.ts',
  output: {
    dir: 'dist',
    format: 'es',
    sourcemap: true
  },
  plugins: [
    ts(),
    /*terser({
      ecma: 2020,
      module: true,
      sourceMap: true,
      compress: true
    })*/
  ]
};
