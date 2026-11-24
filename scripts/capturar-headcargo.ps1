$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../server/alvoHeadcargo.ps1')
$processos=@(Processos-HeadCargo)
if($processos.Count -ne 1){throw 'Sessão ausente ou ambígua'}
$alvo=Janela-HeadCargo $processos[0]
$env:HC_BIBLIOTECA='1'
. (Join-Path $PSScriptRoot '../server/preencherCampo.ps1')
$script:janela=$alvo
[HcCampo]::Raiz=$alvo
$foto=Foto-Janela
$saida=Join-Path (Join-Path $PSScriptRoot '../data') 'headcargo-validacao.png'
$foto.Bitmap.Save($saida,[System.Drawing.Imaging.ImageFormat]::Png)
$palavras=@(Palavras-DaFoto $foto)
$foto.Bitmap.Dispose()
[pscustomobject]@{imagem=$saida;palavras=@($palavras|Where-Object {$_.Y -lt 170 -or $_.Y -gt 985})}|ConvertTo-Json -Depth 4 -Compress
