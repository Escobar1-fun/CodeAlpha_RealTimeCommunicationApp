const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

export default {
  expo: {
    name: 'Roundtable',
    slug: 'roundtable',
    version: '1.0.0',
    orientation: 'default',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    scheme: 'roundtable',
    backgroundColor: '#101214',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#101214',
    },
    ios: {
      bundleIdentifier: 'com.codealpha.roundtable',
      supportsTablet: true,
      infoPlist: {
        NSCameraUsageDescription: 'Roundtable uses the camera for video meetings.',
        NSMicrophoneUsageDescription: 'Roundtable uses the microphone for video meetings.',
      },
    },
    android: {
      package: 'com.codealpha.roundtable',
      adaptiveIcon: {
        backgroundImage: './assets/android-icon-background.png',
        foregroundImage: './assets/android-icon-foreground.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      permissions: [
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.BLUETOOTH_CONNECT',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.WAKE_LOCK',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
      ],
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-sharing',
      [
        'expo-build-properties',
        // Plain HTTP is only ever allowed when the configured backend is plain HTTP,
        // which is the local USB setup. Builds pointing at HTTPS forbid it.
        { android: { usesCleartextTraffic: apiUrl.startsWith('http://') } },
      ],
    ],
    experiments: { typedRoutes: false },
  },
};
