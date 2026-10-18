# 旧版 SenseVoice 普通话服务资料

**当前 `2026-10-17.8-speech` 网页仅提供系统语音播报，不调用本目录的识别或纠错服务。用户已取消语音输入。部署新版只需覆盖 `dist/index.html`，无需执行以下模型下载和后端部署步骤。下文保留为旧版资料。**

与 v3 静态网页配套的一句话识别服务。手机录音、断句并转为 16 kHz 单声道 PCM16 WAV，服务使用 sherpa-onnx + SenseVoiceSmall INT8 识别，返回文字；v3 网页再由浏览器本地 Qwen3 0.6B 模型纠错，之后的计分、确认和系统播报仍由网页完成。纠错模型不是本服务依赖，不会增加后端推理负载。

**当前交付状态：实现与前端构建已完成，未在用户的 CentOS 7 / 2 核 2GB 主机部署，也未测得该主机的内存峰值、响应时间或真实牌桌准确率。** 这里没有模拟识别结果或浏览器识别的隐式回退。服务没连接时，网页会说明原因，文字与按钮继续可用。

## 资源与运行约束

- 一次只处理一个请求，推理线程为 1；繁忙时返回 429，不无限排队。启动时加载一个模型，不能使用多个 Uvicorn workers。
- 模型为官方 `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17`，固定 `language=zh`。关闭 ITN，优先保留“七对、十三不靠”等中文表达；前端也兼容“7对、13不靠”。
- 只需要 sherpa-onnx、NumPy 和 HTTP 框架，不安装 PyTorch、CUDA、FFmpeg、说话人识别、Kokoro 或对话大模型。
- 每段 0.25–15 秒、最多 512000 字节；前端超过约 14 秒会放弃本句，请用户分开说。上传超过 10 秒中止，前端等待结果最多 45 秒。
- 手机使用轻量音量检测判断开始和结束，不是神经网络 VAD。安静后约 0.9 秒提交；8 秒没有检测到说话会停止。噪声持续时可点“提交”，过早断句时可用文字补充。
- 录音只在内存处理，不写入服务端文件，不在日志记录转写内容。下方 Nginx 配置为短音频预留内存缓冲，避免请求体落到临时文件。模型本身需要保存在磁盘。
- Docker 默认限制 1100MB 内存、1.5 核 CPU，给现有网站保留余量。这是保护现有服务的初始预算，不是已验证的模型内存需求；若超限被终止，应先测量并评估升级资源，勿盲目取消限制。模型文件约 228 MB，不等于运行内存占用。
- CentOS 7 / 3.10 内核的 Python 与 Docker 兼容性仍须在目标主机确认。Docker 共享宿主机内核，不保证解决旧内核问题。本文不自动升级系统、安装 Docker 或修改线上服务。

## 1. 准备文件和模型

在开发电脑项目根目录构建：

```sh
npm run build --prefix v3
python3 v3/server/download_model.py
```

下载脚本只使用 Python 标准库，需 Python 3.8+。从官方 release 下载 INT8 压缩包，只提取 `model.int8.onnx`、`tokens.txt` 和 `LICENSE`；临时包自动清理。下载时需要额外磁盘空间。网络不通时可在另一台电脑下载后传输同样的三个文件，不能用 FP32 模型冒充 `model.int8.onnx`。

如果使用 `npm run release --prefix v3` 生成的发布压缩包，网页已经构建好，不需要在服务器安装 Node。解压后在含 `dist/`、`server/` 的目录运行以下命令即可准备模型：

```sh
python3 server/download_model.py
```

将 `v3/dist/`、`v3/server/`（包含模型）上传到同一父目录，例如：

```text
/opt/mahjong-v3/
  dist/index.html
  server/app.py
  server/requirements.txt
  server/compose.yaml
  server/models/sensevoice/model.int8.onnx
  server/models/sensevoice/tokens.txt
  server/models/sensevoice/LICENSE
```

模型目录被 Git 忽略，传输源码时需单独包含该目录。录音推理不需要联网下载模型；安装依赖和首次下载模型需要网络。

## 2A. 原生 Python 启动（与 Docker 二选一）

需要已有的 Python 3.11 运行环境。不要替换 CentOS 的系统 Python。先确认它能安装对应架构的二进制 wheel，避免在 2GB 主机编译大型依赖。

```sh
cd /opt/mahjong-v3/server
python3.11 -m venv .venv
.venv/bin/python -m pip install --only-binary=:all: -r requirements.txt
OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8090 --workers 1 --limit-concurrency 8
```

开发电脑可以在本地 `v3/server` 目录执行相同命令。访问 `http://localhost:8090/`，服务会同时提供 `../dist` 静态网页和 `/api/` 接口；这是有完整识别链路的本地入口。原有 `localhost:8083` 纯静态服务不会自动获得 `/api/`。

原生运行没有 Compose 的资源上限。长期开启需配置进程托管和资源限制；先确认单次识别的峰值，再常驻到当前网站机器。

## 2B. Docker 启动

