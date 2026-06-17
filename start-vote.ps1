$node = "C:\Users\user1\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (-not (Test-Path $node)) {
  Write-Host "Node 실행 파일을 찾을 수 없습니다."
  exit 1
}

Set-Location $PSScriptRoot
& $node server.js
