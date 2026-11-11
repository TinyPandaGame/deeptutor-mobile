# 个人模型接口（可选服务端扩展）

验证目标为 **DeepTutor 1.7.1 / 1.7.2**；未知版本仍拒绝加载。普通账号无需提升为管理员，即可填写自己的 API Key、发现模型、保存配置及选择对话模型。未安装扩展时，客户端仍能切换官方 `/api/settings/llm-options` 返回的模型，并明确提示个人配置接口未安装。

## 安装边界

将 `mobile_models` 包放到 DeepTutor 服务进程的 Python 导入路径，在创建 FastAPI `app` 后、启动服务前执行：

```python
from mobile_models import install
install(app)
```

Docker 应使用只读代码挂载或自建镜像，保留既有数据卷和启动配置。先备份入口代码，完成离线测试与启动检查，再重启对应服务；不要覆盖已有 compose 配置。本仓库不包含部署地址、账号、Key、签名材料或学习数据。

扩展对上游个人模型读取函数安装一层兼容适配，保留官方 OAuth 的检查，并在请求作用域内加入当前账号的 API-key 模型。上游版本变更必须先重新验证；版本不匹配时拒绝安装，不能直接跟随官方更新上线。移除初始化调用并重启即可撤回代码，不需迁移学习资料。

## 数据与权限

- 使用官方认证依赖和当前账号上下文。客户端不能指定他人的用户 ID 或共享 provider 引用。
- Key 存于 `data/system/user-secrets/<owner>/mobile-models.json`，位于学习沙箱不挂载的目录，原子写入文件权限为 0600。
- 列表仅返回 `has_key`，不回传 Key。客户端表单在内存使用输入内容，不写入偏好、学习记录或更新配置。
- 空 Key 保留已有 Key；修改 API 地址或服务商必须重填 Key，避免将旧密钥发送到新地址。
- 模型发现不提交推理请求，返回结构化状态，客户端不会把认证失败当作连接成功。
- 个人接口要求公开可达的 HTTP(S) API 地址，拒绝嵌入凭据、查询参数和解析为本地/私网的地址。私网模型部署继续由服务器管理员配置。
- 只扩展个人对话 LLM。知识库向量、搜索、TTS/STT、图像/视频服务仍使用服务器原有配置。部署管理员继续管理共享设置。

地址校验只检查当时的 DNS 结果，不是完整的出站网络隔离。部署时应使用 HTTPS 模型接口并限制服务进程的出站网络，不能将它作为面向任意注册用户的安全代理。密钥以受文件权限保护的明文存于服务端，部署管理员可读取；客户端用户必须信任该服务器。更多边界见[安全说明](../docs/security-review.md)。

## 接口

所有路径位于 `/api/mobile/models`，使用现有 DeepTutor 登录令牌：

| 方法 / 路径 | 用途 |
| --- | --- |
| GET `/api/mobile/models` | 当前账号的脱敏配置、服务商选项及默认选择 |
| GET `/options` | 官方授权模型与个人模型合并后的选择列表；个人默认优先 |
| POST `/discover` | 使用表单新 Key 或该账号已存 Key 查询模型列表 |
| POST `/profile` | 创建/更新一组服务商、Key 和模型；模型 ID 稳定保存 |
| POST `/default` | 设置当前账号默认模型 |
| DELETE `/profile/{id}` | 删除当前账号指定配置；已保存对话与资料不变 |

当前配置是账号级，不按同一账号内工作区复制 Key。不同服务端、不同账号的数据分别保存。删除模型后打开旧聊天会要求重新选择，不能悄悄改用另一种模型。

## 验证

在隔离环境安装 `deeptutor[server,providers,reading]==1.7.2`（或 1.7.1），以及 `httpx`、`python-multipart`。测试还需要 Node 24 执行客户端实际的配置生成函数。随后执行：

```bash
python server/tests/test_mobile_models.py
python server/tests/test_upstream_contracts.py
```

测试创建隔离临时 home，使用 HTTP TestClient，不启动本地 DeepTutor 学习后端，也不读真实学习资料或密钥。覆盖双账号权限隔离、脱敏、留空/替换、下一次运行时配置解析、模型发现、默认选择/删除和无登录拒绝。

Android 交互模拟：`npm run mock -- --base-port 8896 --user-models`，演示账号 `demo` 或 `other`，密码 `demo-pass`。仅 `fixture-key` 开头的模拟 Key 返回成功；无外部请求、无真实模型。模拟结果不能代替实际 VPS 推理验收。
