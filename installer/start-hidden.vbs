' Launches the claude-history server with a hidden console window.
' This file lives INSIDE a version folder and resolves everything relative
' to itself, so the scheduled task action (which points through the stable
' `current` junction) never changes across updates.
'
' Window style 0 (hidden) + bWaitOnReturn:=True keeps node.exe inside the
' scheduled task's process tree, so "End" in Task Scheduler stops the server.
Option Explicit

Dim fso, shell, here, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here

' --exit-with-parent: Task Scheduler's "End" only kills this wscript
' process, so the server watches it and exits when it dies.
cmd = """" & here & "\node\node.exe"" """ & here & "\server.cjs""" & _
      " --serve-static """ & here & "\web"" --exit-with-parent"
shell.Run cmd, 0, True
