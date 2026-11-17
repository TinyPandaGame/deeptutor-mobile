# 客户端更新

**APK 和 iOS 工程的发布不代表已下发 OTA；每个平台仍须有单独通过验收的签名清单。** 下述自动更新需要包含 `LearningUpdates` 的新基础包；旧安装包不能通过 JS 更新补装原生模块。

客户端只读取 `TinyPandaGame/deeptutor-mobile` 的 GitHub Releases。DeepTutor 官方更新先经过我们的适配与测试，再形成客户端发行版本；不会直接消费官方仓库、主分支提交或草稿。

0.4.5 提供完整 Android APK，原生基础仍为包含 Expo Clipboard 的 0.4.1。本次没有 0.4.5 OTA 清单，旧版请进入“我的 → 应用更新”下载安装包。iOS 工程仍为 0.3.2。

## 使用方式

- 从 0.4.2 起，每次冷启动及返回前台都会检查本客户端仓库；并发检查合并。进入更新页会复用最近一分钟的结果，也可点“检查新版本”立即重查。
- 发现新版本先弹窗，选择“去下载”才开始下载；“稍后”或关闭弹窗均不下载。同一次运行中，同一版本和安装方式只主动提示一次；下次冷启动仍会提醒。后台检查完成时，等应用回到前台再提示。
- 热更新与完整 APK 使用同一份版本信息。兼容签名清单在确认后下载、验证；需要完整包时打开对应 GitHub 发布页，下载后由系统确认安装。只有源码、没有适用安装包的版本只提供说明，不伪装成可安装更新。
- 下载成功后提示“新版本已下载，重新打开应用后生效”；可主动重启，也可稍后关闭并重新打开。
- “我的 → 应用更新”顶部为新版本和下载入口，下面为当前版本、更新说明；跳过弹窗仍保留下载入口。默认自动检查，不再展示自动更新设置或预览版开关。更新失败可重试，继续使用当前版本，不清理账号或学习数据。
- 原生依赖、权限、分享扩展等改变会生成不同 runtime fingerprint，需要新的 APK / iOS 构建；不会向旧运行时加载不兼容的 JS。

## GitHub 直接分发

版本、签名清单、JS 和资源均来自我们的 GitHub Releases，无需 VPS 更新接口、EAS 托管账号或在客户端保存 GitHub 令牌。学习服务器仍是用户自行选择的 DeepTutor 服务，与客户端更新完全分开。

`expo-updates` 的原生加载器要求 Expo 协议响应头，普通 GitHub 文件下载不提供这些头。本项目的 `LearningUpdates` 原生模块仅在本机回环地址运行一个只读协议适配器：JS 读取本仓库发行信息，选择平台及 runtime 匹配的签名清单，适配器将原始签名字节交给 Expo。资源仍直接从 GitHub 下载。适配器不接受局域网连接，不拥有学习账号，不安装代码；最终签名、资源哈希和运行时校验由 Expo 原生加载器执行。

保留 Expo 的嵌入版本、启动回退及防损坏保护。没有打开 `disableAntiBrickingMeasures`，也没有运行时更换更新源。回环端口被占用、检查失败、签名不符或下载失败时，本次更新失败，继续使用原版本。

## 发布约定

版本按[客户端版本规则](versioning.md)管理：同一官方版本上的修复只增加 Z，适配新的官方发布增加 Y 并将 Z 归零。`v0.3.1` 起不再使用 preview 后缀；仍兼容识别历史预览版本的升级顺序。

1. 使用同一份锁定依赖、原生配置及公开证书构建基础包和导出资源。`fingerprint.config.js` 只忽略 JS 可见的 extra 发行元数据，保留原生依赖、插件、签名、权限等变化。
2. 导出对应平台的生产 bundle；`scripts/ota-package.mjs` 的 `prepareCandidate` 生成候选清单与内容哈希资源，不发布。清单资源地址固定为本仓库目标 Release。
3. 在相同 runtime 的独立安装包验证签名拒绝、下载、重启生效和学习流程，保存对应候选 SHA256 / updateId / runtime 的验收记录；不能用 mock 成功冒充真机链路通过。
4. `sealCandidate` 只接受匹配候选摘要且通过单测、原生下载、冷重启和学习回归的验收记录，使用仓库外私钥签名。私钥不能进入源码、Git 历史、安装包或公开附件。公开证书在 `modules/learning-updates/ota-certificate.pem`，更换它需要新基础包。
5. 先上传资源，最后上传 `ota-<platform>-<runtime>.json`，全部齐备后发布 Release。草稿不下发，正式客户端忽略预发布；预览客户端可接收预览版本。每次使用新标签，不覆盖已发布代码。只发源码、不含匹配签名清单的 Release 不会触发 OTA。

