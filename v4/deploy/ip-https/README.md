# 150.109.196.200：Docker Certbot + 公网 IP 证书

为 CentOS 7 / Docker 26.1.4 准备的配置材料，未在远程服务器安装或执行。已根据用户提供的输出确认：Nginx 为主机上的 `/usr/sbin/nginx`，生效站点为 `/etc/nginx/conf.d/drip-monitor.conf`，443 端口目前使用 `/etc/nginx/ssl/selfsigned.crt` 和 `/etc/nginx/ssl/selfsigned.key`。

## 针对当前服务器的快速安装

将 `mahjong-ip-https.tar.gz` 上传至服务器 `/root/`，以 root 执行：

```bash
cd /root
tar -xzf mahjong-ip-https.tar.gz
bash ip-https/install.sh
```

脚本先在 `/var/www/.well-known/acme-challenge/` 写入一个探测文件，并从公网 HTTP 地址读取，确认现有路径可用于验证。失败就停止，不改 Nginx 证书配置；无需预先添加可能重复的 location。

验证入口可访问后，脚本运行 Docker Certbot。按提示提供联系邮箱、阅读并决定是否接受 CA 服务条款。申请成功后备份该站点配置，替换已确认的两条自签名证书路径，检查配置并重载 Nginx；配置检查或重载报错时恢复配置文件。新证书适用于该 IP 的整个 443 站点。

最后安装每六小时检查的续期定时器，再用 HTTPS 验证图标响应。没有停止或重启 Nginx 的步骤。若出现报错，请保留完整输出，不要通过 `-k` 绕过最终证书验证。

以下是脚本各阶段对应的手动操作说明。

Let’s Encrypt 已支持受信任的 IP 证书，Certbot webroot 模式需要 5.4 及以上版本。本方案固定使用官方 `certbot/certbot:v5.8.0` 镜像，通过已有 Nginx 响应 HTTP-01 验证。网站地址继续使用 `https://150.109.196.200/majiang/`。

## 1. 确认实际 Nginx 站点

```bash
nginx -T 2>&1 | grep -nE 'configuration file|listen|server_name|root |alias |ssl_certificate'
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
```

根据输出找到服务该 IP 的 80 和 443 站点配置文件。先复制配置文件作为备份。
本目录的 location 片段应加在现有 80 端口的 `server {}` 内，不能作为独立 `server` 直接启用。
若该 server 中有顶层 `return 301/302`，需把跳转移入普通 `location /`，让挑战路径可直接返回文件。

## 2. 安装包装脚本、准备挑战目录

把本目录上传到服务器并进入该目录，执行：

```bash
install -m 755 certbot-docker.sh /usr/local/sbin/mahjong-certbot
mkdir -p /var/www/.well-known/acme-challenge
/usr/local/sbin/mahjong-certbot --version
```

当前站点已存在独立的 `/var/www` 路径配置，先确认它能服务 ACME 文件；仅在缺少挑战 location 时才添加 `nginx-acme-location.conf`，不要重复添加。执行：

```bash
nginx -t && nginx -s reload
printf 'mahjong-acme-ready\n' > /var/www/.well-known/acme-challenge/mahjong-check
curl --fail --show-error http://150.109.196.200/.well-known/acme-challenge/mahjong-check
```

应返回 `mahjong-acme-ready`。这里使用 HTTP 是因为 HTTP-01 的校验入口在 80 端口；网站最终仍通过 HTTPS 使用。文件必须从网站根路径访问，而不是 `/majiang/.well-known/`。

## 3. 申请正式受信任证书

确认挑战文件可访问后执行：

```bash
/usr/local/sbin/mahjong-certbot certonly \
  --cert-name mahjong-ip \
  --preferred-profile shortlived \
  --preferred-challenges http \
  --webroot --webroot-path /var/www \
  --ip-address 150.109.196.200
```

按提示填写联系邮箱并决定是否接受服务条款。这条命令使用正式签发环境，没有 `--staging`。成功后路径为：

```nginx
ssl_certificate /etc/letsencrypt/live/mahjong-ip/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/mahjong-ip/privkey.pem;
```

把现有 443 站点中的两条证书路径替换成上面内容，然后执行：

```bash
nginx -t && nginx -s reload
curl --fail --show-error -I https://150.109.196.200/majiang/apple-touch-icon.png
```

最终检查使用 HTTPS 并正常验证证书，不加 `-k`。签发成功不代表 Nginx 已自动安装证书，必须完成路径替换与重载。

## 4. 主机 Nginx 的自动续期

IP 证书约六天有效。确认正式证书已加载后安装以下文件：

```bash
install -m 755 renew-host-nginx.sh /usr/local/sbin/mahjong-certbot-renew
install -m 644 mahjong-certbot-renew.service /etc/systemd/system/mahjong-certbot-renew.service
install -m 644 mahjong-certbot-renew.timer /etc/systemd/system/mahjong-certbot-renew.timer
systemctl daemon-reload
systemctl enable mahjong-certbot-renew.timer
systemctl start mahjong-certbot-renew.timer
systemctl list-timers mahjong-certbot-renew.timer
```

定时器每六小时检查一次，Certbot 判断是否需要续期。容器中的 deploy hook 只写入共享目录中的标记，主机脚本据此检查并重载 Nginx；没有续期时不重复重载。Nginx 配置检查或重载失败时保留标记，下一次可继续重试。日志可用 `journalctl -u mahjong-certbot-renew.service` 查看。

本材料未附加自动测试或远程变更。应在真实站点完成申请、加载和一次续期验证后，再确认 iPhone 图标的实际显示。

## 官方参考

- [Let’s Encrypt：Certbot 的 IP 证书与六天证书](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)
- [Certbot：Docker 安装方式](https://eff-certbot.readthedocs.io/en/stable/install.html#alternative-1-docker)
- [Certbot：续期与 deploy hook](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates)
