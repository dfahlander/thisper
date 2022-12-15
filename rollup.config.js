//import ts from 'rollup-plugin-ts';
import typescript from '@rollup/plugin-typescript';
//import terser from '@rollup/plugin-terser';

export default {
  input: './src/thisper.ts',
  output: {
    dir: 'dist',
    format: 'es',
    sourcemap: true
  },
  plugins: [
    typescript()
    //ts(),
    /*terser({
      ecma: 2020,
      module: true,
      sourceMap: true,
      compress: true
    })*/
  ]
};
