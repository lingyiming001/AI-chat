# 05 · 部署发布手册与回滚

## 本地运行
Node.js 24、npm、Docker Desktop。项目独占本机 PostgreSQL 55432、Redis 56379，Web 使用 3100。
```bash
npm ci
cp .env.example .env
docker compose up -d postgres redis
npm run prisma:generate
npm run db:deploy
npm run seed
npm run dev -- --port 3100
```
访问 http://localhost:3100 。注册即可使用，无硬编码生产账户。APP_MODE=demo 明确启用模拟 AI/充值，绝不能当作真实收款环境。迁移、依赖安装失败时先排查，不删除数据库卷。
## 容器方式
```bash
docker compose --profile app build app
docker compose --profile app run --rm app node_modules/.bin/prisma migrate deploy
docker compose --profile app run --rm app node_modules/.bin/tsx prisma/seed.ts
docker compose --profile app up -d app
```
访问 http://localhost:3200 。Compose 使用本地开发数据库口令，只面向本机。Docker 构建排除 .env；容器以非 root 用户运行。
## 生产配置
APP_MODE=production；APP_URL 必须是最终 HTTPS 域名，且与浏览器 Origin 完全一致。DATABASE_URL 指向托管 PostgreSQL/PgBouncer 并配置连接限制与 TLS，REDIS_URL 指向受认证私网 Redis。
通过 Secret 管理 OPENAI_API_KEY、OPENAI_MODEL、STRIPE_SECRET_KEY、STRIPE_WEBHOOK_SECRET；不要写进 Git、Dockerfile 或前端环境变量。
Stripe 配置回调路径 /api/webhooks/stripe，订阅 checkout.session.completed 和 checkout.session.async_payment_succeeded。回调先验证签名、币种和金额，再提交到账事务。支付成功跳转页面不充当到账凭据。
## Kubernetes 发布顺序
1. 建立命名空间、托管数据库、Redis、Ingress、TLS 和 xingliao-secrets；确认可用模型配额和支付测试账户。
2. 用受保护 tag 触发 release.yml 构建 GHCR 镜像，取得不可变 digest。tag 创建前必须让 verify CI 通过；当前发布工作流不自动等待独立 verify workflow，应配置仓库保护与审批规则。
3. 替换 deploy/migrate.yaml、deploy/kubernetes.yaml 中镜像占位符和 chat.example.com。先运行迁移 Job，kubectl wait 等待 complete；运行一次种子导入。
4. 应用 Deployment、Service、Ingress、HPA、PDB、CronJob。检查 readiness、3 副本分布及共享依赖连接。
5. 先内部环境，再 1%→10%→50%→100% 流量；每阶段至少 30 分钟观察错误、延迟、钱包差异和模型成本。流量分配由 Ingress/网关配置，模板未包含 canary 控制器。
6. 验证真实注册登录、角色发送、支付测试回调、重复事件、生成失败退款、Pod 中断对账。
## 回滚
应用回滚到上一个镜像 digest（kubectl rollout undo 或 GitOps revert），冻结新充值入口，保持签名回调和对账处理存量请求。若发现余额差异，立即停止收费生成和人工放款，按订单/流水定位；不要手工删除异常流水。数据库采用兼容迁移；破坏性变更通过备份恢复演练单独处理。
## 运维阈值
可用性月目标 99.9%。API 5xx >1% 持续 5 分钟、模型失败 >2%、钱包差异任何一条、PENDING 超过 10 分钟、数据库连接 >80%、磁盘 >70% 触发告警。日志只记录请求 ID、状态与延迟，不记录完整消息、密码或令牌。
## 尚未完成的外部发布步骤
没有部署到公网，没有设置域名/证书或付款商户，没有真实模型/支付沙箱账单证据，也没有在目标云集群完成容量与恢复演练。仓库包含可执行部署模板，不意味着生产已获验收。
