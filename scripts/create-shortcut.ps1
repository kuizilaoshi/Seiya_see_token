$ErrorActionPreference = 'Stop'

function New-CnString([int[]]$codes) {
  return -join ($codes | ForEach-Object { [char]$_ })
}

function New-Shortcut($shortcutPath, $targetPath, $arguments, $workingDirectory, $iconPath, $description) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $targetPath
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $workingDirectory
  $shortcut.Description = $description
  if (Test-Path -LiteralPath $iconPath) {
    $shortcut.IconLocation = "$iconPath,0"
  }
  $shortcut.WindowStyle = 7
  $shortcut.Save()
}

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$scriptsDir = Join-Path $projectRoot 'scripts'
$codexVbs = Join-Path $scriptsDir 'launch-codex-with-widget.vbs'
$electronExe = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$iconPath = Join-Path $projectRoot 'assets\app-icon-borderless.ico'
$desktopDir = [Environment]::GetFolderPath('Desktop')

$usageWidget = New-CnString @(0x7528,0x91CF,0x5C0F,0x7EC4,0x4EF6)
$openText = New-CnString @(0x6253,0x5F00)

$desktopCodexWidget = Join-Path $desktopDir ('Codex + ' + $usageWidget + '.lnk')
$projectWidgetShortcut = Join-Path $projectRoot ($openText + $usageWidget + '.lnk')
$projectCodexWidgetShortcut = Join-Path $projectRoot ($openText + ' Codex + ' + $usageWidget + '.lnk')

if (!(Test-Path -LiteralPath $electronExe)) {
  throw "Electron executable not found: $electronExe"
}

New-Shortcut $desktopCodexWidget $wscript "`"$codexVbs`"" $projectRoot $iconPath 'Open Codex and Codex usage widget without console'
New-Shortcut $projectWidgetShortcut $electronExe "`"$projectRoot`"" $projectRoot $iconPath 'Open Codex usage widget without console'
New-Shortcut $projectCodexWidgetShortcut $wscript "`"$codexVbs`"" $projectRoot $iconPath 'Open Codex and Codex usage widget without console'

Write-Output "Created shortcut: $desktopCodexWidget"
Write-Output "Created shortcut: $projectWidgetShortcut"
Write-Output "Created shortcut: $projectCodexWidgetShortcut"
