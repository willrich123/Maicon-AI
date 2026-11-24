$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$trava = $null
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $entrada = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $perfil = $entrada.perfil
  $tarefa = $entrada.tarefa
  $sessao = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
  $trava = New-Object System.Threading.Mutex($false, "Local\MaiconPonteHeadCargo-$sessao")
  if (-not $trava.WaitOne(0)) { throw 'Desktop ocupado' }
  $temTrava = $true

  function Raiz {
    $processos = @(Get-Process | Where-Object { $_.SessionId -eq $sessao -and $_.MainWindowHandle -ne 0 -and $_.Path -eq $perfil.executavel })
    if ($processos.Count -ne 1) { throw 'Janela não identificada' }
    return [System.Windows.Automation.AutomationElement]::FromHandle($processos[0].MainWindowHandle)
  }
  function Controle($seletor) {
    if (-not $seletor -or (-not $seletor.id -and -not $seletor.nome)) { throw 'Seletor ausente' }
    $itens = (Raiz).FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $achados = @()
    foreach ($item in $itens) {
      if ($item.Current.IsOffscreen) { continue }
      if ($seletor.id -and $item.Current.AutomationId -cne $seletor.id) { continue }
      if ($seletor.nome -and $item.Current.Name -cne $seletor.nome) { continue }
      if ($seletor.tipo -and $item.Current.ControlType.ProgrammaticName -ne "ControlType.$($seletor.tipo)") { continue }
      $achados += $item
    }
    if ($achados.Count -ne 1) { throw 'Controle ausente ou ambíguo' }
    return $achados[0]
  }
  function Texto($elemento) {
    $padrao = $null
    if ($elemento.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$padrao)) { return $padrao.Current.Value.Trim() }
    return $elemento.Current.Name.Trim()
  }
  function Padrao-Valor($campo) {
    if (-not $campo.Current.IsEnabled) { throw 'Campo indisponível' }
    if ($campo.Current.ControlType -notin @([System.Windows.Automation.ControlType]::Edit, [System.Windows.Automation.ControlType]::ComboBox)) { throw 'Tipo de campo não suportado' }
    $padrao = $null
    if ($campo.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$padrao)) {
      if ($padrao.Current.IsReadOnly) { throw 'Campo somente leitura' }
      return $padrao
    }
    # Combos editáveis podem expor ValuePattern somente no Edit interno.
    # Não abrir listas nem selecionar outro usuário por posição.
    if ($campo.Current.ControlType -ne [System.Windows.Automation.ControlType]::ComboBox) { throw 'Campo não editável' }
    $condicao = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
    $edits = @($campo.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condicao) | Where-Object { $_.Current.IsEnabled -and -not $_.Current.IsOffscreen })
    if ($edits.Count -ne 1 -or $edits[0].Current.ClassName -eq 'TDBEdit') { throw 'Editor do usuário ausente ou ambíguo' }
    return Padrao-Valor $edits[0]
  }
  function Valor($seletor, [string]$valor) {
    $campo = Controle $seletor
    if ($campo.Current.ClassName -eq 'TDBEdit') { throw 'Campo vinculado não permitido' }
    [void](Padrao-Valor $campo).SetValue($valor)
  }
  function Invocar($seletor) {
    $botao = Controle $seletor
    if (-not $botao.Current.IsEnabled) { throw 'Botão indisponível' }
    [void]$botao.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  }
  function Desconectado {
    try {
      $usuario = Controle $perfil.login.usuario
      $senha = Controle $perfil.login.senha
      if ($usuario.Current.ClassName -eq 'TDBEdit' -or -not $senha.Current.IsPassword) { return $false }
      [void](Padrao-Valor $usuario)
      [void](Padrao-Valor $senha)
      return $true
    } catch { return $false }
  }
  function Identidade {
    $valor = Texto (Controle $perfil.identidade.controle)
    $esperado = $perfil.identidade.modelo.Replace('{usuario}', [string]$tarefa.usuario)
    if (-not $tarefa.usuario -or $valor -ine $esperado) { throw 'Identidade não confirmada' }
  }
  function Usuario-Atual {
    $modelo = [string]$perfil.identidade.modelo
    $partes = $modelo.Split(@('{usuario}'), [System.StringSplitOptions]::None)
    if ($partes.Count -ne 2) { throw 'Modelo de identidade inválido' }
    $texto = Texto (Controle $perfil.identidade.controle)
    if (-not $texto.StartsWith($partes[0]) -or -not $texto.EndsWith($partes[1])) { throw 'Identidade não identificada' }
    $tamanho = $texto.Length - $partes[0].Length - $partes[1].Length
    if ($tamanho -le 0 -or $tamanho -gt 120) { throw 'Identidade inválida' }
    return $texto.Substring($partes[0].Length, $tamanho).Trim()
  }
  $resultado = @{ ok = $false }
  switch ($tarefa.acao) {
    'sondar' {
      if (Desconectado) { $resultado = @{ ok = $true; desconectado = $true } }
      else { $resultado = @{ ok = $true; usuario = (Usuario-Atual) } }
    }
    'confirmar-identidade' { Identidade; $resultado = @{ ok = $true; usuario = $tarefa.usuario } }
    'entrar' {
      if (-not (Desconectado)) { throw 'Sessão já autenticada' }
      Valor $perfil.login.usuario $tarefa.usuario
      Valor $perfil.login.senha $tarefa.senha
      $tarefa.senha = $null
      Invocar $perfil.login.entrar
      $confirmado = $false
      for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        try { Identidade; $confirmado = $true; break } catch {}
      }
      if (-not $confirmado) { throw 'Login não confirmado' }
      $resultado = @{ ok = $true; usuario = $tarefa.usuario }
    }
    'consultar' {
      Identidade
      # Perfil permite apenas campo de pesquisa não vinculado a dados do ERP.
      $pesquisa = Controle $perfil.processo.pesquisa
      if ($pesquisa.Current.ClassName -notin @('TEdit', 'Edit')) { throw 'Pesquisa não validada' }
      Valor $perfil.processo.pesquisa $tarefa.numero
      Invocar $perfil.processo.buscar
      $confirmado = $false
      for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 250
        if ((Texto (Controle $perfil.processo.numero)) -ieq $tarefa.numero) { $confirmado = $true; break }
      }
      if (-not $confirmado) { throw 'Processo não confirmado' }
      Identidade
      $aba = Controle $perfil.atividades.aba
      [void]$aba.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
      if (-not $aba.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected) { throw 'Aba não selecionada' }
      $grade = Controle $perfil.atividades.grade
      $grid = $grade.GetCurrentPattern([System.Windows.Automation.GridPattern]::Pattern)
      $total = $grid.Current.RowCount
      if ($total -lt 0 -or $total -gt 2000) { throw 'Quantidade fora do limite' }
      $linhas = @()
      for ($i = 0; $i -lt $total; $i++) {
        $linha = @{}
        foreach ($campo in @('codigo','atividade','situacao','responsavel','previsao')) {
          $indice = $perfil.atividades.colunas.$campo
          if ($null -eq $indice -or $indice -isnot [int] -or $indice -lt 0 -or $indice -ge $grid.Current.ColumnCount) { throw 'Coluna não mapeada' }
          $linha[$campo] = Texto ($grid.GetItem($i, $indice))
        }
        if (-not $linha.atividade) { throw 'Linha não lida' }
        $linhas += $linha
      }
      Identidade
      if ((Texto (Controle $perfil.processo.numero)) -ine $tarefa.numero) { throw 'Processo mudou durante leitura' }
      $resultado = @{ ok = $true; numero = $tarefa.numero; atividades = @($linhas) }
    }
    'sair' {
      Identidade
      Invocar $perfil.sair
      $confirmado = $false
      for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Milliseconds 250; if (Desconectado) { $confirmado = $true; break } }
      $resultado = @{ ok = $confirmado; desconectado = $confirmado }
    }
    default { throw 'Operação não permitida' }
  }
  $resultado | ConvertTo-Json -Depth 8 -Compress
} catch {
  # Nunca devolver a exceção de UIA: pode conter valores de campos/credenciais.
  [Console]::WriteLine('{"ok":false}')
} finally {
  if ($trava) { if ($temTrava) { [void]$trava.ReleaseMutex() }; $trava.Dispose() }
}
