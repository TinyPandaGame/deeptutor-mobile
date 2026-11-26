# 兼容范围与上游依据

0.4.7 的源码适配目标为官方 [DeepTutor v1.7.4](https://github.com/HKUDS/DeepTutor/tree/v1.7.4)，包含 [v1.7.3](https://github.com/HKUDS/DeepTutor/releases/tag/v1.7.3) 的学习功能增量。历史客户端 0.4.5 以 [v1.7.2](upstream-1.7.2.md) 为目标，1.7.1 的兼容记录见 [v1.7.1](upstream-1.7.1.md)。

客户端探测认证状态的字段结构；它没有公开、稳定、免权限的上游版本协商接口，**不会把状态探测通过说成已自动确认服务版本**。请管理员确认安装的是该版本。功能模块可选安装；若服务没有相应模块，客户端显示错误或保留入口，不承诺缺失功能可用。

| 能力 | 已核对的上游契约 | 当前客户端范围 |
| --- | --- | --- |
| 认证探测 | `GET /api/auth/status`: enabled, authenticated, user_id, username, role | 缺字段拒绝连接；200 + authenticated=false 也会触发续期 |
| 单用户 | enabled=false, authenticated=true, user_id=local-admin | 私有网入口免登录；不伪造账号或发送登录请求 |
| 账号登录 | `POST /api/auth/login`, JSON username/password；用户信息 + HttpOnly dt_token Cookie | 安全存储；原生使用 Bearer；内联内容画布不接收凭据 |
| HTTP / WS 认证 | REST 使用 Bearer；WebSocket 握手使用 dt_token Cookie | 显式传递当前会话，禁用共享 Cookie；仅发送到当前服务 |
| 聊天 | `/ws`, protocol_version=2.0、start_turn、content / result / done / seq | 流式回复、互动题卡、停止与恢复 |
| 进行中 | `/api/sessions` 的 `status` / `active_turn_id`，会话详情的 `active_turns`，`/ws` 的 subscribe_turn、submit_user_reply、cancel_turn | 同一服务、账号及工作区接续电脑发起的任务；回到前台或网络恢复后读取原会话并补读事件 |
| 拍照录题 | 复用模型列表和 `/ws` 图片附件，随后 `/api/question-notebook/entries/upsert` | 提取→校对→确认保存；原图独立上传给错题记录。需要可用的图片输入模型，不是离线 OCR；不新增服务器接口 |
| 学习数据 | `/api/sessions`、question-notebook、reading/materials、notebooks | 客户端页面通过同源 API 操作；错题使用服务端搜索与分页 |
| 资料上传 | multipart file 到 `/api/reading/materials` | 格式由服务端支持列表决定，默认 PDF / DOCX / TXT；上限 25 MB，确认后上传 |
| 原生模块 | reading、books、mastery-paths、notebooks、documents、partners、memory、calendar、workspace 等 API | 以迁移说明列出的实现与限制为准；不打开上游应用网页 |

首版适配内建用户名密码认证。PocketBase 返回形态相似，但未实测，暂不列为已支持；设备凭据、session-handoff、OAuth-only、外部登录网关未适配。需要改密或管理员限制时在服务允许的网页操作；客户端不绕过服务端策略。

普通账号的个人 API Key 管理由本仓库[可选服务端扩展](../server/README.md)提供，不是官方 1.7.1 / 1.7.2 原样部署的内置接口。扩展严格检查上游版本；未安装时，模型选择回退到官方已授权模型列表。

2026-11-22 已验证服务端扩展在官方 **1.7.4** 上的个人模型、会话删除、错题照片保留及拍照录题协议，并验证由 1.7.1 创建的合成数据可由 1.7.4 读取。一个现有实例升级后也通过生产 HTTPS 登录、模型识图、错题保存及删除聊天保留照片的接口实测，详见[服务端验证](../server/README.md#174-服务端兼容验证2026-11-22)。

「进行中」已在官方 **1.7.4** 实例上用合成对话完成双连接接口验收。电脑连接发起，手机连接断线重订阅并补答，双方收到同一终态和持久结果。停止操作也在两个连接得到同一状态。客户端断线期间，主机仍在线时可恢复任务。此次未做设备界面验收。

0.4.7 新增按模型能力选择推理强度、新对话继承工作区知识库、精通学习题库搜索与分页、教材章节与小节的修改预览和撤销，以及阅读页测验、逐题提示、服务端判分和 PDF 原页全屏。书籍编辑、阅读测验会探测服务接口。推理强度需服务端支持该请求字段、所选模型支持该档位。知识库默认引用由当前工作区的服务决定。阅读家长报告仍需官方界面与已有权限。

## 官方源码依据

- [auth.py，v1.7.1](https://github.com/HKUDS/DeepTutor/blob/v1.7.1/deeptutor/api/routers/auth.py)：状态、登录、Bearer 与 Cookie 优先级、免登录身份、私有入口限制。
- [web/proxy.ts，v1.7.1](https://github.com/HKUDS/DeepTutor/blob/v1.7.1/web/proxy.ts)：前端同源 API/WS 代理与页面登录跳转。
- [web/next.config.js，v1.7.1](https://github.com/HKUDS/DeepTutor/blob/v1.7.1/web/next.config.js)：前后端地址、配置来源与局域网开发来源。
- [sessions.py](https://github.com/HKUDS/DeepTutor/blob/v1.7.1/deeptutor/api/routers/sessions.py)、[reading.py](https://github.com/HKUDS/DeepTutor/blob/v1.7.1/deeptutor/api/routers/reading.py)、[question_notebook.py](https://github.com/HKUDS/DeepTutor/blob/v1.7.1/deeptutor/api/routers/question_notebook.py)、[notebook.py](https://github.com/HKUDS/DeepTutor/blob/v1.7.1/deeptutor/api/routers/notebook.py)：列表/详情/上传/错题写入响应结构。
- [turn_protocol.py](https://github.com/HKUDS/DeepTutor/blob/v1.7.1/deeptutor/api/contracts/turn_protocol.py)：v2 start_turn、seq 和流式事件类型。
- [API main.py](https://github.com/HKUDS/DeepTutor/blob/v1.7.1/deeptutor/api/main.py)：健康端点不等于应用版本协商。
- [Expo SDK 57 fetch](https://docs.expo.dev/versions/v57.0.0/sdk/expo/#expofetch-api)、[SecureStore](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/)、[FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/)：使用当前 SDK API；copy 是异步操作。
- [Apple NSAllowsLocalNetworking](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking)、[Android 网络安全配置](https://developer.android.com/privacy-and-security/security-config)：平台权限与 HTTP 边界。

源码核对、自动测试、手机交互和真实部署测试是不同层次；实际完成的层次见 `validation.md`。写入测试仅使用虚拟账号与虚拟数据。
