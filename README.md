# Tibo 新帖 QQ 邮件提醒

基于 [AllenXiao95/codex-reset-signal](https://github.com/AllenXiao95/codex-reset-signal)，参考版本 ed339d044d439de6920fb0f983416796edad2d08；复用原项目 FxEmbed 适配器及数据接口，保留 MIT 许可与署名。本仓库部署的入口为 `src/tibo/cli.ts`，不启动原项目网页、数据库或 Cloudflare 服务。

## 通知范围

- 仅监测 Tibo [@thsottiaux](https://x.com/thsottiaux)，数字账号 ID 固定为 `1953337039510003712`，每次读取前重新核对。
- 不筛选 reset、quota 或任何其他关键词。排除回复（包括自回复）、转发和引用帖（包括被引用原帖已删除的情况）。
- 每条新原创帖一封邮件；包含来源返回的全部原文、北京时间、原帖链接。无翻译、摘要或主动截断。
- 图片、视频、GIF 仅提示存在，不下载、不内嵌。X Article 单独标为附带文章，不能将帖子正文冒充文章全文。
- 每封邮件明确提示免费来源可能漏帖、缓存、失效，以及无法保证长帖全文。无法检测的漏帖也无法逐条告知，不能将“未发现新帖”解释成绝对没有新帖。

## 免费数据源的实际限制

使用现有免费 FxEmbed 时间线和 profile 接口，不需要 X Token/Cookie，不自动回退到官方付费 API。
已核对参考项目适配器及 [FxEmbed 服务端实现](https://github.com/FxEmbed/FxEmbed)：返回 `replying_to`、`reposted_by`、`quote` 等字段；成功获得 Note Tweet 时，长文放入 `raw_text.text`。本适配器对缺少回复分类的目标帖子报错，不猜测为原创。

服务端可能在单条帖子解析失败时省略该帖、但时间线仍返回成功；Note Tweet 数据缺失也不能可靠检测。这不是完整事件日志，没有稳定性、实时性或全文保证。保留所有实际返回的原文并始终提示完整性不确定；检测到显式截断时加重提示。使用者已接受这些免费来源限制。

## 配置与启用

工作流：[Tibo original posts to QQ mail](https://github.com/cyr0928/tibo-post-mail/actions/workflows/monitor.yml)。

1. 在仓库 Settings → Secrets and variables → Actions → Secrets 中创建：
   - `QQ_EMAIL`：完整 QQ 邮箱地址；发件和收件使用同一个值。
   - `QQ_SMTP_AUTH_CODE`：QQ 邮箱 SMTP 授权码，绝不是 QQ 登录密码。
2. QQ 网页邮箱 → 设置 → 账号与安全 → 开启 SMTP 相关服务，按页面完成验证并获取授权码。
3. Actions → 上述工作流 → Run workflow，操作选 `verify`：运行行为测试、读取真实数据源，并读取持久状态；不写基线、不发邮件。
4. 操作选 `test-email`：发送主题为 **【测试】Tibo 新帖邮件提醒** 的邮件。SMTP 接受不等于收件箱已收到，必须由收件人确认。
5. 确认收到测试邮件后，手动运行 `initialize`。首次成功读取且包含原创帖才建立基线，基线以前不入队、不发历史通知。失败会报错，绝不假装初始化成功。
6. 在 Actions Variables 中设置 `MONITOR_ENABLED=true`。正式启用时间以状态分支 `state.json.initializedAt` 的 UTC 时间为准，可换算为北京时间。
7. 手动运行 `monitor`，确认读取新基线、没有旧帖邮件，然后查看下一次定时运行。

QQ 官方说明：[授权码与开启服务](https://help.mail.qq.com/detail/0/1087)、[连接参数](https://help.mail.qq.com/detail/108/1089/)。
连接固定为 `smtp.qq.com:465`、SSL/TLS、完整邮箱地址与授权码，校验证书；不输出地址、授权码或 SMTP 原始错误。

## 持久状态与重试

`monitor-state` 分支只存放 `state.json`：初始化时间、游标、已发送 ID/时间、待发队列和尝试次数。无邮箱地址和授权码。每次 Actions 检出该分支，缺失或损坏立即失败，不能静默重建基线；不导入上游历史 state/status 文件。

先把游标与队列提交并推送到远端，才发送邮件；SMTP 接受后才记录成功并立即推送。明确发送失败保留 pending，下一次运行重试。已提交成功的帖子不会因更换 runner、重复检查或来源重复返回而再次发送。工作流串行运行，远端状态写入失败就停止继续发送，失败时保留 7 天恢复 artifact。

普通 SMTP 无服务器端幂等键，因此无法严格承诺极端崩溃下“恰好一次”：SMTP 已接受、但成功状态推送前中断，下一次重试可能重复。使用固定 Message-ID 辅助核查，但收件服务不保证据此去重。不要手动删除状态文件或清空已发送记录；如出现 Git 状态提交失败，应先核查恢复 artifact 与收件箱。

## 频率、暂停与恢复

- cron 为 UTC 每小时第 7、22、37、52 分钟，即每 15 分钟一次（北京时间分钟数相同）。
- 常态发现延迟约 0–15 分钟，再加 GitHub 排队、数据源缓存和邮件投递时间；繁忙时可能更长，GitHub 也可能延迟或丢弃定时任务。
- 标准 GitHub 托管 Linux runner 的公开仓库工作流免费；未配置收费服务、第三方邮件 API、网页或数据库。
- GitHub 定时任务只使用默认分支上的工作流；公开仓库连续 60 天无仓库活动时可能自动停用。工作流被禁用、Actions 权限被收回、仓库被归档、默认分支被改动、Secrets 失效、数据源/SMTP 故障也会停止有效监测。
- 暂停：将 `MONITOR_ENABLED` 设为 `false`，停止后续定时监测；已在运行的任务需要在 Actions 中取消。也可在工作流菜单选择 Disable workflow 完全禁用手动及定时执行。
- 恢复：重新启用工作流并设 `MONITOR_ENABLED=true`，手动运行 `monitor`。保留原状态，不要重新 initialize；恢复后将尝试补发原游标之后可读取到的合格帖子（包含暂停期间），来源已遗漏或删除的帖子无法保证补回。
- GitHub Actions 邮件/失败通知由 GitHub 账号通知设置控制。源读取失败会使任务失败，固定来源限制也始终出现在项目邮件中；没有额外收费监测服务。

## 验证

`npm ci && npm test && npm run typecheck`。

新增测试覆盖原创/回复/转发/引用分类、任意关键词正文、长文不主动截断、首次成功基线、失败不初始化、历史不补发、跨状态重载去重、SMTP 失败重试、状态提交失败禁止发送，以及真实 Git 远端/全新检出的状态恢复。模拟测试通过不代表真实 QQ 邮件已投递；线上运行结果与人工收件确认另行记录。


