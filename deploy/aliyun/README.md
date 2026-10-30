# 阿里云 Ubuntu 部署

适用于新的 Ubuntu Server 24.04/26.04 主机。为导入现有腾讯云镜像，选择与旧机一致的 **x86_64** 架构。脚本也可用于同条件的其他云服务器。

## 首次准备主机

先在阿里云安全组放行 TCP 80、443 与自己的 SSH 来源。该脚本不修改系统防火墙、SSH 或 OpenVPN 规则。若系统防火墙已启用，另外确认它允许 HTTP/HTTPS。

将本目录上传后执行，替换所有 `NEW_IP`：

```bash
scp -r deploy/aliyun root@NEW_IP:/tmp/
ssh -t root@NEW_IP 'bash /tmp/aliyun/setup-ubuntu.sh --host NEW_IP --install-deps'
```

可以用已解析到新机的域名替代 `--host` 的 IP。Certbot 会在终端询问邮箱和服务条款。自动化使用时，明确提供 `--email EMAIL --agree-tos`；该参数表示接受 ACME 服务条款。

脚本安装 Nginx 和缺失的 Docker Engine（官方 apt 仓库），生成只包含两个项目的 `/etc/nginx/sites-available/apps06.conf`，测试配置后重载。已经安装 Docker 时保持原安装方式。它不会删除其他站点配置，也不会接管同名非托管文件；如果已有站点使用相同 Host，需要先人工处理冲突。

`/eatwise/` 代理到 `127.0.0.1:8088`；`/majiang/` 对应 `/var/www/hz-majiang/current/`。首次还没部署应用时，这两个路径暂不可用。

默认申请新入口的受信任证书，IPv4 使用短期 IP 证书。旧腾讯云 IP 证书不能用于新 IP。Certbot 固定使用 `certbot/certbot:v5.8.0`；每六小时的 `apps06-certbot-renew.timer` 负责续期，成功后重载 Nginx。续期或重载失败可通过 `journalctl -u apps06-certbot-renew.service` 查看；重载失败保留标记，下次重试。

离线查看将生成的 Nginx 配置：

```bash
bash deploy/aliyun/setup-ubuntu.sh --host NEW_IP --render-only
```

仅初始化 HTTP（不作为正式上线验收）：

```bash
bash deploy/aliyun/setup-ubuntu.sh --host NEW_IP --install-deps --http-only
```

重复执行会保留已有 HTTPS。切换 Host 时脚本停止，要求人工检查证书和站点配置。

## EatWise 日常发布

以下 EatWise 命令在本地 EatWise 工程目录执行；麻将发布参见 `docs/aliyun-deployment.md`：

```bash
bash publish-aliyun.sh --target root@NEW_IP --dry-run
bash publish-aliyun.sh --target root@NEW_IP
```

默认工程目录为 `/opt/eatwise`，可使用 `--remote-dir /其他目录/eatwise` 覆盖。密码在原终端内输入，上传与部署各使用一次普通 SSH/SCP，不使用共享连接。阿里云入口必须明确给出目标，不会回退到腾讯云默认值。

也可以在本地终端设置 `ALIYUN_SSH_TARGET=root@NEW_IP`，再运行 `bash publish-aliyun.sh`。原来的 `publish.sh` 参数和默认行为保持兼容。

日常发布上传当前工作目录和食品快照，会构建新镜像，可能包含尚未提交的代码。它不是原样迁移旧生产版本的入口。

首次全新部署时，附近查询所需 Key 在服务器 `.env.production` 配置；已有生产迁移应恢复原文件，保持管理员密码散列。密钥不会进入发布包。高德如配置了出口 IP 白名单，需要加入阿里云实际出口 IP。

## 原样迁移腾讯云生产版本

先按照迁移计划备份并导入已验证的生产镜像，恢复原 `.env.production` 和完整统计卷（数据库与 `keys.json` 配套，保留属主和权限）。不要运行日常发布来替代这一过程。

将当前工程中的 `scripts/deploy.sh` 及对应操作材料放到新机 `/opt/eatwise` 后，在新机运行：

```bash
cd /opt/eatwise
bash scripts/deploy.sh \
  --image eatwise:20261030T023831Z-18311-20261030023844-6312 \
  --expected-release 20261030T023831Z-18311
```

以上编号是本次核验的生产基线；执行前若生产又发布过，应替换为重新确认的镜像和版本。

导入模式不会构建镜像或生成管理员密码。它要求镜像、生产配置和 `eatwise-analytics` 卷已经恢复，并检查数据库、密钥对镜像用户可读；之后通过候选容器检查版本和接口，检查通过才替换当前服务，切换后失败尝试恢复旧容器。

只读文件系统仍挂载可写统计卷。候选检查也会打开数据库，所以最终快照恢复时应确保目标正式、候选容器均未运行。容器回退不回退数据库；保持同一应用版本迁移，接受新写入后的回退需同步最新数据。

## 验收

```bash
curl --fail https://NEW_IP/eatwise/healthz
curl --fail https://NEW_IP/eatwise/api/release
curl --fail https://NEW_IP/eatwise/api/food-datasets
systemctl list-timers apps06-certbot-renew.timer
```

再人工验证管理员原密码登录、高德查询、统计和点赞。更换 IP 后浏览器 Cookie 不会自动迁移，匿名身份与管理员登录会变化。主机重启和 Docker 重启后还需同时验证 Web 与 OpenVPN。

参考：[Docker Ubuntu 安装](https://docs.docker.com/engine/install/ubuntu/)、[Certbot webroot 与续期](https://eff-certbot.readthedocs.io/en/stable/using.html)。
