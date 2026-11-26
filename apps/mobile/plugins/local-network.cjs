const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withLocalNetwork(config) {

  return withAndroidManifest(config, (result) => {
    const manifest = result.modResults.manifest;
    const permissions = manifest['uses-permission'] ||= [];
    for (const name of ['android.permission.RECORD_AUDIO','android.permission.CAMERA']) {
      const permission = permissions.find(item => item.$['android:name'] === name);
      if (permission) delete permission.$['tools:node'];
      else permissions.push({ $: { 'android:name': name } });
    }
    if (/^http:\/\/(10\.0\.2\.2|127\.0\.0\.1|localhost)(?::\d+)?$/.test(process.env.EXPO_PUBLIC_API_URL || ''))
      manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    return result;
  });
};
