# 冬藏季 · 双11素材工作台

在线使用：https://shawnkkkkkkk.github.io/winter-material-studio/

图片、视频与文案合成均在浏览器本地处理。仓库包含完整应用源码、透明 PNG 模板、素材目录与字体；不包含 PSD/PSB 原稿、客户上传素材、依赖缓存和本地测试产物。透明 PNG 保持原始文件，不转换底色。

## 目录

- `studio/`：应用源码、构建脚本、测试及 `public/` 素材。
- 根目录 `index.html`、`assets/`、`catalog/`、`templates/`、`fonts/`、`licenses/`：GitHub Pages 发布文件。
- 字体与第三方库许可见 `fonts/` 和 `licenses/`。

## 本地运行

需要 Node.js 20.19+ 或 22.12+。

```sh
cd studio
npm ci
npm run dev
```

已有生成好的 PNG 素材，本地运行和网页构建不需要 PSD。

## 验证与更新部署

```sh
cd studio
npm test
npm run build
cp -R dist/. ../
cd ..
git add .
git commit -m "Update studio and published site"
git push origin main
```

GitHub Pages 从 `main` 分支根目录发布。保留 `.nojekyll`。完整功能说明见 [studio/README.md](studio/README.md)。
