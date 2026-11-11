# 安装、构建和启动

## 使用发行附件

Android 使用 [0.3.3 APK](https://github.com/TinyPandaGame/deeptutor-mobile/releases/download/v0.3.3/deeptutor-mobile-0.3.3-arm64-v8a.apk)，iOS 工程保持 [0.3.2 ZIP](https://github.com/TinyPandaGame/deeptutor-mobile/releases/download/v0.3.2/deeptutor-mobile-0.3.2-ios-project.zip)。附件校验值、签名和实际测试范围分别见 [Android 0.3.3 Release](https://github.com/TinyPandaGame/deeptutor-mobile/releases/tag/v0.3.3) 和 [iOS 0.3.2 Release](https://github.com/TinyPandaGame/deeptutor-mobile/releases/tag/v0.3.2)。

### Android APK

下载发布页中适合设备架构的 APK，按系统提示允许该安装来源。独立包内含 JS，无需 Node.js、Android Studio 或 Metro。首次打开填写自己的 DeepTutor 服务地址，再按服务设置登录；安装客户端不会在手机或电脑上自动部署 DeepTutor。

升级前核对包名和签名。签名一致才可覆盖安装；遇到签名冲突先确认旧包来源和已有数据，不要直接卸载正在使用的版本。Release 的 SHA-256 用于确认下载文件完整，不能替代签名检查。

### iOS Xcode 工程

工程 ZIP 是供自行构建的项目，不是 IPA，也不是 TestFlight 安装入口。需要 macOS、Xcode、Node.js 24、npm、Python 3 和 CocoaPods；真机安装需要自己的 Apple 开发签名配置。

解压后在包含 `package.json` 的工程根目录安装依赖，再安装 Pods：

```sh
npm ci
npm run prepare:ios
open ios/*.xcworkspace
```

打开 `.xcworkspace`，为主 App 和分享扩展设置自己的开发团队、签名与匹配的 App Group。更改 bundle identifier 或 App Group 时，应同步修改 Expo 配置并重新生成工程，避免只改一个 target。分享扩展的签名不能省略。

`prepare:ios` 只为已有工程安装 Pods，不会重新生成工程或覆盖你在 Xcode 中设置的团队。下载包不包含 `node_modules`、Pods 或个人签名文件，不能跳过依赖安装。

选用 Release 配置可构建内含 JS 的独立应用；Debug 调试需要下文的 Metro 流程。模拟器可使用对应 runtime，无需真机 provisioning；真机、归档和商店分发分别验证。工程不提供维护者的证书、私钥或 provisioning profile。

## 从源码开发

源码锁定 Expo 57.0.31 / React Native 0.86.3 / React 19.2.3。需要 Node.js 24、npm、Python 3。Android 另需完整 JDK 17 或 21、Android SDK；iOS 需要 macOS、Xcode、可用的 Simulator runtime 和 CocoaPods。不要使用只有 java、没有 javac 的 JRE。项目含自定义原生模块，不能直接用 Expo Go。

## 公共准备

```sh
npm ci
npm run typecheck
npx tsc -p tsconfig.tests.json --noEmit
npm run lint
npm test
node scripts/source-check.mjs
# Git 克隆可检查完整历史；源码压缩包不含 Git，跳过这一条
node scripts/source-check.mjs --history
```

在本项目的独立终端运行 `npm start`，保持 Metro 8086 在线。构建脚本先检查选定端口是否为 Metro；没有启动时会明确报错，不会悄悄使用其他项目的端口。需要更换端口时，Metro 与平台脚本均传入同一个 `--port`，例如先 `npx expo start --lan --port 8096`，再给平台命令加 `--port 8096`。请确认该端口属于本项目。

生成目录 android/、ios/ 由 Expo prebuild 管理，不能手工维护。网络权限和 WebSocket 隔离在 plugins/with-network.cjs；修改原生插件或依赖后重新构建。不能用 Expo Go 验收这些策略。

## Android

设置 JAVA_HOME 指向完整 JDK 17 或 21；macOS 已登记的 JDK 可自动发现。ANDROID_HOME / ANDROID_SDK_ROOT 优先，其次检查系统常见 SDK 目录。各版本实际使用的构建环境见对应验收记录。

先在 Android Studio 新建并启动自己的模拟器，或连接、授权测试手机：

```sh
npm run android -- --list-devices
npm run android -- --device <明确的adb序列号>
```

脚本只操作指定目标，按设备选择 arm64-v8a / x86_64 ABI，执行 prebuild、Debug 构建、安装、指定设备的 adb reverse 和应用启动。未授权、离线或不支持的设备会在构建前报错。没有 --device 时只构建 arm64 APK；可用 --arch x86_64 选择另一种构建目标，不安装到任何设备。

```sh
# 仅重新安装并启动已有 APK；修改原生代码后不可跳过构建
npm run android -- --device <序列号> --launch-only
# 只构建，不选设备
npm run android
```

默认产物为 android/app/build/outputs/apk/debug/app-debug.apk，默认包名 org.deeptutormobile.client。调试包依赖 Metro，并非独立发行包。--launch-only 必须沿用原构建使用的端口与兼容 ABI。

## iOS Simulator

在 Xcode 创建独立模拟器，使用其完整 UDID。DEVELOPER_DIR 优先；未设置时脚本检查当前 Xcode 选择，再尝试标准 Xcode 安装位置，只修改子进程环境，不更改系统 xcode-select 设置。

```sh
npm run ios -- --list-devices
npm run ios -- --device <模拟器UDID>
# 后续只安装启动已有包
npm run ios -- --device <模拟器UDID> --launch-only
# 只构建，不启动模拟器，不需要 Metro 在线
npm run ios -- --device <模拟器UDID> --build-only
```

脚本完成 prebuild、pod install、Xcode Debug simulator 构建、只启动指定模拟器、安装及启动应用。默认 DerivedData 为 artifacts/ios-simulator，可通过 --derived-data 指定独立目录；后续 --launch-only 必须使用同一目录。

模拟器构建明确使用 CODE_SIGN_IDENTITY=-、CODE_SIGNING_ALLOWED=YES、空 DEVELOPMENT_TEAM 和 provisioning profile，不申请个人证书或 provisioning。Xcode 会产生正确的模拟器专用 entitlement。不要改成 CODE_SIGNING_ALLOWED=NO：那只能证明编译，实际 Keychain 会报“没有所需的授权”。也不要手工把设备 entitlement 签入模拟器包。应用启动会自动设置 -RCT_jsLocation 127.0.0.1:<端口>，避免 No script URL provided。这是 JS 开发服务器地址，和应用内填写的 DeepTutor 业务服务地址不同。

脚本只接收模拟器 UDID，不接收真机。iOS 真机/Release 仍需使用者自己的签名配置；此源码预览不使用或发布个人签名资料。Keychain 可能跨卸载保留凭据，请先在 App 退出/移除服务，不能把卸载当成可靠的删除操作。

## 虚拟服务的双端接入

Android 模拟器可使用默认回环虚拟服务：`npm run mock`，应用填 http://10.0.2.2:8786。另两端口 8787 为免登录、8788 为第二认证服务。

iOS 模拟器或真实手机使用电脑实际局域网地址。仅在可信网络中，显式监听电脑持有的私有 IP：

```sh
# 替换示例 IP，端口组可以自行选择
npm run mock -- --host 192.168.1.20 --base-port 8792
```

应用填写 http://192.168.1.20:8792，账号 demo、密码 demo-pass。8793 是免登录，8794 是独立认证服务；other 是另一个虚拟账号，密码相同。仅写入虚拟数据，可用 fixtures/fixture.txt 上传；服务退出后内存数据消失。不要转发到公网，测试完成 Ctrl+C。脚本拒绝通配监听和未分配给本机的地址。客户端继续拒绝业务地址 localhost/127.0.0.1，没有为模拟器关闭真实手机的地址检查。

测试替身可在 /__fixture/expire 使虚拟令牌失效，用于检验恢复。它不是 DeepTutor，也不调用模型；真实模型、OCR 与学习闭环须另用隔离测试部署验收。

## 生产构建和公开交付

### 构建 Android 发行包

准备独立发行证书，并长期保管同一份 keystore；后续覆盖升级必须使用相同签名。仓库外的 Properties 文件包含 `storeFile`、`storePassword`、`keyAlias`、`keyPassword`，其中 `storeFile` 指向仓库外 keystore。macOS/Linux 下文件权限设为 `600`：

```sh
chmod 600 /secure/path/release.properties
DTM_SIGNING_PROPERTIES=/secure/path/release.properties \
  npm run release:android -- --output-dir /path/to/release
```

默认构建 `arm64-v8a`；需要另一架构时加 `--arch x86_64`。脚本不安装或上传 APK，会拒绝 debug 签名和可调试包，检查 APK 签名并生成同名 `.apk.json` 收据，记录 SHA-256、架构、versionCode 和签名证书摘要。后续发行可设置 `DTM_EXPECTED_CERT_SHA256` 为已确认的证书摘要，防止误用其他签名。输出目录已有同名文件时会拒绝覆盖。

### 导出 iOS 工程

```sh
npm run export:ios -- --output-dir /path/to/release
```

脚本从公开源码清单重新生成 iOS 工程，导出 `deeptutor-mobile-<版本>-ios-project.zip` 与 `.zip.json` 收据。不带本机的 Pods、`node_modules`、签名、开发团队或本机 Node 路径。接收者按上文运行 `npm ci` 和 `npm run prepare:ios`，再配置自己的签名。

两种发行脚本都设置 `EXPO_NO_DOTENV=1`，清除继承的 `EXPO_PUBLIC_*` 并将默认服务地址置空。Android APK 与 Xcode Release 构建的应用内含 JS，无需 Metro。脚本成功不能代替安装、冷启动、服务接入和签名连续性验收。公开分发仍需核对 [依赖风险](security-review.md)、目标设备及实际附件校验值。

公开构建的 EXPO_PUBLIC_DEFAULT_SERVER 必须为空；该变量会进入客户端，绝不能放令牌。源码隐私检查可接收 SOURCE_PRIVATE_TERMS_JSON 环境变量中的私有禁用词数组；这些词不能写进公开扫描脚本或文档。--history 同时核查全部可达提交及作者/提交者邮箱，要求完整克隆；第三方许可证归属保留。检查通过不代替人工审阅。

```sh
npm run export:source -- --output-dir <交付目录>
```

导出仅包含受检文本源码，附文件清单与 SHA-256，不含 Git 历史、生成工程、截图、安装包、环境文件或私钥；包含用于更新校验的公开证书。

## 原生模块与版本

`npm ci` 会从锁定依赖生成离线公式/图表资源；需要重新生成时运行 `npm run bundle:content`。PDF、分享和更新模块源码位于 `modules/`。根目录的 `android/`、`ios/` 由工具生成，不纳入常规源码包；iOS 工程附件另含生成的 Xcode 工程，不能与纯源码包混用说明。

iOS 分享扩展的 App Group 根据 bundle identifier 生成。真机发行需配置自己的 App Group、证书和 provisioning；模拟器构建通过不能替代真机验证。

本版源码版本为 `0.4.0`，原生基础版本仍为 0.3.2（Android versionCode / iOS buildNumber 6）。本轮按功能与接口测试更新源码，不启动双端设备，不构建新安装包或上传 TestFlight。已公开 Android APK 保持 0.3.3，iOS 工程保持 0.3.2。

### 独立模拟器验收

`python3 scripts/run-ios.py --device SIMULATOR_UDID --configuration Release` 会嵌入程序资源，适合完全关闭后重开验收，不依赖 Metro。默认 Debug 仍用于开发热重载；不能以 Debug 的开发入口代替独立安装验收。

Android 若 Kotlin 编译报告 `OutOfMemoryError: Metaspace`，可以为构建命令设置 `DTM_GRADLE_JVM_ARGS="-Xmx4096m -XX:MaxMetaspaceSize=1024m"`。此设置只影响本机构建，不改变应用运行内存。

### iOS 27 启动兼容

本版通过 Expo SDK 57 官方 `expo-build-properties` 的 `ios.enableSceneSupport` 启用 UIScene。使用 Xcode 27 时不能回退到旧 AppDelegate 启动方式，否则 iOS/iPadOS 27 会在启动时终止应用。

`run-ios.py` 和 `export-ios-project.py` 会检查生成的场景配置及工厂协议。归档或导出后还需核对实际 `.app`：

```sh
python3 scripts/ios_startup.py --app /path/to/DeepTutor.app
```

此检查防止缺配置，不能代替 iOS/iPadOS 27 上的 Release 冷启动、后台恢复、深链/分享唤起和更新后重启测试。0.3.2 修改原生启动环境，需要重新安装应用；不能将新 iOS OTA 强制推给旧 runtime。

参考：[Expo SDK 57 场景迁移说明](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27)。
