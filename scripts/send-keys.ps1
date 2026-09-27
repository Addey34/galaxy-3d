param([string]$Keys, [int]$PreDelayMs = 400, [switch]$FocusOnly, [switch]$ReportOnly)

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, IntPtr e);
}
"@

function Get-BenchWindow {
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -like '*--user-data-dir=C:\a11y\cp*' } |
    ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } |
    Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}

function Get-Title([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 512
  [void][Win]::GetWindowText($h, $sb, 512)
  return $sb.ToString()
}

# -ReportOnly : dire QUI est au premier plan, sans rien y changer. Sert au banc pour savoir si
# ce que NVDA vient d'annoncer est attribuable a l'application mesuree.
if ($ReportOnly) {
  $fg = [Win]::GetForegroundWindow()
  Write-Output (Get-Title $fg)
  exit 0
}

$proc = Get-BenchWindow
if (-not $proc) { Write-Output "ERREUR: fenetre du banc introuvable"; exit 1 }
$target = $proc.MainWindowHandle

# Windows refuse SetForegroundWindow a un processus d'arriere-plan. Les deux contournements
# documentes, dans cet ordre : un appui ALT (qui debloque la file d'entree), puis l'attachement
# du fil d'entree courant a celui de la fenetre actuellement au premier plan.
for ($try = 0; $try -lt 6; $try++) {
  if ([Win]::GetForegroundWindow() -eq $target) { break }
  [Win]::keybd_event(0x12, 0, 0, [IntPtr]::Zero)          # ALT down
  [Win]::keybd_event(0x12, 0, 2, [IntPtr]::Zero)          # ALT up
  $fg = [Win]::GetForegroundWindow()
  $fgThread = [Win]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
  $me = [Win]::GetCurrentThreadId()
  [void][Win]::AttachThreadInput($me, $fgThread, $true)
  [void][Win]::ShowWindow($target, 9)                      # SW_RESTORE
  [void][Win]::BringWindowToTop($target)
  [void][Win]::SetForegroundWindow($target)
  [void][Win]::AttachThreadInput($me, $fgThread, $false)
  Start-Sleep -Milliseconds 220
}

Start-Sleep -Milliseconds $PreDelayMs
$fg = [Win]::GetForegroundWindow()
if ($fg -ne $target) {
  Write-Output ("ERREUR: premier plan = [" + (Get-Title $fg) + "], attendu [" + (Get-Title $target) + "]")
  exit 2
}
if ($FocusOnly) { Write-Output ("OK focus: [" + (Get-Title $target) + "]"); exit 0 }

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($Keys)
Write-Output ("OK: '" + $Keys + "' -> [" + (Get-Title $target) + "]")
