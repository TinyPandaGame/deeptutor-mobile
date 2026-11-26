# 客户端版本规则

从 `v0.3.1` 起统一使用纯数字 `vX.Y.Z`，不再增加 preview 后缀。

- 客户端修复、小功能和少量上游兼容适配：`Z + 1`。即使上游版本号有变化，也可沿用这个规则。
- 上游新版本给客户端带来明显的功能扩展，且适配和验证完成后：`Y + 1`，`Z = 0`。
- `X` 保持不变；产品大版本另行决定。
- 官方新增提交、检查到更新、重新构建同一版本，不自动增加客户端版本。仍先适配、测试，再发布到本客户端仓库。

当前版本为 `0.4.7`，以官方 `1.7.4` 为适配目标，包含 `1.7.3` 的移动端功能增量和此前准备的「进行中」。旧版接口的兼容范围见[兼容说明](compatibility.md)。公开 Android 安装包为 `0.4.7`，iOS 工程为 `0.3.2`。

普通补丁用 `node scripts/bump-version.mjs fix`。补丁同时跟进已验证的上游时，用 `node scripts/bump-version.mjs fix X.Y.Z`，其中 `X.Y.Z` 填上游版本。适配较大的上游功能更新时，用 `node scripts/bump-version.mjs upstream X.Y.Z`。命令同步 package 与 lockfile，`package.json` 的 `deeptutorCompatibility` 单独记录适配的官方版本。

客户端展示和 GitHub/OTA 使用 package 版本。原生基础版本与构建号只在需要新原生运行环境时调整；单纯 JavaScript 修复保持原生指纹，以便已有安装包收到兼容 OTA。不能修改指纹规则来强行让不兼容安装包热更。新原生环境需要全量安装包，iOS 自行签名的安装需分别核对 runtime。
