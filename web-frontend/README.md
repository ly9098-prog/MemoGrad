# MemoGrad 用户 Web

面向普通用户的邮箱验证码／GitHub 登录、账号概览和身份管理入口。完整学习流程仍由微信小程序承载。

```bash
npm ci
npm run dev
```

开发地址为 `http://localhost:3000`，`/api/v1` 和 `/static` 由 Next.js 转发到 `http://localhost:8000`。可通过 `USER_API_ORIGIN` 指向其他本地后端。管理端使用 `http://localhost:3002`。

后端的 `USER_WEB_BASE_URL` 必须与浏览器入口一致；GitHub 固定回调使用该入口下的 `/api/v1/auth/github/callback`。生产通过 Nginx 同源反代，浏览器 Cookie 不跨子域。

提交前运行 `npm run check`，包含类型检查、Lint、Vitest 和生产构建。

项目认证、API、迁移与部署说明以仓库本地 `docs/auth/MULTI_IDENTITY_AUTH.md`、`docs/frontend/USER_WEB_AUTH.md` 和 `docs/project/DEPLOY_PLAN.md` 为准。
