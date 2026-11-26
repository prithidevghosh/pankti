export default () => {
  return {
    name: 'Pankti',
    slug: 'pankti',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    android: {
      package: 'in.pankti.counter',
      adaptiveIcon: { backgroundColor: '#234C40' },
    },
    ios: {
      bundleIdentifier: 'in.pankti.counter',
    },
    plugins: [
      'expo-secure-store',
      ['./plugins/local-network.cjs'],
      ['expo-build-properties', { ios: { useFrameworks: 'static' } }],
      [
        'expo-audio',
        {
          microphonePermission: 'Pankti uses your microphone to record orders and add your menu.',
          enableBackgroundRecording: false,
        },
      ],
      [
        'expo-image-picker',
        {
          cameraPermission: 'Pankti uses the camera to scan your existing UPI QR card.',
          photosPermission: 'Pankti can read a UPI QR card from a photo you pick.',
          microphonePermission: 'Pankti uses your microphone for spoken orders and menu entries.',
        },
      ],
    ],
  };
};