公开资源须通过隐私检查及对应候选的端到端验收。Android 和 iOS 分别验证，编译成功不能代替更新下载与重启测试。

### 打包命令

先导出生产资源及公开配置，再准备候选。`RUNTIME` 必须来自目标安装包实际构建的 fingerprint，不能猜测或沿用旧基础包的值；`VERSION` 与目标 Release 标签去掉 `v` 后一致。

```sh
node node_modules/expo/bin/cli export --platform android --output-dir /path/to/export
node node_modules/expo/bin/cli config --type public --json > /path/to/public-config.json
node --experimental-strip-types scripts/ota-release.mjs prepare \
  --export /path/to/export --config /path/to/public-config.json \
  --platform android --runtime RUNTIME --version VERSION --output /path/to/candidate
```

命令返回候选路径、SHA256（base64url）和 updateId。测试工具可用仓库外私钥签名候选进行隔离验证，但测试包与未验收记录不得直接发布。验收记录必须绑定同一候选的 `candidateSha256`、`updateId`、`platform`、`runtimeVersion`，并记录 `unitTests`、`nativeDownload`、`coldRestart`、`learningSmoke`、`result` 的真实结果；只有全部为 `passed` 才能封装发布清单。

```sh
node --experimental-strip-types scripts/ota-release.mjs seal \
  --candidate /path/to/candidate/candidate-android-RUNTIME.json \
  --evidence /path/to/acceptance.json --private-key /private/path/signing-key.pem \
  --certificate modules/learning-updates/ota-certificate.pem --output /path/to/release
```

将候选目录中 `ota-*.hbc` 和其他哈希资源与封装后的 `ota-android-RUNTIME.json` 附到同一个 Release；不要上传验收记录、未签名候选、配置文件或私钥。iOS 按相同过程单独导出、验收，不能沿用 Android 记录。本机替代分发接口的测试证明原生链路可用，但不能当作公开 GitHub 附件下载已验收。

## 当前验证状态

### 0.4.5 Android 完整包

APK 内置客户端版本为 0.4.5，原生基础保持 0.4.1（versionCode 7），实际运行时为 `2e94cfc54c5038f49c20a19f01da74551475bb4a`，与上一版及编译后重算结果一致。正式签名、内置代码、默认服务为空和更新证书检查通过。本轮只提供源码与完整 APK，未签发 OTA，iOS 与 TestFlight 不变；未进行设备相机、裁剪、安装或 OTA 下载重启验收。

### 0.4.4 Android 完整包

APK 内置客户端版本为 0.4.4，原生基础保持 0.4.1（versionCode 7），实际运行时为 `2e94cfc54c5038f49c20a19f01da74551475bb4a`，与上一版及编译后重算结果一致。正式签名、内置代码、默认服务为空和更新证书检查通过。本轮只提供源码与完整 APK，未签发 OTA，iOS 与 TestFlight 不变；未进行设备安装、长按手势、系统菜单或 OTA 下载重启验收。

### 0.4.3 Android 完整包

APK 内置客户端版本为 0.4.3，原生基础保持 0.4.1（versionCode 7），实际运行时仍为 `2e94cfc54c5038f49c20a19f01da74551475bb4a`，与编译后重算结果一致。正式签名、内置代码与包配置检查通过；本轮只提供源码与完整 APK，未签发 OTA，也未操作 iOS 或 TestFlight。未进行设备安装、键盘、手势、布局或 OTA 下载重启验收。

### 0.4.2 Android 完整包

更新提示、跳过后页面入口、按用户确认下载、最新 APK 提醒、前后台检查和失败重试已完成逻辑回归。实际页面函数与按钮回调也在 Node 替身环境验证；这不代表设备上的系统弹窗、浏览器安装或原生下载重启已验收。

APK 内置客户端版本为 0.4.2，原生基础保持 0.4.1（versionCode 7），实际运行时仍为 `2e94cfc54c5038f49c20a19f01da74551475bb4a`，与编译后重算结果一致。正式签名、内置代码和包配置检查通过；本轮只提供源码与完整 APK，未签发 OTA，也未操作 iOS 或 TestFlight。运行时一致不能代替 OTA 下载重启验收。

### 0.4.1 Android 完整包

APK 原生版本为 0.4.1（versionCode 7），实际运行时为 `2e94cfc54c5038f49c20a19f01da74551475bb4a`，与编译完成后 Expo 计算的指纹一致。新增 Expo Clipboard 原生模块，旧安装必须下载完整 APK 升级。本次仅发布源码与 APK，没有 0.4.1 OTA 清单；iOS 工程仍为 0.3.2。

构建、正式签名、内置代码和包配置检查通过；本轮未进行设备安装、复制粘贴、系统分享或 OTA 下载重启验收。范围见[验证记录](validation.md)。

