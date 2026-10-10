# Ubuntu 部署

当前在线入口为 `http://106.54.43.240/kb/`，运行代码版本 `736ed6aa7a90c0e3c4586e89b9c0d141741d60cb`（2026-10-10）。公网访问、保存读取和新版项目选择器已验证；详细证据见 [部署记录](kb/2026-10-10-首版实现与验证.md)。现有 Nginx `lockpro` 站点在 HTTP 80 将根路径代理到 `127.0.0.1:3000`；知识库新增 `/kb/` 路径，代理到独立的 `127.0.0.1:4173`。网站默认公开查看和编辑，本配置不设置密码。

## 目录与运行条件

需要 Node.js **22.13 或更高版本**、Nginx 和 systemd。系统原有 Node 20 继续供原服务使用；知识库采用独立安装的官方 Node **22.19.0**。服务以 `ubuntu` 用户运行，代码、运行时与数据分开：

```text
/home/ubuntu/pro_kb/releases/<sha>/   某次提交的源码
/home/ubuntu/pro_kb/data/             持久数据
/home/ubuntu/pro_kb/runtime/node-v22.19.0-linux-x64/
/home/ubuntu/pro_kb/backups/lockpro-20261010.conf
```

独立运行时来自官方 `node-v22.19.0-linux-x64.tar.xz`，已核对归档 SHA256：`c0649af18e6a24f6fe5535a3e86b341dd49a8e71117c8b68bde973ef834f16f2`。`backups/lockpro-20261010.conf` 保存原 Nginx 站点配置。

将以下配置中的 `<sha>` 替换为实际提交号。上传相应版本源码到新的 release 目录，保留已有版本与数据；运行时不需要安装 npm 包或构建前端。

```sh
/home/ubuntu/pro_kb/runtime/node-v22.19.0-linux-x64/bin/node --version
sudo install -d -o ubuntu -g ubuntu -m 0755 /home/ubuntu/pro_kb/releases
sudo install -d -o ubuntu -g ubuntu -m 0700 /home/ubuntu/pro_kb/data
```

## systemd

将配置保存到 `/etc/systemd/system/pro-kb.service`，使用独立运行时的绝对路径：

```ini
[Unit]
Description=Pro KB knowledge workspace
After=network.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/pro_kb/releases/<sha>
ExecStart=/home/ubuntu/pro_kb/runtime/node-v22.19.0-linux-x64/bin/node /home/ubuntu/pro_kb/releases/<sha>/server/index.js
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=4173
Environment=DATA_DIR=/home/ubuntu/pro_kb/data
Environment=COOKIE_SECURE=false
Restart=on-failure
RestartSec=3
UMask=0077

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now pro-kb
sudo systemctl status pro-kb --no-pager
curl http://127.0.0.1:4173/api/session
```

公开模式的会话响应为 `{"authenticated":true,"requiresAuth":false}`。应用首次创建数据库时写入演示项目，之后启动继续使用已有数据。

## Nginx

在现有 `lockpro` 站点的 `server` 块内加入下面两个 location。原有根路径和代理到 `127.0.0.1:3000` 的配置继续保留；不另建占用相同入口的站点。

```nginx
location = /kb {
    return 301 /kb/;
}

location ^~ /kb/ {
    client_max_body_size 1m;
    proxy_pass http://127.0.0.1:4173/;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

```sh
sudo nginx -t
sudo systemctl reload nginx
curl http://106.54.43.240/kb/api/session
```

访问 `http://106.54.43.240/kb/`。`proxy_pass` 末尾的 `/` 会去除 `/kb/` 前缀，前端资源与 API 使用相对路径。`$http_host` 保留请求中的主机及端口，供应用校验修改请求的同源 Origin。当前应用不信任代理头来计算登录限流，若以后启用密码，失败次数按直接连接的代理地址累计。

## 配置、升级与数据

| 变量 | 默认值与用途 |
| --- | --- |
| `HOST`、`PORT` | `127.0.0.1`、`4173` |
| `DATA_DIR` | 当前工作目录下 `data`；部署时使用上面的独立绝对路径 |
| `SITE_PASSWORD` | 留空即可公开访问；显式设置才启用登录，无需将其交给前端 |
| `COOKIE_SECURE` | 默认 `false`；以后使用 HTTPS 入口时设置 `true` 并重启应用 |

升级时把新源码放入新的 release 目录，修改 service 中两处版本路径，然后执行 `daemon-reload` 和 `restart pro-kb`。数据目录保持原路径，历史 release 和数据不自动删除。

SQLite 数据包括 `workspace.sqlite` 及运行期间可能存在的 WAL 文件。数据库文件备份可在停止服务后复制整个数据目录到新的备份目录，再启动服务；在线阅读导出可使用网站的 JSON 导出功能，当前没有 JSON 导入接口。

使用 `journalctl -u pro-kb -n 100 --no-pager` 查看服务日志。开发环境的源码验证命令为 `npm ci`、`npm test` 和 `npm run test:browser`；浏览器测试默认需要已安装的 Chrome，测试服务由测试程序自行启动。
