# 03 · 技术栈与 AI 接入决策

## 已落地技术
- Node.js 24、TypeScript、Next.js 15.5.27 App Router、React 19：复用现有代码基线，页面和 API 同仓库。
- Prisma 6 + PostgreSQL 16：迁移、类型化查询、事务；钱包余额和人民币分均用整数。
- Redis 7 + ioredis：分布式限流、单用户生成锁、公开目录 30 秒缓存。
- bcryptjs 成本因子 12；随机 256-bit 会话 token，仅 SHA-256 哈希存数据库；HttpOnly、SameSite=Lax，HTTPS APP_URL 启用 Secure。
- OpenAI SDK + Responses API；默认 OPENAI_MODEL=gpt-6-luna，可按可用模型与评测结果替换。官网模型目录将 Luna 定位为高吞吐成本敏感任务模型，账户是否可调用仍待凭证联调。
- Stripe SDK：Checkout 和 Webhook 签名验证，服务端套餐定价。
- Lucide 图标、响应式 CSS；Node test runner + Playwright 浏览器验收；Docker、Kubernetes 和 GitHub Actions。
具体可复现版本以 package-lock.json 为准。PostCSS 和 deepmerge-ts 通过 overrides 修复传递依赖审计问题，构建与迁移需持续回归兼容性。
## AI 行为
角色系统设定从数据库读取，不接受浏览器提交的 systemPrompt 或伪造历史。传入最近 20 条已保存消息和本轮输入，用户输入最多 4,000 字符，输出上限 1,500 token，store=false。
Responses 流在服务端消费。demo 环境展示逐块模拟文字；production 先缓冲输出、完成安全审核，再发送 done 事件。这是审核完整性与首段等待时间的明确取舍。未来分段审核必须评测跨段漏检，不能仅透传原始 token。
上游异常、空回复、不完整回复或输出审核失败均触发退款。当前固定星币/条计费，schema 的 token 用量字段尚未接实际遥测，不可用于财务成本报表。
当前没有向量记忆、长期摘要、多 Agent 或自动工具执行。后续先用评测数据证明收益，再扩展模型链路；避免为角色对话引入无关复杂度。
## 模型评测与更新
收集 200 条中文角色扮演/学习/写作/边界样例，要求角色一致性人工评分 ≥ 4/5、任务完成度 ≥ 4/5、严重安全违规 0、固定输出预算下完成率 ≥ 99%。10% 灰度比较质量、延迟、每成功回复成本，再升流量；保留上个模型配置以便回退。切换模型只改 OPENAI_MODEL 不代表自动获得服务权限。
## 官方参考
[Responses 流式事件与接口](https://developers.openai.com/api/docs/guides/streaming-responses)
[模型目录与定位](https://developers.openai.com/api/docs/models)
[Stripe 支付履约](https://docs.stripe.com/checkout/fulfillment)
## 尚需生产接入
OpenTelemetry/Prometheus/Sentry、日志脱敏、邮件验证、防机器注册、支付退款争议处理、内容举报与人工审核、地区适用的商户渠道。这些列为发布门禁，不能因为有基础代码就标记完成。
