# omp-glm-hub 安装脚本
# 把扩展路径写入 OMP 全局配置的 extensions 数组（改源码即生效，无需拷贝）
# 用法：powershell -ExecutionPolicy Bypass -File .\install.ps1

$ErrorActionPreference = "Stop"

# 源文件绝对路径（转正斜杠，OMP 期望的格式）
$srcPath = (Join-Path $PSScriptRoot "src\glm-hub.ts") -replace '\\', '/'

if (-not (Test-Path ($srcPath -replace '/', '\'))) {
    Write-Host "错误：找不到源文件 src\glm-hub.ts" -ForegroundColor Red
    exit 1
}

Write-Host "omp-glm-hub 安装" -ForegroundColor Cyan
Write-Host "源文件：$srcPath"
Write-Host ""

# 读当前 extensions 配置
$raw = & omp config get extensions --json 2>$null | Out-String
$existing = @()
if ($LASTEXITCODE -eq 0 -and $raw.Trim()) {
    try {
        $cfg = $raw | ConvertFrom-Json
        if ($cfg.value) { $existing = @($cfg.value) }
    } catch {
        Write-Host "警告：无法解析当前 extensions 配置，将覆盖" -ForegroundColor Yellow
    }
}

# 去重检查
$normalized = $existing | ForEach-Object { $_ -replace '\\', '/' }
if ($normalized -contains $srcPath) {
    Write-Host "✓ 已配置，无需重复添加" -ForegroundColor Green
} else {
    $newArr = @($normalized) + $srcPath
    # 单元素时确保是 JSON 数组格式
    $json = if ($newArr.Count -eq 1) {
        '["' + $newArr[0] + '"]'
    } else {
        $newArr | ConvertTo-Json -Compress
    }
    & omp config set extensions $json
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ 已写入 OMP 配置：$srcPath" -ForegroundColor Green
    } else {
        Write-Host "✗ omp config set 失败，请手动编辑 ~/.omp/agent/config.yml" -ForegroundColor Red
        Write-Host "  在 extensions 数组中加入：$srcPath"
        exit 1
    }
}

# 检查旧副本（从 extensions 目录自动发现的），提示清理
$oldCopy = Join-Path $env:USERPROFILE ".omp\agent\extensions\glm-usage.ts"
if (Test-Path $oldCopy) {
    Write-Host ""
    Write-Host "检测到旧副本：$oldCopy" -ForegroundColor Yellow
    $ans = Read-Host "是否删除旧副本以避免重复加载？(y/N)"
    if ($ans -eq 'y' -or $ans -eq 'Y') {
        Remove-Item $oldCopy -Force
        Write-Host "✓ 已删除旧副本" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "完成！重启 OMP 生效。" -ForegroundColor Cyan
Write-Host "运行 /glm-config 配置样式，/glm-usage 查询详情" -ForegroundColor DarkGray
