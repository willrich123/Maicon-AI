$ErrorActionPreference='Stop'
$raiz=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
try {
 $saude=Invoke-RestMethod 'http://127.0.0.1:8787/api/ia/saude' -TimeoutSec 2
 if($saude.ok -eq $true){Write-Output 'API local já está respondendo.';exit 0}
}catch{}
if(Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue){throw 'A porta 8787 está ocupada por outro serviço. Nenhum processo foi encerrado.'}
$logs=Join-Path $raiz 'data'
[void][IO.Directory]::CreateDirectory($logs)
$node=(Get-Command node.exe).Source
$processo=Start-Process -FilePath $node -ArgumentList @('--watch','--watch-preserve-output','server/index.js') -WorkingDirectory $raiz -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'api-local.stdout.log') -RedirectStandardError (Join-Path $logs 'api-local.stderr.log') -PassThru
for($i=0;$i -lt 20;$i++){
 Start-Sleep -Milliseconds 250
 try{$saude=Invoke-RestMethod 'http://127.0.0.1:8787/api/ia/saude' -TimeoutSec 1;if($saude.ok -eq $true){Write-Output 'API local iniciada e verificada.';exit 0}}catch{}
}
throw 'A API não confirmou a inicialização. Confira data/api-local.stderr.log.'
