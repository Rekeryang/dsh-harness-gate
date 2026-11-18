# DEEPSEEK HARNESS · 生物识别登录门禁

仿照 `dsh-video-skin` 的形态做成的 **DSH（DeepSeek Harness）插件**：DSH 启动时先弹出一个外星文明 HUD 风格的生物识别门禁，刷脸 + 语音确认后才把界面交给 DSH。真实调用摄像头，基于 MediaPipe 478 点人脸网格与虹膜关键点（468–477）本地推理。

> **隐私**：人脸模板只存在浏览器内存里，不写 `localStorage`、不写任何磁盘、不上传网络。页面关闭即销毁。

## 功能

- **DEEPSEEK / 深度求索** 开机动画 → 生物识别门禁。
- 首次进入是**设置界面**：自主录入人脸（或虹膜）信息。
- 录入后进入**人脸识别页**：真实摄像头逐帧比对，9 项 Face-ID 质量校验（单脸/尺寸/置信度/正对/注视/眨眼活体/微动/距离/特征向量）。
- 识别通过后进入**语音登录确认**：TTS 播报 + 语音识别说"确认登录"，也可以点按钮确认。
- 通过后门禁淡出，进入 DSH。右下角保留 🔒 重新锁定胶囊。
- 顶部有**跳过门禁**按钮（二次确认），防止摄像头/引擎异常时把用户挡在外面。
- 设置页与人脸识别页都可**热切换摄像头**，选错可点 ⟳ 重新枚举。
- CPU delegate 优先、GPU 兜底，离线可用（wasm 与模型随插件打包）。

## 一键安装

在 DSH 里：**设置 → 插件 → 添加插件**，粘贴下面任一形式，点安装，然后**完全退出并重新打开 DSH**：

```
github:Rekeryang/dsh-harness-gate#main
```

或用命令行：

```sh
dsh plugin --profile web add github:Rekeryang/dsh-harness-gate#main
```

本地源码开发：

```sh
dsh plugin --profile web add link:<本仓库绝对路径>
```

> 桌面版（Electron）的索引注入表在宿主启动时收集一次快照，所以**装完必须完全重启 DSH**，刷新页面不够。

## 卸载

```sh
dsh plugin --profile web remove dsh-harness-gate
```

Windows 用户也可以直接运行 `scripts/uninstall.ps1`。

## 首次使用

1. 重启 DSH，门禁出现后点**录入人脸**。
2. 允许摄像头权限，正视摄像头，保持 1–2 秒（可按提示眨眼完成活体校验）。
3. 录入完成会自动跳到**人脸识别页**，点**启动人脸识别**，刷脸匹配。
4. 匹配通过后进入语音确认，说"确认登录"或点**确认登录**按钮即可进入 DSH。

> 摄像头需要安全上下文：`localhost`、局域网 HTTPS 或 DSH 桌面客户端均可；直接用 `file://` 打开浏览器无法调用摄像头。

## 目录结构

```
dsh-harness-gate/
├── index.js              宿主半边：注入行 + vendor 资源路由
├── lib/
│   ├── injections.js     构造 style/script 注入行
│   └── route.js          Range / MIME / 路径逃逸防护
├── runtime/
│   ├── gate.css          门禁 UI 样式（全部 scoped 到 #dshg-root）
│   └── gate.js           浏览器运行时：引擎/摄像头/检测/比对/语音
├── vendor/               MediaPipe wasm + face_landmarker.task
├── scripts/              校验、安装、卸载脚本
├── cordis.patch.yml      bundle patch 层
└── package.json
```

## 说明

- 本插件只做 1:1 验证（本次会话内注册 → 本次会话内比对），不涉及多人 1:N 检索，因此不需要向量数据库。
- 生物特征是几何向量（60 维）+ 虹膜灰度纹理（48×2 维），对姿态/光照的鲁棒性有限，属于展示级门禁，不应作为高安全场景的唯一凭证。
- 无任何外部网络依赖；所有推理在本地完成。

## License

MIT
