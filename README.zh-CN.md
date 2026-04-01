# banana-pick

中文文档。英文文档请见 [README.md](README.md)。

这是一个 Chrome 扩展，在页面内提供批量下载面板，支持：
- `gemini.google.com`（下载生成图片原图并去水印）
- `notebooklm.google.com`（批量下载 Studio 中的信息图 Artifact）

## 使用声明

本项目仅用于个人学习，禁止用于任何商业用途。

## 功能特性

- 页面内 Shadow DOM 面板（不依赖 popup）
- 站点适配器架构（`Gemini` / `NotebookLM` 分文件实现）
- Gemini：模拟点击原生下载 + 下载 RPC 拦截获取原图
- NotebookLM：打开信息图 Artifact 后抓取 viewer 图片 URL 批量下载
- NotebookLM：局部差分掩码识别 + 底边采样列填充兜底的水印清理
- 批次时间戳命名，避免文件名冲突（`prefix_YYYYMMDD_HHmmss_N.png`）
- 长页面稳定性增强：
  - 扫描前/下载前滚动预热懒加载
  - 按滚动容器重试查找目标
  - `captureId` 关联拦截结果，避免超时后串图
  - `sendMessage` 超时保护，避免流程卡死

## 维护约束

- Gemini 当前稳定主流程是：点击原生“下载完整尺寸图片”按钮，由 Main World 拦截最终图片响应，再交给 Background 去水印并保存。
- 不要随便把 Gemini 主流程改成显示图 URL 改写、页面侧手动追 `gg-dl` / `rd-gg-dl` 下载链，或后台自行重建签名 URL。这些尝试都真实引入过 CORS 噪音、缩略图下载、重复原生下载和去水印回退问题。
- 控制台里单独出现 `Gemini XHR capture failed` 并不等于主流程坏了。判断标准应以最终是否抓到原图、保存文件是否正确为准。
- NotebookLM 当前稳定主流程是：检测信息图条目，打开 viewer，读取 viewer 内的图片 URL，再由 Background 用 `fetch(..., { credentials: 'include' })` 拉原图、做 NotebookLM 专用去水印并保存。
- 不要为了拿 URL 就把 NotebookLM 改成走 `More -> Download` 或浏览器原生下载拦截。NotebookLM 改版时，优先修列表选择器和 viewer 选择器，尽量不要动 direct fetch 主流程。
- 任何 NotebookLM 去水印算法改动都必须同时验证横版和竖版导出。只按单一方向调参，很容易把另一类图重新改坏，出现白块、灰块或左侧残留。

## 架构

### 运行层

| 层 | 文件 | 运行环境 | 职责 |
|----|------|----------|------|
| 拦截器 | `public/download-interceptor.js` | Main World | Gemini 下载链路 `XMLHttpRequest` / `fetch` 补丁，携带 `captureId` 回传图片 |
| Content Script | `src/content/index.ts` | Isolated World | 通用面板 + 适配器编排 |
| Background | `src/background/index.ts` | Service Worker | 下载处理、可选去水印、原生 blob 下载抑制 |

### 站点适配器

| 适配器 | 文件 | 下载策略 |
|--------|------|----------|
| Gemini | `src/content/adapters/gemini.ts` | 点击原生下载 -> 拦截 blob -> `DOWNLOAD_IMAGE` |
| NotebookLM | `src/content/adapters/notebooklm.ts` | 打开信息图 -> 读取 viewer 图片 URL -> `DOWNLOAD_IMAGE_URL` |

## 消息流

- Action 点击 -> Background -> Content Script：`TOGGLE_PANEL` / `OPEN_PANEL`
- Content Script -> Background：
  - `DOWNLOAD_IMAGE`（dataUrl + filename）
  - `DOWNLOAD_IMAGE_URL`（imageUrl + filename + watermarkMode）
  - `SUPPRESS_DOWNLOADS`（Gemini 原生 blob 下载抑制开关）
- Main World -> Content Script：
  - `GBD_IMAGE_CAPTURED`（带 `captureId`）
- Content Script -> Main World：
  - `GBD_CAPTURE_EXPECT` / `GBD_CAPTURE_CANCEL`

## 技术栈

- Chrome Extension Manifest V3
- TypeScript 5.9
- Vite 6.4 + `@crxjs/vite-plugin` 2.3
- pnpm

## 项目结构

```text
src/
  background/index.ts                  # action 点击 + 下载处理 + 抑制
  content/
    index.ts                           # 通用面板 + 适配器调度
    adapters/
      index.ts                         # host -> adapter 路由
      types.ts                         # 适配器接口
      viewport.ts                      # 懒加载预热工具
      gemini.ts                        # Gemini 检测/下载逻辑
      notebooklm.ts                    # NotebookLM 信息图逻辑
  core/
    watermarkEngine.ts                 # Gemini 去水印
    notebooklmWatermarkEngine.ts       # NotebookLM 去水印
    alphaMap.ts
    blendModes.ts
  types.ts                             # 共享消息/数据类型
  assets/                              # 水印参考图
public/
  download-interceptor.js              # Gemini 主世界下载链拦截器
  rules.json                           # DNR CORS 规则
  icons/                               # 扩展图标
docs/
manifest.json
AGENTS.md
```

## 本地开发

```bash
pnpm install
pnpm dev
```

然后在 Chrome 中：

1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 点击“加载已解压的扩展程序”
4. 选择 `dist/` 目录

## 构建

```bash
pnpm build
```

构建产物输出到 `dist/`。

## 使用方式

### Gemini

1. 打开 `https://gemini.google.com/`
2. 进入包含生成图片的对话
3. 点击扩展图标
4. 在页面右上角面板中选择图片并下载

### NotebookLM（信息图）

1. 打开 `https://notebooklm.google.com/`
2. 打开一个含 Studio 信息图 Artifact 的 notebook
3. 点击扩展图标
4. 在面板中选择信息图并批量下载

## 常见问题

### 点击图标没有弹出面板

- 刷新页面后重试
- 确认加载的是最新 `dist/`
- 确认当前页面域名是 `gemini.google.com` 或 `notebooklm.google.com`

### 长页面检测不全

- 先手动滚动页面，再重新打开面板
- 扫描时保持会话/Studio 区域可见

### 下载失败或卡住

- 查看 `chrome://extensions` 中扩展的 Errors / Service Worker 日志
- 确认目标站点登录状态正常
- 刷新页面后重试一次

## 权限说明

- `activeTab`：处理当前活动标签页并进行 action 交互
- `downloads`：调用 Chrome 下载 API 保存文件
- `declarativeNetRequestWithHostAccess`：为图片请求补充 CORS 响应头
- `host_permissions`：
  - `https://gemini.google.com/*`
  - `https://notebooklm.google.com/*`
  - `https://lh3.googleusercontent.com/*`
  - `https://lh3.google.com/*`

## 许可证

MIT，详见 [LICENSE](LICENSE)。