前提：服务器已经有能正常运行的 Docker Engine 和 Compose 插件，并能拉取 Python 3.11 镜像。不要直接在 CentOS 7 上假定最新 Docker 可用。

```sh
cd /opt/mahjong-v3/server
docker compose build
docker compose up -d
docker compose logs --tail=50 voice
curl --fail http://127.0.0.1:8090/api/health
```

模型加载成功时 health 返回 `ready: true`、`engine: sensevoice`、`language: zh`。模型缺失或加载失败时返回 503 和 `ready: false`，请查看启动日志，修复后重启。不要把“容器正在运行”当成模型已就绪。

SenseVoice 模型文件应可被容器用户 10001 读取，父目录可进入；只挂载模型目录和构建好的 `dist`。服务端源码、服务配置和 SenseVoice 模型不放进公网静态目录；供手机下载的 Qwen 文件使用下文单独的 `browser-models/` 目录。

服务端口只映射到 `127.0.0.1:8090`，不用新增公网端口。准备好后重启服务：

```sh
docker compose restart voice
```

## 3. 接到现有 HTTPS 麻将站点

网页默认请求**当前页面所在目录的 `api/`**。例如公开地址是 `/majiang/` 或 `/majiang/index.html`，会请求 `/majiang/api/health` 与 `/majiang/api/transcribe`。

1. 把构建好的 `dist/index.html` 放到现有 `/majiang/` 静态站点目录。
2. 在 Nginx 的 `http {}` 中加入 `nginx-http.conf` 的限流区域定义。
3. 在现有 HTTPS `server {}` 中加入 `nginx-location.conf` 的 location，不修改原有证书或静态页面配置。
4. 按现有运维流程检查并重载 Nginx。

```sh
nginx -t
nginx -s reload
```

接口映射为：

```text
HTTPS /majiang/api/health       → 127.0.0.1:8090/api/health
HTTPS /majiang/api/transcribe   → 127.0.0.1:8090/api/transcribe
```

`^~` 保证 API 不被通用静态规则抢走。浏览器与接口保持同源，不需要跨域 CORS 或在前端保存密钥。若页面部署在 `/things/majiang/`，相应调整 Nginx location 前缀。网页没有尾斜杠的目录 URL（`/majiang`）应由静态服务器重定向到 `/majiang/`。

特殊部署可以修改 HTML 的 `<meta name="mahjong-voice-api" content="./api/">`，仍须指向本站目录、以 `/` 结尾；前端拒绝把录音发送到其他域名。网页里的“检查连接”会显示模型是否就绪。

## 浏览器纠错模型的同源下载

纠错模型可以放在服务器的 `majiang/server/browser-models/` 子目录。它是供手机下载的静态文件，推理仍在手机上运行。下面以项目绝对路径 `/opt/mahjong-v3` 为例；Nginx 中的 `alias` 应改为你的实际路径（可在 `majiang/server` 执行 `pwd` 查看）。

1. 先将 `server/download_browser_model.py` 上传到现有项目的 `server/` 目录；完成模型下载和公网地址检查后再更新网页。
2. 在服务器执行（Python 3.6+ 与 curl，无需安装 dataclasses 或 Python 模型依赖）：

```sh
cd /opt/mahjong-v3/server
python3 download_browser_model.py
python3 download_browser_model.py --verify-only
```

脚本从固定上游版本下载 Q4F16 权重、分词文件、模型说明和许可证，共约 583 MB。中断后重新运行会续传 `.part` 文件；已有文件通过哈希校验后跳过。服务器只保存、分发这些文件，不加载 Qwen 推理，也不用重新下载 SenseVoice。文件会放在：

```text
server/browser-models/onnx-community/Qwen3-0.6B-ONNX/
  config.json
  tokenizer.json
  tokenizer_config.json
  ...
  onnx/model_q4f16.onnx
```

3. 在现有网站的 HTTPS `server {}` 中增加以下规则；该规则已包含在 `nginx-location.conf` 中。已有 `/majiang/api/` 规则时只补充 models 这一段即可：

```nginx
location ^~ /majiang/models/ {
    alias /opt/mahjong-v3/server/browser-models/;
    autoindex off;
    default_type application/octet-stream;
    add_header Cache-Control "public, max-age=86400";
}
```

只公开 `browser-models/` 这个目录。Nginx 工作进程需要能读取其中的文件并进入各级父目录。文件由 Nginx 直接发送，现有 Docker 语音容器不需要新增挂载或重启。

```sh
nginx -t
nginx -s reload
```

4. 在自己的电脑或服务器上检查公网 HTTPS 下载地址（将域名换成实际域名）：

```sh
curl --fail https://你的域名/majiang/models/onnx-community/Qwen3-0.6B-ONNX/config.json
curl --fail --head https://你的域名/majiang/models/onnx-community/Qwen3-0.6B-ONNX/onnx/model_q4f16.onnx
```

