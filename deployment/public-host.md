# 本机公网 HTTPS 入口：mypi.zimagent.top

这台主机已有系统 Nginx 占用 80/443 并服务其他域名。MyPI 使用独立的用户级 systemd 服务、独立数据目录和仅监听 `127.0.0.1:13080` 的 Gateway；Worker 与 Broker 分别只监听 `127.0.0.1:14101` 和 `127.0.0.1:14102`。新增域名配置由现有 Nginx 按 `server_name` 转发，不替换其全局配置或其他站点。

本配置使用 `public-demo`、HTTPS Origin 和 Secure Cookie。`PUBLIC_EXECUTION_ENABLED=false`、`MYPI_ENABLE_IMPORTS=false`。本机 Docker Desktop 的 `isolated-local` 例外**不能**通过公网域名使用；专用主机 rootless/runsc 安全验收未完成前，不开放 Run。`/health/live` 可用于服务存活检查，`/health/ready` 返回 503 是执行门禁的预期结果。

## 用户级服务

在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm verify
node scripts/setup-public-host.mjs
systemctl --user daemon-reload
systemctl --user enable --now mypi-public.service
systemctl --user status mypi-public.service
curl -fsS http://127.0.0.1:13080/health/live
```

首次安装脚本在 `~/.config/mypi-public/env` 生成私密凭据，之后再次运行保留该文件；数据保存在 `~/.local/share/mypi-public`。二者均不入 Git。备份数据时同时保管环境文件中的主密钥。更新代码后运行 `pnpm verify` 和 `systemctl --user restart mypi-public.service`。日志用 `journalctl --user -u mypi-public.service -n 100` 查看。若需在用户退出登录后继续运行，管理员执行 `sudo loginctl enable-linger zima`。

## 系统 Nginx 与证书

安装脚本不会更改系统 Nginx。本站点已安装并由 Certbot 签发证书；以下命令用于在新机器重建。确认 `mypi.zimagent.top` 的 DNS A 记录指向公网入口，且入口将 80/443 转发到这台主机。具有 sudo 权限的管理员执行：

```sh
sudo install -m 644 deployment/nginx.mypi.zimagent.top.conf /etc/nginx/sites-available/mypi.zimagent.top
sudo ln -s /etc/nginx/sites-available/mypi.zimagent.top /etc/nginx/sites-enabled/mypi.zimagent.top
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx --redirect -d mypi.zimagent.top
sudo nginx -t
curl -fsSI https://mypi.zimagent.top/health/live
```

证书签发前，这个独立站点仅提供 HTTP 以供 Certbot 完成验证；签发后 Certbot 增加 HTTPS 和 HTTP 跳转。配置变更前先确认同名站点与证书不存在，避免覆盖既有服务。浏览器访问 `https://mypi.zimagent.top` 验证页面和 Secure Cookie。若尚无管理员，使用当前私密环境执行交互式 bootstrap：

```sh
set -a
. "$HOME/.config/mypi-public/env"
set +a
node --import tsx apps/cli/src/main.ts admin bootstrap --state-dir "$MYPI_DATA_DIR"
```

`/health/ready` 只有在完成专用执行主机安全验收并按发布流程启用执行后才应变为 200；不得为了消除 503 而将本机 Docker Broker 接到公网配置。
