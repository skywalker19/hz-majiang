# 版本快照

`v3-2026-10-17.9-speech.tar.gz` 保存创建 v4 之前的 v3 源码、文档、历史测试和 `dist/index.html`，共 38 个文件。对应的 `v3-2026-10-17.9-speech.manifest.json` 记录每个文件的大小与 SHA-256，以及压缩包 SHA-256。

快照不包含模型、虚拟环境、缓存、node_modules、worktrees 或重复的 release 压缩包。当前纯播报版运行所需文件都包含在快照中；旧的服务器模型仍保留在原位置。

压缩包解压后的顶层目录是 `v3/`。需要查看旧版本时，可先解压到单独目录，再打开其中的 `v3/dist/index.html`。