前一个请求应返回模型配置 JSON；后一个应返回 200，文件长度为 `569789750` 字节。若返回网页 HTML 或 404，检查 `alias` 绝对路径及 location。检查通过后，用新版 `dist/index.html` 覆盖线上网页，再通过 `/majiang/` 或 `/majiang/index.html` 刷新页面，手机的模型请求会指向同一域名的 `/majiang/models/`。页面使用的 `<meta name="mahjong-model-base" content="./models/">` 可调整下载目录；必须为同源目录且以 `/` 结尾。缺文件会报加载失败，不会再向 Hugging Face 请求。

如果 150 服务器也无法访问 Hugging Face，可在能够访问的电脑上运行同一脚本，再用 SFTP/rsync/scp 把整个 `server/browser-models/` 目录上传到服务器同一位置，无需手机开 VPN。本机临时调试若使用 `localhost:8090` 的内置静态服务，可指定 `python3 server/download_browser_model.py --output-dir dist/models`，让模型放到它的静态目录中。

该改动只迁移模型文件来源。Transformers.js 及 ONNX Runtime 的 JS/WASM 依赖仍使用 jsDelivr，手机仍需能访问该 CDN；这不代表整个网页已支持完全离线加载。首次每台手机仍需下载模型；缓存被清理、更换浏览器或站点来源后可能重下。`browser-models/` 与临时调试的 `dist/models/` 不进入 Git、Docker 镜像或普通发布包，应单独传输。

手机网页会先保存文件，再创建纠错推理实例。支持文件写入 API 时优先使用浏览器私有文件存储 OPFS：先用小文件检查可写性，再逐块写入模型，关闭并核对大小后由 Transformers.js 自定义缓存读取；旧的完整 Cache Storage 文件继续复用。缺少该 API 的浏览器保留 Cache Storage 路径。WebKit 的 Cache.put 即使收到响应流也会合并完整缓冲区，因此旧保存方式仍可能产生很高的内存占用；OPFS 改动避免这一次完整合并，但不保证所有手机的推理内存足够。“下载模型”对应网络传输，“加载缓存”对应读取本机文件。初始化意外中断或 WebGPU 失败后不会自动循环重试或改建 WASM 实例。这些前端改动只需更新 `dist/index.html`，服务器模型和语音服务无需重新下载或重启。

如果出现 `Internal error`，不能仅凭这句话判断是缓存还是推理的问题。新版将错误分为“模型保存失败”“纠错组件加载失败”“推理初始化失败”等阶段，可展开“查看纠错错误详情”读取原始错误、文件、阶段和浏览器能力。诊断版本为 `2026-10-17.6`，详情的 `storageBackend` 为 `opfs` 或 `cache-storage`，保存错误也直接显示文件名和保存方式。组件和模型初始化时会记录阶段及文件变化，若整页意外重载，下次打开语音窗口自动展开 `previousAttempt`，保留上次的设备、缓存、运行库及文件信息；这是中断前的记录，不是系统崩溃原因。旧版本未记录的详情无法在升级后恢复。若版本不同，先确认线上 HTML 已更新。组件或推理初始化失败后，同一页面的 ONNX 运行环境可能仍处于失败状态，按钮会要求刷新页面再重试；这不会清除已保存的模型文件。设备检查在下载之前进行，检查实际 adapter 和 `shader-f16`，不能只凭存在 `navigator.gpu` 判断模型可运行。iOS 无可用 WebGPU 时停止加载这个大模型；Safari 26 的上游支持也不保证每台设备、每个模型都能启动。

## API

- `GET /api/health`：就绪状态、繁忙状态、语言与录音限制。
- `POST /api/transcribe`：请求体直接为 WAV，`Content-Type: audio/wav`，无需 multipart。成功返回 `{ "text": "骰子三和五", "engine": "sensevoice", "language": "zh", "audioSeconds": ..., "inferenceMs": ... }`。此处为字段格式示意，不是固定或模拟识别结果。
- 413：音频过大；415：类型错误；422：录音无效或识别为空；429：服务繁忙；503：模型未就绪。服务不接收前端昵称来伪装“热词增强”，也不参与积分计算。
- 取消请求后网页会丢弃迟到结果。已经进入原生推理的请求不能立即中断，服务会完成它后再接受下一条，期间仍返回繁忙。

## 手机使用与验收重点

打开 HTTPS 页面，开始牌局，点“语音助手 · 点一下说”，允许麦克风，说“骰子三和五”。结束后麦克风应关闭，页面显示文字并播报方向。下一句再点一次。

胡牌先展示预览，点击“确认结算”才记账，也可再次收音说“确认结算”。离开页面、关闭助手、取消录音或牌局变化时不执行迟到的录音。文字输入会取消尚未完成的语音请求，防止两种输入冲突。

上线前需要用目标手机和真实服务器确认：iPhone Safari / Android Chrome 的录音与播报、麦克风拒绝与撤销、网络中断、安静和麻将声环境、同音昵称、胡法叠加、取消后迟到结果、同时两条请求、容器峰值内存与识别耗时。当前交付未包含这些真实设备测试结果。

参考：[SenseVoice INT8 官方模型与语言参数](https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html)、[sherpa-onnx Python API](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/python/sherpa_onnx/offline_recognizer.py)。