### 0.3.3 Android

已发布 Android 签名清单。实际公开 0.3.2 APK 已通过 GitHub 查询、下载、界面重启和完全冷启动，登录与预置草稿保留；更新后合成问答、讲解预设、公式及小屏键盘布局正常。独立候选基线另验证了错误签名拒绝，全部 33 份发行附件通过匿名下载、大小和 SHA256 核对。iOS 继续使用 0.3.2，本轮没有新的 iOS 包或清单。

0.3.3 APK 的原生基础版本仍为 0.3.2(6)，实际运行时为 `66ecc37c4e0b22b883e01766caf65abb6a4d6f2b`。它与公开 0.3.2 APK 的 `c2c10c26188be805c9fa1a41b7337f0ad136b303` 不同：旧构建的依赖目录路径及编译期间的临时文件参与了指纹计算。本轮锁定依赖、原生配置、插件和模块与 0.3.2 一致，清单只在旧 `c2c10c…` 安装包独立验收后发布；未修改安装包指纹或关闭校验。

公开 0.3.2 APK 可自动更新到 0.3.3；其他旧运行时或自行构建的安装，须下载正式 APK 覆盖安装。新 APK 已内置 0.3.3，不重复下载同版本 OTA。本轮没有为 iOS 下发 0.3.3，测试范围限 Android 模拟器和合成服务，不代表实体设备或真实模型推理已验收。

### 0.3.2 基础包

`0.3.2` 修复 iOS 27 原生启动配置，双端基础版本升级为 0.3.2(6)，运行时均与下方 0.3.1 基线不同。**本次先更新完整 APK，或下载新 iOS 工程重新构建、签名、安装；OTA 不能补齐旧 iOS 包缺失的场景启动配置。** 新基础包继续按平台和实际 runtime 接收兼容更新，已发布的签名清单以 Release 附件为准。

### 0.3.2 升级验收

2026-11-09 已发布双端签名清单。两端模拟器分别通过错误签名拒绝、公开 GitHub 查询与下载、界面重启及完全冷启动；重启前准备的合成账号登录和草稿保留，更新后合成聊天、公式和列表显示正常。65 份发行附件均通过匿名下载、大小和 SHA256 校验。

本轮使用 **0.3.2(6) 原生包配合较旧 JS 版本标签**的临时测试基线，以验证相同运行时的完整更新链路。下载在登录与草稿建立前自动完成，建立状态后再确认重启。公开 0.3.1 原生包的运行时不同，仍须完整升级。测试基线不作为发行附件。

| 平台 | 0.3.2 清单对应的 runtime |
| --- | --- |
| Android | `c2c10c26188be805c9fa1a41b7337f0ad136b303` |
| iOS | `99b1a7356ed66e21a6b0259d12107ce5fa20aae9` |

Android 原生下载与重启日志、iOS 更新数据库均核对了对应候选 ID；iOS 候选无失败启动记录。旧运行时、未知运行时和已是 0.3.2 的安装不会接收本次 OTA。自签 iOS 工程仍须匹配实际运行时。

### 0.3.1 历史升级验收

`0.3.1` 已发布双端签名清单，2026-11-09 完成公开升级验收。Android 使用实际公开的 preview.4 APK，iOS 使用原 preview.4 Release 模拟器构建；两端均首次通过真实 GitHub 版本查询、清单读取和资源下载，界面重启及完全冷启动后进入 0.3.1，登录与预置草稿保留，原生记录中的候选 ID 一致。

签名前，同 runtime 独立测试基线还验证了错误签名拒绝、正确下载、重启，以及升级后的合成照片问答、原图/历史图片查看、公式与列表排版。测试使用合成服务，未将固定回复计为真实模型推理。

| 平台 | 清单对应的 runtime |
| --- | --- |
| Android | `660f96d42a49181f68a6ce46138eb863a1bcaf7b` |
| iOS | `37432659d1f76459bacdd6410f3c4da64ea5c62d` |

公开 preview.4 Android APK 可接收本次 OTA。**公开 preview.3 Android 安装包的 runtime 不同，需安装新版 APK**；自行签名或修改原生配置的 iOS 构建也须匹配 runtime。已安装 0.3.1 的用户不会重复接收同版本更新。

本轮 OTA 验收限模拟器，未验证实体手机拍照、生产更新源断网或真实模型推理；各项独立测试范围见[验证记录](validation.md)。历史本机模拟更新源的 503 测试不代表公开分发断网已验收。

参考：[Expo Updates](https://docs.expo.dev/versions/v57.0.0/sdk/updates/)、[运行时版本](https://docs.expo.dev/eas-update/runtime-versions/)、[GitHub Release 附件](https://docs.github.com/en/rest/releases/assets)。
