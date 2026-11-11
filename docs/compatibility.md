# 兼容范围与上游依据

当前源码目标：**HKUDS/DeepTutor v1.7.2**，tag 对应 commit `60fb3bdfddb30b7740c7ce3bd9b28d908f2af6db`。客户端 0.4.0 的增量对照见 [v1.7.2 差异对应](upstream-1.7.2.md)。1.7.1 的个人模型、语音和 registry 合并接口也保留实际官方包回归；历史核对见 [v1.7.1](upstream-1.7.1.md)。1.7.0 / 更旧版本、未来版本和第三方修改版不自动纳入支持范围。

客户端探测认证状态的字段结构；它没有公开、稳定、免权限的上游版本协商接口，**不会把状态探测通过说成已自动确认服务版本**。请管理员确认安装的是该版本。功能模块可选安装；若服务没有相应模块，客户端显示错误或保留入口，不承诺缺失功能可用。

| 能力 | 已核对的上游契约 | 当前客户端范围 |
| --- | --- | --- |
| 认证探测 | `GET /api/auth/status`: enabled, authenticated, user_id, username, role | 缺字段拒绝连接；200 + authenticated=false 也会触发续期 |
| 单用户 | enabled=false, authenticated=true, user_id=local-admin | 私有网入口免登录；不伪造账号或发送登录请求 |
| 账号登录 | `POST /api/auth/login`, JSON username/password；用户信息 + HttpOnly dt_token Cookie | 安全存储；原生使用 Bearer；内联内容画布不接收凭据 |
| HTTP / WS 认证 | REST 使用 Bearer；WebSocket 握手使用 dt_token Cookie | 显式传递当前会话，禁用共享 Cookie；仅发送到当前服务 |
| 聊天 | `/ws`, protocol_version=2.0、start_turn、content / result / done / seq | 流式回复、互动题卡、停止与恢复 |
| 学习数据 | `/api/sessions`、question-notebook、reading/materials、notebooks | 客户端页面通过同源 API 操作；错题使用服务端搜索与分页 |
| 资料上传 | multipart file 到 `/api/reading/materials` | 格式由服务端支持列表决定，默认 PDF / DOCX / TXT；上限 25 MB，确认后上传 |
| 原生模块 | reading、books、mastery-paths、notebooks、documents、partners、memory、calendar、workspace 等 API | 以迁移说明列出的实现与限制为准；不打开上游应用网页 |

首版适配内建用户名密码认证。PocketBase 返回形态相似，但未实测，暂不列为已支持；设备凭据、session-handoff、OAuth-only、外部登录网关未适配。需要改密或管理员限制时在服务允许的网页操作；客户端不绕过服务端策略。

普通账号的个人 API Key 管理由本仓库[可选服务端扩展](../server/README.md)提供，不是官方 1.7.1 / 1.7.2 原样部署的内置接口。扩展严格检查上游版本；未安装时，模型选择回退到官方已授权模型列表。

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
