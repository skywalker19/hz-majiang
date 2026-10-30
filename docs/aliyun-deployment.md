# 阿里云 Ubuntu 发布麻将 v4

当前 v4 是静态网页，语音由浏览器系统播报，不需要部署旧语音容器或模型。

## 首次准备

本工程 `deploy/aliyun/` 提供与 EatWise 相同的 Ubuntu 主机初始化脚本。两个项目部署到同一服务器时，只初始化一次即可，详细参数见该目录 README。

```bash
scp -r deploy/aliyun root@NEW_IP:/tmp/
ssh -t root@NEW_IP 'bash /tmp/aliyun/setup-ubuntu.sh --host NEW_IP --install-deps'
```

它为 `/majiang/` 配置 `/var/www/hz-majiang/current/` 静态路由，为 `/eatwise/` 配置回环8088代理，并为新IP或域名申请证书及设置自动续期。确认安全组已放行80/443。不要将旧腾讯云IP证书直接用于新IP。

## 本地发布

本机需要 Node.js 和 Python 3.9+，服务器需要 Python 3。普通发布在原交互终端执行，密码由本人输入：

```bash
bash publish.sh --target root@NEW_IP --dry-run
bash publish.sh --target root@NEW_IP --check-url https://NEW_IP/majiang/
```

也可使用 `MAHJONG_TARGET` 或与 EatWise 共用的 `ALIYUN_SSH_TARGET` 环境变量。没有显式目标时不会连接任何默认生产主机。

脚本先构建当前v4源码，仅打包网页、图标和manifest，生成文件哈希清单；通过普通SCP上传，再在服务器验证包哈希、成员路径、文件清单与各文件哈希。服务器拒绝路径穿越、符号链接、硬链接、超大包和非托管的已有目录。

安装后的布局：

```text
/var/www/hz-majiang/
  .managed-by-publisher
  releases/发布编号/
  current -> releases/当前编号
  previous -> releases/上次编号
```

`current` 使用原子符号链接替换。传入 `--check-url` 时，还会读取实际HTTP内容核对index.html哈希，失败则恢复原current；未提供该参数时，只完成文件与链接验证，不声称公网验收成功。

如果从服务器回环地址验收，可加 `--check-url http://127.0.0.1/majiang/ --public-host NEW_IP`。HTTP重定向后仍需新HTTPS入口可达。最终验收应使用正常证书校验，不跳过TLS错误。

可通过 `--port 2222` 更换SSH端口，通过 `--remote-dir /其他目录/hz-majiang` 更换根目录；更换目录时需同步人工调整Nginx alias。首次不能用脚本覆盖已有非托管静态目录：使用新目录，或按迁移计划单独安排接管。

## 回退

```bash
bash publish.sh --target root@NEW_IP --rollback --check-url https://NEW_IP/majiang/
```

回退也重新验证上一版文件哈希；HTTP检查失败会恢复回退前的current。历史发布目录不会自动清理。

## 只生成离线包

```bash
bash publish.sh --package-only /tmp/mahjong-aliyun.tar.gz
```

包内含release.json和逐文件SHA-256，不含旧模型、服务器配置、私钥或运行数据。目标文件已存在时停止，避免覆盖。

该入口构建当前本地源码。原样搬迁生产时，先确认本地dist与线上基线哈希一致；本次线上基线是 `0beee41a1841a47db1f53623131aa60f033b5d2e4579ce79223b066c1b4a80a0`。

更换IP或域名会改变浏览器来源，用户旧牌局不会随服务器文件自动迁移；当前只有截图导出，保存可继续记分的牌局需要另行实现导入导出。

本地测试：`python3 -m unittest discover -s tests -p test_deploy.py -v`。
