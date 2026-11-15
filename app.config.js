module.exports = {
  expo: {
    name: "DeepTutor 移动版", slug: "deeptutor-mobile", version: "0.4.1",
    ...require("./scripts/ota-config.cjs")(),
    extra: { releaseVersion: require("./package.json").version },
    orientation: "default", userInterfaceStyle: "light", scheme: "deeptutor-mobile",
    ios: { supportsTablet: true, bundleIdentifier: "org.deeptutormobile.client", buildNumber: "7",
      infoPlist: { CFBundleDevelopmentRegion: "zh_CN", CFBundleLocalizations: ["zh_CN"],
        NSLocalNetworkUsageDescription: "连接你自己的电脑上的 DeepTutor 学习服务。",
        NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } },
    android: { package: "org.deeptutormobile.client", versionCode: 7, predictiveBackGestureEnabled: false, softwareKeyboardLayoutMode: "resize" },
    plugins: ["expo-router", "expo-secure-store", "expo-font",
      ["expo-build-properties", { ios: { enableSceneSupport: true } }],
      ["expo-image-picker", { photosPermission: "选择题目照片用于学习与讲解。", cameraPermission: "拍摄题目，用于识别与讲解。", microphonePermission: false }],
      "./plugins/with-network.cjs", "./plugins/with-learning-share.cjs", "./plugins/with-release-signing.cjs", "expo-video",
      ["expo-audio", { microphonePermission: false, enableBackgroundPlayback: false, enableBackgroundRecording: false }],
      "expo-asset", ["expo-sharing", { ios: { enabled: false }, android: { enabled: false } }]]
  }
};
