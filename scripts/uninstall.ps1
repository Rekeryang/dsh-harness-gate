# dsh-harness-gate 卸载脚本（Windows / PowerShell）
$ErrorActionPreference = 'Stop'
Write-Host "DEEPSEEK HARNESS GATE — uninstall" -ForegroundColor Cyan

if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
  Write-Host "未找到 dsh 命令。请在 DSH 环境运行，或在 DSH 插件管理界面卸载。" -ForegroundColor Red
  exit 1
}

$profile = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'web' }
& dsh plugin --profile $profile remove dsh-harness-gate

Write-Host ""
Write-Host "卸载完成。请完全重启 DSH 使变更生效。" -ForegroundColor Green
