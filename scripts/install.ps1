# dsh-harness-gate 本地安装脚本（Windows / PowerShell）
# 用法：在 DSH 里 "设置 → 插件 → 添加插件" 粘贴 github:Rekeryang/dsh-harness-gate#main 更省事。
#      本脚本用于把本地源码 link 进 DSH profile。

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Write-Host "DEEPSEEK HARNESS GATE — local install" -ForegroundColor Cyan
Write-Host "Repo: $repo"

if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
  Write-Host "未找到 dsh 命令，请在 DSH 环境（已安装 dsh CLI）中运行。" -ForegroundColor Red
  Write-Host "也可以用图形界面：设置 → 插件 → 添加插件 → 粘贴 github:Rekeryang/dsh-harness-gate#main" -ForegroundColor Yellow
  exit 1
}

$profile = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'web' }
Write-Host "Installing into profile: $profile" -ForegroundColor Cyan
& dsh plugin --profile $profile add "link:$repo"

Write-Host ""
Write-Host "安装完成。请【完全退出并重新打开 DSH】（仅刷新页面不生效）。" -ForegroundColor Green
Write-Host "首次启动会显示生物识别门禁：录入人脸 → 刷脸 → 语音确认 → 进入 DSH。" -ForegroundColor Green
