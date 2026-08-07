' Start Menu shortcut target: opens claude-history in the default browser,
' starting the scheduled task first if the server is not running.
Option Explicit

' 127.0.0.1, not localhost: the server binds IPv4 loopback only and Windows
' resolves localhost to ::1 first.
Const APP_URL = "http://127.0.0.1:7433"
Const HEALTH_URL = "http://127.0.0.1:7433/api/health"
Const TASK_NAME = "claude-history"

Function IsUp()
  Dim http
  IsUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", HEALTH_URL, False
  http.Send
  If Err.Number = 0 And http.Status = 200 Then IsUp = True
  On Error GoTo 0
End Function

Dim shell, i
Set shell = CreateObject("WScript.Shell")

If Not IsUp() Then
  ' Starting our own per-user task needs no elevation; if it is already
  ' running this is a no-op (task policy: IgnoreNew).
  shell.Run "schtasks /Run /TN " & TASK_NAME, 0, True
  For i = 1 To 30
    WScript.Sleep 500
    If IsUp() Then Exit For
  Next
End If

shell.Run APP_URL
