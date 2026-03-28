# ID Photo Production — 证件照在线制作

> 无需下载软件，上传照片即可在线生成符合标准的证件照，支持打印排版下载。

## 功能特性

- 📷 **AI 智能去背** — 调用 Remove.bg API，精准去除背景
- 🎨 **背景色替换** — 白色 / 蓝色 / 红色，一键切换
- 📐 **多种规格** — 1寸、2寸、身份证、护照、美国签证
- 🖨️ **A4 打印排版** — 自动排版多张到 A4，可直接送冲印店
- 🔒 **隐私保护** — 图片全程内存处理，不存储任何数据

## 技术栈

- **框架:** Next.js 14 (App Router)
- **样式:** Tailwind CSS
- **语言:** TypeScript
- **图像处理:** Sharp.js（服务端内存操作）
- **背景去除:** Remove.bg API

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.local.example` 为 `.env.local`，填入你的 Remove.bg API Key：

```bash
cp .env.local.example .env.local
```

编辑 `.env.local`：

```
REMOVEBG_API_KEY=your_api_key_here
```

> 获取 API Key：https://www.remove.bg/api（免费注册可获 50 次/月）

### 3. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

### 4. 构建生产版本

```bash
npm run build
npm start
```

## 项目结构

```
src/app/
├── page.tsx              # 主页面
├── layout.tsx            # 根布局
├── globals.css           # 全局样式
└── api/
    ├── remove-bg/        # 背景去除 API
    ├── process/          # 图片合成 API
    └── layout/           # A4 排版 API
```

## 环境变量

| 变量名 | 说明 |
|--------|------|
| `REMOVEBG_API_KEY` | Remove.bg API 密钥 |

## 部署

推荐部署到 [Vercel](https://vercel.com)：

1. Fork 本仓库
2. 在 Vercel 导入项目
3. 在环境变量中配置 `REMOVEBG_API_KEY`
4. 部署完成

---

*Made with ❤️ by 文墨 AI*
