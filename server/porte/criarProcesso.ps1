$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$trava=$null
try {
 if($env:HC_AMBIENTE -ne 'homologacao'){throw 'Ambiente inválido'}
 . (Join-Path $PSScriptRoot '../alvoHeadcargo.ps1')
 Add-Type -AssemblyName UIAutomationClient
 Add-Type -AssemblyName UIAutomationTypes
 $entrada=[Console]::In.ReadToEnd()|ConvertFrom-Json
 $t=$entrada.tarefa; $p=$entrada.perfil
 if($p.validado -ne $true -or $p.sessaoDedicada -ne $true){throw 'Perfil não validado'}
 $processos=@(Processos-HeadCargo)
 if($processos.Count -ne 1){throw 'Sessão não identificada'}
 $processo=$processos[0]
 if($processo.SessionId -ne $p.sessaoWindows){throw 'HeadCargo fora da sessão Windows dedicada'}
 $janela=Janela-HeadCargo $processo
 $trava=New-Object Threading.Mutex($false,"Local\MaiconPonteHeadCargo-$($processo.SessionId)")
 if(-not $trava.WaitOne(0)){throw 'Sessão ocupada'}
 $bloqueada=$true
 function Controle($seletor){
  if(-not $seletor -or (-not $seletor.id -and -not $seletor.nome)){throw 'Seletor não mapeado'}
  $raiz=[Windows.Automation.AutomationElement]::FromHandle($janela)
  $itens=$raiz.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
  $achados=@($itens|Where-Object { -not $_.Current.IsOffscreen -and (-not $seletor.id -or $_.Current.AutomationId -ceq $seletor.id) -and (-not $seletor.nome -or $_.Current.Name -ceq $seletor.nome) -and (-not $seletor.tipo -or $_.Current.ControlType.ProgrammaticName -eq "ControlType.$($seletor.tipo)") })
  if($achados.Count -ne 1){throw 'Controle ausente ou ambíguo'}
  return $achados[0]
 }
 function Texto($seletor){$c=Controle $seletor; $v=$null; if($c.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$v)){return $v.Current.Value.Trim()};return $c.Current.Name.Trim()}
 function Identidade {
  if(-not $t.usuario -or (Texto $p.identidade) -ine $p.identidadeModelo.Replace('{usuario}',[string]$t.usuario)){throw 'Usuário nativo diferente da conta do portal'}
  $banco=[string]$env:HC_BANCO_NATIVO_ESPERADO
  if(-not $banco -or -not $p.ambienteModelo.Contains('{banco}') -or (Texto $p.ambiente) -ine $p.ambienteModelo.Replace('{banco}',$banco)){throw 'Catálogo nativo não confirmado'}
 }
 function Invocar($seletor){Identidade; $c=Controle $seletor;if(-not $c.Current.IsEnabled){throw 'Botão indisponível'};[void]$c.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()}
 function Preencher($seletor,[string]$valor){Identidade; $c=Controle $seletor;$v=$c.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern);if($v.Current.IsReadOnly -or -not $c.Current.IsEnabled){throw 'Campo indisponível'};[void]$v.SetValue($valor);if((Texto $seletor) -cne $valor){throw 'Preenchimento não confirmado'}}
 function Modalidade([bool]$Selecionar) {
  Identidade
  $nome=[string]$p.modalidades.($t.modalidade)
  if(-not $nome){throw 'Modalidade não identificada'}
  $seletor=@{id=$p.modalidade.id;nome=$nome;tipo=$p.modalidade.tipo}
  $c=Controle $seletor
  $item=$c.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)
  if($Selecionar){if(-not $c.Current.IsEnabled){throw 'Modalidade indisponível'};[void]$item.Select()}
  $atual=(Controle $seletor).GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)
  if(-not $atual.Current.IsSelected){throw 'Modalidade não confirmada'}
 }
 Identidade
 Invocar $p.operacional
 if($p.modalidadeAntesInserir -eq $true){Modalidade $true}
 # Não reutilizar um formulário que já esteja em edição.
 if((Controle $p.confirmar).Current.IsEnabled){throw 'Há uma edição em andamento'}
 $anterior=Texto $p.numero
 Invocar $p.inserir
 if($p.modalidadeAntesInserir -ne $true){Modalidade $true}
 Preencher $p.clienteCodigo ([string]$t.clienteCodigo)
 if((Texto $p.clienteNome) -ine $t.cliente){throw 'Cliente não resolvido pelo cadastro nativo'}
 Preencher $p.referencia ([string]$t.referencia)
 Modalidade $false
 if((Texto $p.clienteCodigo) -cne [string]$t.clienteCodigo -or (Texto $p.clienteNome) -ine $t.cliente -or (Texto $p.referencia) -cne [string]$t.referencia){throw 'O formulário diverge da solicitação'}
 Invocar $p.confirmar
 $numero=''
 for($i=0;$i -lt 40;$i++){
  Start-Sleep -Milliseconds 250
  Identidade
  $lido=Texto $p.numero
  if($lido -match ('^'+[regex]::Escape($t.modalidade)+'\d{2,6}-\d{2}( teste)?$') -and $lido -ne $anterior -and -not (Controle $p.confirmar).Current.IsEnabled){$numero=$lido;break}
 }
 if(-not $numero){throw 'Gravação não confirmada'}
 @{ok=$true;numero=$numero}|ConvertTo-Json -Compress
} catch { @{ok=$false}|ConvertTo-Json -Compress }
finally{if($trava){if($bloqueada){$trava.ReleaseMutex()};$trava.Dispose()}}
