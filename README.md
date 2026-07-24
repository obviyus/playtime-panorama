# Steam 游玩时光全景图

一个中文 Steam 游玩时间可视化工具。Cloudflare Worker 读取 Steam Web API 中公开的游戏与累计游玩时间，Workers Static Assets 提供前端，D1 保存缓存和排行榜数据；浏览器用 Steam 官方封面生成响应式全景拼图并导出高清 PNG。

当前主部署架构为 Cloudflare Workers + Static Assets + D1，原 Bun 全栈版本仍作为本地备用。仓库不会保存 Steam API Key；线上 Key 必须使用 Cloudflare Secret。

## 功能列表

- 支持 SteamID64、自定义用户名和完整 Steam 个人资料网址。
- 支持最多 10 个账号合并，兼容逗号、中文逗号、空格、换行和分号。
- 相同 AppID 只显示一次，多账号的游玩分钟数自动相加。
- 单个账号失败不会中断全部任务；结果页会列出成功与失败账号。
- 使用柔化权重按游玩时长调整封面面积，并随页面宽度自动布局。
- 显示账号数、游戏数、总时长、平均时长和最常玩的游戏。
- 浏览器 Canvas 本地导出 PNG，只包含拼图主体。
- 使用 Cloudflare D1 缓存 24 小时，并生成站点排行榜。
- 提供完整中文教程、FAQ、隐私说明和可执行错误提示。

## 效果说明

游戏会先按累计游玩时间从高到低排序，再通过对数与幂函数柔化权重。这样长期游玩的作品更醒目，同时避免最大游戏占满页面，中低时长的游戏仍有最小可见卡片。桌面端可悬停查看名称和时长，移动端可点击卡片查看。

## 普通用户：如何使用网页

1. 打开已部署的站点，或由开发者启动本地 Worker。
2. 本地开发时访问 Wrangler 在终端打印的地址。
3. 输入 Steam 用户名、SteamID64 或资料网址。
4. 多个账号可用逗号、空格或换行分隔。
5. 通常无需填写 API Key；服务端未配置 Key 时，可展开可选区域填写自己的 Key。
6. 点击“生成我的全景图”，等待数据和封面加载。
7. 查看统计与账号状态，点击“下载高清图片”保存 PNG。

完整步骤见网页的 `/guide`，常见问题见 `/faq`。

## 开发者：Cloudflare 本地启动

### 系统要求

- Windows 10/11、macOS 或 Linux
- Bun 1.3 或更高版本、Wrangler 4.114.0
- 可访问 Steam Web API 和 `cdn.steamstatic.com` 的网络
- 一个 Steam Web API Key（可配置在服务端，也可由用户在网页临时提供）

### 安装 Bun

Windows PowerShell：

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

安装后重开 PowerShell，执行 `bun --version` 确认命令可用。其他系统请参考 Bun 官方安装说明。

### 安装依赖

在项目根目录执行：

```powershell
bun install
```

### 配置本地 Steam API Key

申请地址：<https://steamcommunity.com/dev/apikey>

复制示例文件为不会提交的 `.dev.vars`，并填写本地测试 Key：

```powershell
Copy-Item .dev.vars.example .dev.vars
```

也可以不设置本地变量，在首页填写自己的 Key。用户 Key 优先于 Cloudflare Secret，仅保存在当前浏览器 `localStorage`，并通过 `X-Steam-API-Key` 请求头发送给 Worker；不会进入 URL、响应正文、日志、D1 或构建产物。

### 初始化本地 D1 并启动

```powershell
bun run cf:build
bun run cf:d1:local
bun run cf:dev
```

启动成功后以 Wrangler 输出的本地地址为准。

### Bun 备用版本

```powershell
bun run dev:bun
bun run build:bun
bun run start:bun
```

然后访问 <http://localhost:3001>。生产模式同样支持 `PORT`。

## 单账号使用方法

以下输入都支持：

```text
76561198000000001
example_user
https://steamcommunity.com/id/example_user
https://steamcommunity.com/profiles/76561198000000001
```

服务端会安全解析完整网址。自定义用户名通过 Steam 的 `ResolveVanityURL` 转换为 SteamID64。

## 多账号合并方法

例如：

```text
76561198000000001
76561198000000002
example_user
```

也可以写成：

```text
account1, account2，account3; account4
```

浏览器和服务端都会自动去除首尾空格、拆分并去重。服务端最多同时处理 3 个账号请求；相同 AppID 的分钟数相加，最终按合并时长排序。一次最多 10 个账号。

## 图片下载方法

结果页会等待所有封面成功或失败后才启用下载。Canvas 在浏览器本地绘制拼图；加载失败的封面使用替代卡片。最长边限制为 8192 像素，总像素约限制为 4800 万，超出时自动降低比例，避免浏览器崩溃。

