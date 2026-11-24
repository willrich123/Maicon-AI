function Selecionar-ProcessosHeadCargo($Candidatos, [string]$Esperado, [int]$Sessao) {
  $selecionados=@()
  foreach ($candidato in $Candidatos) {
    if ($candidato.SessionId -ne $Sessao) { continue }
    $caminho=$null
    try { $caminho=$candidato.Path } catch { }
    if (-not $caminho) {
      throw 'O HeadCargo foi detectado, mas o Windows não permitiu verificar seu executável. Se ele estiver como administrador, abra-o normalmente, com o mesmo usuário do Maicon.'
    }
    if ($caminho -ieq $Esperado) { $selecionados+=$candidato }
  }
  return $selecionados
}

function Assert-PermissaoHeadCargo($Processo) {
  if (-not ('HcNivelAcesso' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HcNivelAcesso {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int info, out int elevation, int length, out int needed);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static int Elevado(int pid) {
    IntPtr process=OpenProcess(0x1000,false,pid), token=IntPtr.Zero;
    if(process==IntPtr.Zero)return -1;
    try { if(!OpenProcessToken(process,8,out token))return -1;
      int elevated,needed; return GetTokenInformation(token,20,out elevated,4,out needed)?elevated:-1;
    } finally {if(token!=IntPtr.Zero)CloseHandle(token);CloseHandle(process);}
  }
}
'@
  }
  $atual=[HcNivelAcesso]::Elevado($PID)
  $alvo=[HcNivelAcesso]::Elevado($Processo.Id)
  if ($alvo -lt 0 -or $atual -lt 0) { throw 'O HeadCargo foi detectado, mas não foi possível verificar as permissões para controlar a janela.' }
  if ($alvo -gt $atual) { throw 'O HeadCargo está aberto como administrador e o bot não. Abra o HeadCargo normalmente, sem Executar como administrador, para permitir o preenchimento pela tela.' }
}

function Janela-HeadCargo($Processo) {
  if (-not ('HcJanelaPrincipal' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class HcJanelaPrincipal {
  delegate bool EnumProc(IntPtr hwnd,IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder text,int length);
  public static IntPtr[] Localizar(int processId) {
    var encontrados=new List<IntPtr>();
    EnumWindows((h,l)=>{uint pid;GetWindowThreadProcessId(h,out pid);if(pid==processId){var s=new StringBuilder(256);GetClassName(h,s,256);if(s.ToString()=="TfrmPrincipal")encontrados.Add(h);}return true;},IntPtr.Zero);
    return encontrados.ToArray();
  }
}
'@
  }
  $janelas=@([HcJanelaPrincipal]::Localizar($Processo.Id))
  if($janelas.Count -ne 1){throw 'Janela principal do HeadCargo ausente ou ambígua'}
  return $janelas[0]
}

function Processos-HeadCargo {
  $esperado=[string]$env:HC_EXECUTAVEL
  if (-not $esperado) {
    if ($env:HC_AMBIENTE -eq 'homologacao') { throw 'Executável de homologação não configurado' }
    $esperado='C:\Program Files (x86)\HeadCargo Conline\Desktop.exe'
  }
  $esperado=[IO.Path]::GetFullPath($esperado)
  if ($env:HC_AMBIENTE -eq 'homologacao') {
    $raiz=[string]$env:HC_HOMOLOG_DIRETORIO
    if (-not $raiz) { $raiz='C:\Users\Conline47\Downloads\Conline - Homologação' }
    $raiz=[IO.Path]::GetFullPath($raiz).TrimEnd('\')+'\'
    if (-not $esperado.StartsWith($raiz,[StringComparison]::OrdinalIgnoreCase)) { throw 'Executável fora da homologação' }
  }
  $sessao=[Diagnostics.Process]::GetCurrentProcess().SessionId
  $candidatos=@(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($esperado)) -ErrorAction SilentlyContinue)
  $selecionados=@(Selecionar-ProcessosHeadCargo $candidatos $esperado $sessao)
  foreach($processo in $selecionados) { Assert-PermissaoHeadCargo $processo }
  return $selecionados
}
