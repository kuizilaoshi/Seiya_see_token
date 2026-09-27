Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
projectRoot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
codexShortcut = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Desktop\Codex.lnk"
electronExe = projectRoot & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(codexShortcut) Then
  shell.Run """" & codexShortcut & """", 0, False
End If
WScript.Sleep 1000
If fso.FileExists(electronExe) Then
  shell.Run """" & electronExe & """ """ & projectRoot & """", 0, False
Else
  shell.Run "cmd.exe /c cd /d """ & projectRoot & """ && npm.cmd start", 0, False
End If
