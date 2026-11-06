# GTA 地图源码与发布说明

此压缩包包含完整前端源码、已准备好的地图及人口数据、数据处理脚本、测试、GitHub Pages 工作流，以及本次重新构建的 dist/。

覆盖 Toronto、Peel、York、Durham、Halton，包括 Markham、Richmond Hill、Vaughan。共 1,342 个统计区域。

## 本地运行

安装 Node.js 24，在解压后的 gta-census 目录中运行：

```sh
npm ci
npm run dev
```

检查并构建：

```sh
npm run check
npm run build
npm run preview
```

直接运行和发布不需要重新抓取数据，也不需要运行 Python 脚本。压缩包不包含 node_modules，npm ci 会按 package-lock.json 安装依赖。

## GitHub Pages 发布

1. 将 gta-census 文件夹里的内容放到 curtisatiwatt/gta-census 仓库根目录。请一并保留 .github/workflows/pages.yml；不要把整个文件夹再套一层提交。
2. 在仓库 Settings → Pages → Build and deployment 中，将 Source 设为 GitHub Actions。
3. 将代码提交并推送到 main。随包工作流会执行 npm ci、npm run check、npm run build，再发布 dist/。也可以在 Actions 中手动运行 Deploy GTA map to GitHub Pages。
4. 发布成功后的目标地址为 https://curtisatiwatt.github.io/gta-census/ 。

## 直接使用现成构建

若选择静态文件托管，将 dist/ 内的全部内容作为站点根目录上传。此目录包含 index.html、assets/、data/ 和 .nojekyll，无需再次编译。

本地查看请用 npm run preview 或在 dist/ 内运行 python3 -m http.server 8080，再通过浏览器访问 http://localhost:8080。不要直接双击 HTML 文件，因为浏览器对 file:// 下的数据请求有限制。

## 内容和验证

- src/、index.html、vite.config.js：应用源码与构建配置。
- public/data/：运行所需的全部已生成数据。
- data/、scripts/：官方数据快照、来源和校验记录、数据处理脚本。
- tests/：现有自动测试。
- .github/workflows/pages.yml：GitHub Pages 自动发布配置。
- dist/：已编译的静态站点。

2026-11-06 重新验证：47 项测试通过，人口及地理数据校验通过，生产构建通过。详细输出在 VERIFICATION.txt。

地图统计口径与来源限制见原项目 README.md 及应用内数据说明。
