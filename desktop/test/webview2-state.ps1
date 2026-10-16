# What the app and WebView2 were doing, for a launch test/webview2.mjs gave up on: their windows,
# WebView2's processes and the ports they listen on, the profile's files, and the ports Windows
# keeps back. With -Screen, a picture of the screen too, which CI keeps.
#
#   powershell -File test/webview2-state.ps1 -ProcessId <pid> -WebViewProfile <folder> [-Screen <png>]
param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$WebViewProfile,
  [string]$Screen
)
$ErrorActionPreference = "Continue"
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Windows {
  delegate bool EnumProc(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);

  /** Each visible top-level window of these processes, as its process, class, and title. */
  public static List<string> Of(uint[] pids) {
    var found = new List<string>();
    EnumWindows((top, _) => {
      uint owner;
      GetWindowThreadProcessId(top, out owner);
      if (Array.IndexOf(pids, owner) < 0 || !IsWindowVisible(top)) return true;
      var text = new StringBuilder(256);
      var name = new StringBuilder(256);
      GetWindowText(top, text, text.Capacity);
      GetClassName(top, name, name.Capacity);
      found.Add(owner + " " + name + " '" + text + "'");
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

$app = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if ($app) { "The app: running, responding $($app.Responding)" } else { "The app: gone" }

# The app's WebView2 processes: its browser process, and what that starts.
$all = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'")
$webviews = @($all | Where-Object { $_.ParentProcessId -eq $ProcessId })
$webviews += @($all | Where-Object { $webviews.ProcessId -contains $_.ParentProcessId })
"WebView2's processes: $($webviews.Count), of $($all.Count) running"
foreach ($process in $webviews) {
  if ($process.CommandLine -match "--type=(\S+)") { $what = $Matches[1] } else { $what = $process.CommandLine }
  "  $($process.ProcessId), from $($process.ParentProcessId): $what"
}

$ids = @($ProcessId) + @($webviews | ForEach-Object { $_.ProcessId })
"Their windows:"
[Windows]::Of([uint32[]]$ids) | ForEach-Object { "  $_" }

"What they listen on:"
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $ids -contains $_.OwningProcess } |
  ForEach-Object { "  $($_.OwningProcess) on $($_.LocalAddress):$($_.LocalPort)" }

$folder = Join-Path $WebViewProfile "EBWebView"
if (Test-Path $folder) {
  "The profile: $((Get-ChildItem $folder -Name) -join ', ')"
  $reports = Join-Path $folder "Crashpad\reports"
  if (Test-Path $reports) { "  crash reports: $(@(Get-ChildItem $reports).Count)" }
} else {
  "The profile: no EBWebView folder in $WebViewProfile"
}

"Ports Windows keeps back:"
netsh interface ipv4 show excludedportrange protocol=tcp | Where-Object { $_.Trim() } | ForEach-Object { "  $_" }

if ($Screen) {
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($Screen, [System.Drawing.Imaging.ImageFormat]::Png)
    "The screen: $Screen"
  } catch {
    "The screen: $($_.Exception.Message)"
  }
}
