$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot '../server/alvoHeadcargo.ps1')
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$processos=@(Processos-HeadCargo)
if($processos.Count -ne 1){throw 'HeadCargo configurado ausente ou ambíguo'}
$processo=$processos[0]
$raiz=[System.Windows.Automation.AutomationElement]::FromHandle((Janela-HeadCargo $processo))
$itens=$raiz.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
$controles=@()
foreach($i in $itens){
 if($i.Current.IsPassword -or $i.Current.IsOffscreen){continue}
 $tipo=$i.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
 if($tipo -notin @('Button','Edit','ComboBox','TabItem','MenuItem','Text','StatusBar','ToolBar','Window','Pane')){continue}
 $nome=$i.Current.Name
 if($nome.Length -gt 150){$nome=$nome.Substring(0,150)}
 $r=$i.Current.BoundingRectangle
 $controles+=[pscustomobject]@{tipo=$tipo;nome=$nome;id=$i.Current.AutomationId;classe=$i.Current.ClassName;habilitado=$i.Current.IsEnabled;retangulo=@($r.X,$r.Y,$r.Width,$r.Height);padroes=@($i.GetSupportedPatterns()|ForEach-Object ProgrammaticName)}
 if($controles.Count -ge 220){break}
}
[pscustomobject]@{titulo=$raiz.Current.Name;classe=$raiz.Current.ClassName;controles=$controles}|ConvertTo-Json -Depth 5 -Compress
