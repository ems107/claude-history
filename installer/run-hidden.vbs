' Runs its arguments as one command line, with a hidden window, and waits.
'
' The elevated host's scheduled task points here: a console program started
' by Task Scheduler in the user's session opens a console window, and wscript
' is the only zero-flash way to start one hidden (the same reason the server
' itself goes through start-hidden.vbs). Every argument is quoted again on the
' way through, so paths with spaces arrive whole.
'
' Waiting (bWaitOnReturn:=True) keeps node.exe inside the task's process tree,
' and the exit code is passed back so Task Scheduler's "Last Run Result" says
' how the host ended.
Option Explicit

Dim shell, cmd, i
Set shell = CreateObject("WScript.Shell")

cmd = ""
For i = 0 To WScript.Arguments.Count - 1
  If i > 0 Then cmd = cmd & " "
  cmd = cmd & """" & WScript.Arguments(i) & """"
Next

WScript.Quit shell.Run(cmd, 0, True)
