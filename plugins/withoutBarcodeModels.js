const { withAppBuildGradle } = require('expo/config-plugins');

// expo-camera arrastra los modelos de ML Kit para códigos de barras (0,9 MB) aunque no se usen
// (su libbarhopper ya va excluida); son assets, y packagingOptions solo filtra .so y recursos Java
const PATTERN = '!<dir>mlkit_barcode_models';

module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    const src = c.modResults.contents;
    if (src.includes(PATTERN)) return c;
    const out = src.replace(/(ignoreAssetsPattern\s+'[^']*)'/, `$1:${PATTERN}'`);
    if (out === src) throw new Error('withoutBarcodeModels: no hay ignoreAssetsPattern en app/build.gradle');
    c.modResults.contents = out;
    return c;
  });
