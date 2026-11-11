# 原生客户端功能对应核查

核查基线：官方 [DeepTutor v1.7.1](https://github.com/HKUDS/DeepTutor/tree/v1.7.1)，提交 `f7aed0744c36c5afef16a4261c31ebee1208cac2`。首次核查：2026-11-02；v1.7.1 差异补齐：2026-11-08。

结论：客户端目前不是完整功能等价版。下面覆盖官方仓库的 63 个 page.tsx 路由文件，并对照原生实现和模型调用链；这是源码与接口核查，不代表每个页面的每个按钮都已完成运行验收。路由存在、构建通过或模拟接口返回成功，都不能单独作为功能完成证明。

## v1.7.2 增量核查

2026-11-11 补充 [1.7.2 差异对应](upstream-1.7.2.md)：选段朗读、模型自动发现/批量导入、精通学习开始前选模型和个人模型扩展兼容。下方 63 路由清单仍是 1.7.1 的历史全量核查，本轮只对新增变化核对，不能宣称所有旧缺口已补齐。

## v1.7.1 本轮补齐

详见 [v1.7.1 差异对应](upstream-1.7.1.md)。新增账号改密及自动登录凭据同步、账号字号/行距、聊天及学习创建草稿、保留历史分支的编辑重问、单独追问来源管理、生成文件查看/分享、Anki 闪卡导出。仍不能把本轮差异适配称为全部 63 路由功能等价。

## 既有模型调用链

- 对话输入区 → 切换模型 → 读取服务端模型列表 → 新一轮 `start_turn.llm_selection` 提交真实 profile/model ID；恢复历史时读取 preferences.llm_selection。
- 切回默认时重新查询并发送具体默认 ID，避免官方服务端将 null 解释为沿用历史选择。
- 普通账号：我的 → 模型与密钥 → 填写/替换自己的 API Key → 获取模型列表/手动填写 → 保存 → 对话切换。使用本仓库可选服务端扩展，官方 1.7.1 / 1.7.2 原样部署没有本客户端使用的普通账号 BYOK 接口。
- 部署管理员：原生管理共享服务商、模型、默认选择及后台任务；共享密钥修改仍遵守原有服务器管理员权限。
- 个人接口返回密钥是否存在，不返回明文；更换 API 地址时必须重新输入密钥，空字段保留当前地址已有密钥。
- 个人配置仅涵盖对话 LLM。向量、搜索、语音、图片/视频生成仍依赖部署端配置；不能宣称个人对话 Key 会替代这些服务。

## 官方页面逐项对应

| 官方路径 | 当前状态 | 原生实现 | 边界/缺口 |
| --- | --- | --- | --- |
| `/admin/users` | 缺少对应入口 | — | 需实现并验收 |
| `/login` | 已有原生对应 | `src/app/login.tsx; src/lib/auth.tsx` | 账号登录与恢复；本次Android覆盖安装保留VPS登录 |
| `/register` | 缺少对应入口 | — | 当前客户端只有登录；是否开放注册由服务器决定 |
| `/settings/[section]` | 部分对应 | `src/app/(tabs)/me.tsx; src/features/models.tsx; src/features/workspaces.tsx` | 设置子页逐项见下表 |
| `/settings` | 部分对应 | `src/app/(tabs)/me.tsx; src/features/models.tsx; src/features/workspaces.tsx` | 设置子页逐项见下表 |
| `/agents` | 缺少对应入口 | — | 需实现并验收 |
| `/avatar-preview` | 非学习功能 | — | 官方头像开发预览，不纳入用户功能完成率 |
| `/knowledge-bases/[kbName]` | 部分对应 | `src/features/knowledge.tsx` | 知识库、上传、索引、预览/导出；同步源管理缺口 |
| `/knowledge-bases` | 部分对应 | `src/features/knowledge.tsx` | 知识库、上传、索引、预览/导出；同步源管理缺口 |
| `/memory/graph` | 缺少对应入口 | — | 需实现并验收 |
| `/memory/l1` | 部分对应 | `src/features/memory.tsx` | 分层文档、编辑、整理任务、撤销；全部管理操作待测 |
| `/memory/l2/[surface]` | 部分对应 | `src/features/memory.tsx` | 分层文档、编辑、整理任务、撤销；全部管理操作待测 |
| `/memory/l2` | 部分对应 | `src/features/memory.tsx` | 分层文档、编辑、整理任务、撤销；全部管理操作待测 |
| `/memory/l3/[slot]` | 部分对应 | `src/features/memory.tsx` | 分层文档、编辑、整理任务、撤销；全部管理操作待测 |
| `/memory/l3` | 部分对应 | `src/features/memory.tsx` | 分层文档、编辑、整理任务、撤销；全部管理操作待测 |
| `/memory` | 部分对应 | `src/features/memory.tsx` | 分层文档、编辑、整理任务、撤销；全部管理操作待测 |
| `/memory/resolve` | 缺少对应入口 | — | 需实现并验收 |
| `/notebooks/[notebookId]` | 部分对应 | `src/features/notebooks.tsx` | 收藏夹/记录编辑移动导出有实现；全部批量与附件场景待测 |
| `/notebooks` | 部分对应 | `src/features/notebooks.tsx` | 收藏夹/记录编辑移动导出有实现；全部批量与附件场景待测 |
| `/personalization` | 缺少对应入口 | — | 账户资料、偏好完整编辑未对应 |
| `/profile` | 部分对应 | `src/features/profile.tsx` | 账号信息、改密、初始密码提示及已授权学习资料编辑；头像及完整偏好编辑仍有缺口 |
| `/session-handoff` | 缺少对应入口 | — | 设备授权交接流程未对应 |
| `/settings/progress` | 部分对应 | `src/app/(tabs)/me.tsx; src/features/models.tsx; src/features/workspaces.tsx` | 设置子页逐项见下表 |
| `/space/chat-history` | 部分对应 | `src/app/chat/[id].tsx; src/app/history.tsx` | 模型切换、草稿、编辑分支与单独追问来源有对应；缺少按会话指定 skills/MCP、完整归档操作 |
| `/space/cli-apps` | 缺少对应入口 | — | 需实现并验收 |
| `/space/journal` | 缺少对应入口 | — | 需实现并验收 |
| `/space/mcp` | 缺少对应入口 | — | 需实现并验收 |
| `/space` | 部分对应 | `src/app/(tabs)/me.tsx; src/app/modules.tsx` | 不能把个人空间的全部工具管理视为已支持 |
| `/space/personas` | 缺少对应入口 | — | 需实现并验收 |
| `/space/questions` | 部分对应 | `src/app/(tabs)/mistakes.tsx; src/app/question/[id].tsx` | 错题列表、编辑、复习对话；全部筛选/批量管理未逐项实测 |
| `/space/skills` | 缺少对应入口 | — | 需实现并验收 |
| `/calendar` | 部分对应 | `src/features/calendar.tsx` | 事件、分类、重复、ICS导出；系统通知未实现 |
| `/chat/[sessionId]` | 部分对应 | `src/app/chat/[id].tsx; src/app/history.tsx` | 模型切换、草稿、编辑分支与单独追问来源有对应；缺少按会话指定 skills/MCP、完整归档操作 |
| `/chat` | 部分对应 | `src/app/chat/[id].tsx; src/app/history.tsx` | 模型切换、草稿、编辑分支与单独追问来源有对应；缺少按会话指定 skills/MCP、完整归档操作 |
| `/co-writer/[docId]` | 部分对应 | `src/features/writing.tsx` | 文档块、建议、Word与Anki导出；锚点讨论及部分评审卡片缺口 |
| `/co-writer` | 部分对应 | `src/features/writing.tsx` | 文档块、建议、Word与Anki导出；锚点讨论及部分评审卡片缺口 |
| `/kanban` | 缺少对应入口 | — | 需实现并验收 |
| `/learning/books/[bookId]` | 部分对应 | `src/features/books.tsx` | 生成、页块编辑、题卡、导出有实现；全部块类型/生成组合未逐项实测 |
| `/learning/books/[bookId]/pages/[pageId]` | 部分对应 | `src/features/books.tsx` | 生成、页块编辑、题卡、导出有实现；全部块类型/生成组合未逐项实测 |
| `/learning/books` | 部分对应 | `src/features/books.tsx` | 生成、页块编辑、题卡、导出有实现；全部块类型/生成组合未逐项实测 |
| `/learning/mastery/[pathId]` | 部分对应 | `src/features/mastery.tsx` | 规划、学习、复习、反馈有实现；手工图谱编辑缺口 |
| `/learning/mastery/[pathId]/sessions/[sessionId]` | 部分对应 | `src/features/mastery.tsx` | 规划、学习、复习、反馈有实现；手工图谱编辑缺口 |
| `/learning/mastery/[pathId]/sessions` | 部分对应 | `src/features/mastery.tsx` | 规划、学习、复习、反馈有实现；手工图谱编辑缺口 |
| `/learning/mastery` | 部分对应 | `src/features/mastery.tsx` | 规划、学习、复习、反馈有实现；手工图谱编辑缺口 |
| `/learning/new` | 部分对应 | `src/app/(tabs)/index.tsx; src/features/capabilities.tsx` | 原生学习首页与能力入口，非官方首页布局复制 |
| `/learning` | 部分对应 | `src/app/(tabs)/index.tsx; src/features/capabilities.tsx` | 原生学习首页与能力入口，非官方首页布局复制 |
| `/learning/practice` | 部分对应 | `src/app/(tabs)/mistakes.tsx; src/app/question/[id].tsx` | 错题列表、编辑、复习对话；全部筛选/批量管理未逐项实测 |
| `/learning/reading/[workspaceId]` | 部分对应 | `src/features/reading.tsx` | 导入、阅读、标注、书签、提问、导出有实现；完整工具栏与逐操作回归待补 |
| `/learning/reading/[workspaceId]/sessions/[sessionId]` | 部分对应 | `src/features/reading.tsx` | 导入、阅读、标注、书签、提问、导出有实现；完整工具栏与逐操作回归待补 |
| `/learning/reading/[workspaceId]/sessions` | 部分对应 | `src/features/reading.tsx` | 导入、阅读、标注、书签、提问、导出有实现；完整工具栏与逐操作回归待补 |
| `/learning/reading/folders/[folderId]` | 部分对应 | `src/features/reading.tsx` | 导入、阅读、标注、书签、提问、导出有实现；完整工具栏与逐操作回归待补 |
| `/learning/reading/materials` | 部分对应 | `src/features/reading.tsx` | 导入、阅读、标注、书签、提问、导出有实现；完整工具栏与逐操作回归待补 |
| `/learning/reading` | 部分对应 | `src/features/reading.tsx` | 导入、阅读、标注、书签、提问、导出有实现；完整工具栏与逐操作回归待补 |
| `/learning/watching/[sessionId]` | 部分对应 | `src/features/reading.tsx` | 官方 watching 首页重定向到阅读；不按独立功能计数 |
| `/learning/watching` | 部分对应 | `src/features/reading.tsx` | 官方 watching 首页重定向到阅读；不按独立功能计数 |
| `/` | 部分对应 | `src/app/(tabs)/index.tsx; src/features/capabilities.tsx` | 原生学习首页与能力入口，非官方首页布局复制 |
| `/partners/[partnerId]` | 部分对应 | `src/features/partners.tsx` | 创建、启停、对话历史；外部渠道接入缺口 |
| `/partners/groups/[groupId]` | 缺少对应入口 | — | 需实现并验收 |
| `/partners/groups/new` | 缺少对应入口 | — | 需实现并验收 |
| `/partners/new` | 部分对应 | `src/features/partners.tsx` | 创建、启停、对话历史；外部渠道接入缺口 |
| `/partners` | 部分对应 | `src/features/partners.tsx` | 创建、启停、对话历史；外部渠道接入缺口 |
| `/whisper` | 缺少对应入口 | — | 需实现并验收 |
| `/handoff` | 缺少对应入口 | — | 设备授权交接流程未对应 |

## 设置页不能只按一个“设置入口”计为完成

依据：[官方设置导航](https://github.com/HKUDS/DeepTutor/blob/v1.7.1/web/features/settings/navigation/settings-pages.ts)。

| 设置 | 当前对应情况 |
| --- | --- |
| 服务商、LLM、后台任务 | 本次新增原生编辑；模型发现/密钥替换/选择有对应调用。普通账号使用个人 LLM 扩展。OAuth 登录、完整推理参数、批量配置导入导出仍未对应。 |
| 向量、搜索、语音、多模态 | 管理员有模型服务编辑；搜索配置创建/编辑、多模态专属完整参数、语音自动播放偏好未全部对应。 |
| 工作区 | 原生切换、创建、编辑、归档有实现，账号与服务隔离保留。 |
| 常规、外观、资料、用量 | 中文原生界面；字号/行距、密码及授权学习资料有对应。用量统计、头像及完整偏好仍缺入口。 |
| 对话建议、附件上限、视频学习、学习者资料、学习进度 | 有相关学习界面，但对应设置管理未齐。 |
| Guardian 家长控制 | 未移植；客户端使用服务端账号登录。 |
| 记忆 | 分层文档与任务有对应，记忆策略设置未齐。 |
| 工具、能力管理、伙伴/智能体、知识与文档 | 能力选用及部分资源管理有实现；启禁工具、MCP、技能、CLI 应用、解析器/同步源管理缺口。 |
| 网络、系统状态、关于 | 连接配置与客户端更新有对应；服务器诊断/网络参数未齐。 |
| 数据迁移、已归档聊天 | 无完整原生对应。 |

## 验收与后续门槛

本次新增测试检查：真实模型 ID 提交、默认选择覆盖历史、个人接口不存在时兼容回退、鉴权失败不伪装成功、密钥留空保留/替换、不同账号隔离、删除默认模型后修正引用、运行时解析读取新 Key。Android 与授权测试部署的结果见[验证记录](validation.md)。其他模块本轮未重新跑完整学习闭环，不能继承为“全部通过”。

2026-11-11 起，GitHub 源码更新按维护者要求使用功能与接口测试作为门槛，另须通过类型、Lint 和隐私检查；暂停本机 Android/iOS 测试。真实 VPS、设备交互、真实推理、安装包和 OTA 验证各自记录，不用接口测试替代这些结果，也不生成未执行的设备验收记录。更新源仍为本客户端仓库。
