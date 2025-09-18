# 🚀 GitHub Pages 部署指南

## 方法一：使用 GitHub Actions（推荐）✅

已经配置好了自动部署，步骤如下：

### 1. 初始化 Git 仓库（如果还没有）
```bash
git init
git add .
git commit -m "Initial commit"
```

### 2. 创建 GitHub 仓库
在 GitHub 上创建一个新仓库，比如命名为 `image-compression-tool`

### 3. 推送代码
```bash
git remote add origin https://github.com/你的用户名/image-compression-tool.git
git branch -M main
git push -u origin main
```

### 4. 启用 GitHub Pages
1. 进入仓库设置：Settings → Pages
2. Source 选择：GitHub Actions
3. 等待几分钟，自动部署完成

### 5. 访问你的网站
部署成功后，访问：
```
https://你的用户名.github.io/image-compression-tool/
```

---

## 方法二：手动部署（使用 gh-pages）

### 1. 安装 gh-pages
```bash
npm install --save-dev gh-pages
```

### 2. 构建并部署
```bash
npm run build
npm run deploy
```

### 3. 配置 GitHub Pages
1. 进入仓库设置：Settings → Pages
2. Source 选择：Deploy from a branch
3. Branch 选择：gh-pages
4. 文件夹选择：/ (root)

---

## 方法三：手动上传 dist 文件夹

### 1. 构建项目
```bash
npm run build
```

### 2. 创建 gh-pages 分支
```bash
git checkout -b gh-pages
```

### 3. 只保留 dist 内容
```bash
rm -rf !(dist)
mv dist/* .
rm -rf dist
```

### 4. 提交并推送
```bash
git add .
git commit -m "Deploy to GitHub Pages"
git push origin gh-pages
```

### 5. 配置 GitHub Pages
同方法二的步骤3

---

## 🎯 注意事项

1. **首次部署** 可能需要等待 10-20 分钟
2. **后续更新** 只需推送到 main 分支，会自动部署
3. **自定义域名** 可在 Settings → Pages 中配置
4. **访问地址** 格式为：`https://用户名.github.io/仓库名/`

## 🔧 故障排除

如果部署失败：
1. 检查 Actions 标签页查看错误日志
2. 确保 vite.config.ts 中 `base: './'` 配置正确
3. 清除浏览器缓存后重试

## 📱 特性

部署后的网站：
- ✅ 完全免费
- ✅ 自动 HTTPS
- ✅ 全球 CDN 加速
- ✅ 支持自定义域名
- ✅ 永久在线（只要仓库存在）