文件名示例：

```text
steam-playtime-76561198000000001.png
steam-playtime-merged-3-accounts.png
```

## Steam 隐私设置

1. 登录 Steam 并打开个人资料。
2. 点击“编辑个人资料”。
3. 打开“隐私设置”。
4. 将“我的个人资料”设为“公开”。
5. 将“游戏详情”设为“公开”。
6. 取消勾选“即使用户可以查看我的游戏详情，也始终保持我的总游戏时间为私密”。
7. 保存设置，等待几分钟后重试。

## API Key 安全说明

- 不要把 Key 提交到 GitHub、截图发布或写入公开文档。
- 站点 Key 使用 Cloudflare Secret，不写入 `wrangler.jsonc`。
- 网页填写的 Key 仅存当前浏览器，使用 `X-Steam-API-Key` 请求头发送到 Worker。
- 服务端日志只记录账号与错误类别，不输出 Key 或完整 Steam 请求 URL。
- Key 泄露后请到 Steam API Key 页面撤销或重新生成，并在首页清除旧 Key。

## 环境变量

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `STEAM_API_KEY` | 单个服务端 Steam API Key | 无 |
| `STEAM_API_KEYS` | 逗号分隔的多个服务端 Key，优先于单 Key | 无 |
| `DB` | Cloudflare D1 绑定 | 必需 |
| `ASSETS` | Workers Static Assets 绑定 | 必需 |

## 数据库与缓存

主架构使用 D1，表结构由 `schema.sql` 创建：

主要内容：

- `vanity_cache`：自定义用户名到 SteamID64 的解析结果，不自动过期。
- `playtime_cache`：账号游戏数据，缓存有效期 24 小时。
- `playtime_metrics`：排行榜所需的账号汇总指标。
- `game_playtime_totals`：跨缓存账号聚合的游戏时长。

排行榜反映当前 D1 数据库中的查询缓存。线上和本地 D1 是两个独立环境；执行清理 SQL 前应先确认 `--local` 或 `--remote` 并做好备份。Bun 备用版本仍使用本地 SQLite 文件。

## 项目目录结构

```text
server/
  index.ts          # Bun 路由、多账号聚合、静态资源与 API
  steam.ts          # Steam 请求、Key 轮换、限流、超时和账号解析
  database.ts       # SQLite 缓存与排行榜数据
  leaderboard.ts    # 排行榜快照
  build.ts          # 生产构建与静态资源复制
  start.mjs         # Windows 兼容的生产启动入口
templates/
  root.html         # 首页
  profile.html      # 结果页
  guide.html        # 详细教程
  faq.html          # 常见问题
  leaderboard.html  # 排行榜
public/
  assets/            # 共享样式和页面脚本
  favicon.svg
  site.webmanifest
```

## 常见问题与故障排查

### 未配置 API Key

服务端会正常启动，但首次查询会提示需要 Key。配置环境变量或在网页填写即可。

### 用户名无法解析

检查用户名拼写，或改用 17 位 SteamID64。完整资料网址也可以直接粘贴。

### 游戏列表为空或提示隐私问题

确认个人资料、游戏详情和总游戏时间都公开。游戏时间不超过 10 分钟的条目会按原项目规则过滤。

### Steam API 请求超时或频率过高

每个请求有 12 秒超时，并通过 Bottleneck 限流。请检查网络、稍后重试，或使用自己的 Key。

### 图片加载失败

确认浏览器可访问 `https://cdn.steamstatic.com`。单个封面失败不会阻止页面或导出，PNG 中会绘制替代卡片。

### 数据库初始化失败

确认项目目录或 `STEAM_CACHE_URL` 目标目录可写，并关闭可能锁定数据库的程序。

### 端口被占用

换一个端口：

```powershell
$env:PORT="3001"
bun run dev
```

### 生产模式找不到静态资源

先执行 `bun run build`，确认 `dist/public/` 已生成，再执行 `bun run start`。

## 路由与接口

- `/`：首页
- `/:steamIdentifier`：单账号或编码后的多账号结果页；支持刷新
- `/profile/:identifiers`：旧结果页兼容路由
- `/guide`：详细教程
- `/faq`：常见问题
- `/leaderboard`：D1 站点排行榜
- `POST /api/playtime`：单账号或多账号查询，用户 Key 仅通过 `X-Steam-API-Key` 请求头提供
- `GET /api/playtime/:identifier`：兼容单账号 API；自定义 Key 可通过 `X-Steam-API-Key` 请求头提供
- `/api/leaderboard`：D1 排行榜 JSON

不再支持通过 `?api_key=...` 查询参数传递 Key，以避免 Key 出现在 URL、历史记录或访问日志中。
