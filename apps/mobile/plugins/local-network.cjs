const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withLocalNetwork(config) {
  if (!/^http:\/\/10\.0\.2\.2(?::\d+)?$/.test(process.env.EXPO_PUBLIC_API_URL || '')) return config;
  return withAndroidManifest(config, (result) => {
    result.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    return result;
  });
};
