# DeepTutor Mobile

**在手机上使用你自己的 DeepTutor。**

DeepTutor 的非官方 Android / iOS 客户端，支持拍照提问、资料阅读和错题整理。界面为简体中文，当前 0.4.4 适配 DeepTutor 1.7.2，并对 1.7.1 保留接口回归；需连接自己部署的服务。

## 下载与安装

Android [0.4.4](https://github.com/TinyPandaGame/deeptutor-mobile/releases/tag/v0.4.4) 支持长按消息操作、答题后收录错题，以及保留错题照片的对话删除。旧版可从“我的 → 应用更新”下载完整 APK；本次不提供热更新，详见[发行说明](docs/releases/0.4.4.md)。

| 平台 | 下载 | 安装方式 |
| --- | --- | --- |
| Android | [0.4.4 APK（arm64）](https://github.com/TinyPandaGame/deeptutor-mobile/releases/download/v0.4.4/deeptutor-mobile-0.4.4-arm64-v8a.apk) | 下载完整包安装，沿用原发行签名 |
| iOS | [Xcode 工程 ZIP](https://github.com/TinyPandaGame/deeptutor-mobile/releases/download/v0.3.2/deeptutor-mobile-0.3.2-ios-project.zip) | 在 Mac 上自行构建和签名，暂无可直接安装的 IPA |

iOS 环境准备和构建步骤见[构建指南](docs/build.md)。

## 可以做什么

### 拍照提问，继续追问

输入文字或拍照提问，查看讲解、切换模型；编辑问题时保留原对话分支。

### 阅读资料，保存笔记

导入资料、阅读 PDF 和公式图表，收藏内容另存为笔记，也可导出与分享。

### 整理错题，随时复习

校对识别结果后保存错题，支持搜索、编辑和分页查看。

更多模块与支持范围见[功能对应表](docs/feature-coverage.md)，具体能力取决于服务端配置。

## 开始使用

1. 按[电脑接入](docs/connect-computer.md)或[服务器接入](docs/connect-server.md)指南启动 DeepTutor，并保持服务在线。
2. 打开客户端，选择“我的电脑”或“我的服务器”，填写服务地址。
3. 按服务设置登录，开始使用。连接与登录会保存，下次打开自动恢复。

手机连接电脑时请使用电脑的局域网地址，不能填写 `localhost`。公网服务须启用账号认证。

个人 API Key 与保留错题照片的彻底删除需要[服务端扩展](server/README.md)；删除功能要求更新至本版扩展。Key 保存在你连接的服务器上，请连接自己管理或信任的服务。

## 当前状态

0.4.4 提供源码和独立 Android APK，完成自动测试、构建与包检查；本轮未做设备手势、系统菜单、安装或真实模型判题实测。iOS 工程保持 0.3.2，未新增 TestFlight 或 OTA。详细范围及已知问题见[验证记录](docs/validation.md)、[更新说明](docs/updates.md)和[安全审计](docs/security-review.md)。

## 开发与开源

[开发指南](docs/build.md) · [界面与预设设计](docs/mobile-ui.md) · [验收工具](docs/verification-tools.md) · [兼容范围](docs/compatibility.md) · [版本规则](docs/versioning.md) · [问题反馈](https://github.com/TinyPandaGame/deeptutor-mobile/issues)

采用 [Apache-2.0](LICENSE)，基于 [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) 服务接口开发。上游归属及第三方许可见 [NOTICE](NOTICE) 和 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。
