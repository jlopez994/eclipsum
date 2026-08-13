// https://docs.expo.dev/guides/using-eslint/
const expoConfig = require('eslint-config-expo/flat');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['android/**', 'ios/**', '.expo/**'],
  },
  {
    rules: {
      // Reglas de adopción de React Compiler (react-hooks v7): marcan patrones clásicos y
      // correctos de RN sin compilador — useRef(new Animated.Value()).current y resets de
      // estado en efectos con su porqué comentado. Sin compilador no aportan; exhaustive-deps
      // y el resto del plugin quedan activos.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
