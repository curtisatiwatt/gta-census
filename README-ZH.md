# GTA 地图源码与发布说明

此压缩包包含完整前端源码、已准备好的地图及人口数据、数据处理脚本、测试、GitHub Pages 工作流，以及本次重新构建的 dist/。

覆盖 Toronto、Peel、York、Durham、Halton，包括 Markham、Richmond Hill、Vaughan。默认采用551个官方命名的市政/区域政府分区，另有57个联邦普查补充区域。独立的“普查统计区”图层仍保留全部1,342个原统计区域。

## 分区与统计

默认优先市政府的社区、规划区和村落边界；没有合适完整市级分区时，采用York和Durham区域政府的命名社区。市政数据确无覆盖的部分才使用联邦普查区。

Toronto的158个社区使用市政府匹配的2021人口及家庭收入资料，Mississauga的56个市府统计区域有人口构成资料，Brampton的53个命名社区补充了市府发布的Environics 2022年人口估算（明确标注年份与估算性质）。

社区原表缺项时，详情会直接列出与社区相交的统计范围、家庭收入和总人口；点击一行即可看完整人口构成及虚线统计边界，市政社区名和实线边界继续保留。York新增1,184个官方2021普查DA，其中Markham、Richmond Hill、Vaughan合计835个；Halton新增30个Our Kids Network命名统计社区的2021人口，采用其2023边界。其他缺项使用原始普查区资料补充，收入和人口占比底色也能直接显示，不必切换成数字命名地图。

这些数值属于各统计范围的完整区域，不冒充整个规划社区的汇总。不会按面积分摊人口或平均收入中位数。Peel HDZ的收入字段经核实是普查区中位数的加权平均，人口分类分母也有一致性问题，因此未作为真实社区中位数或族裔比例展示；核查证据保留在研究目录。

在“选择地区”或“地图图层”里仍可以切换“市政社区与规划区 / 普查统计区”。旧普查区详情链接仍可使用，城市链接会保留分区模式。

来源、许可、覆盖和缺失原因见`data/municipal/`各地区的`sources.json`；所采用清单为`datasets.json`，几何与统计关联审计为`audit.json`。

补充统计范围由`statistics-sources.json`选择，关联与校验见`statistics-audit.json`。重新生成社区后运行`python scripts/prepare-statistics.py`；所有原始值、完整边界、缺失值与统计范围关联随`npm run check`校验。

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

原压缩包的验证记录保留在 VERIFICATION.txt；当前版本的应用、联邦数据及市政社区校验统一运行 npm run check。

地图统计口径与来源限制见原项目 README.md 及应用内数据说明。
