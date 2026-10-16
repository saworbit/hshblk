# Presses a key in a Hash Block window as Windows delivers one, for test/webview2.mjs: posted to
# the window WebView2 draws the page in, by process, so it reaches no other app and needs no
# focus. The DevTools protocol's keys never reach WebView2's own shortcuts, F5 among them (#270).
# Ctrl is held through the thread's keyboard state, which the posted keys are read with.
#
#   powershell -File test/keys.ps1 -ProcessId <pid> -Key F5 [-Control]
param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$Key,
  [switch]$Control
)
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Keys {
  delegate bool EnumProc(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] static extern bool GetKeyboardState(byte[] state);
  [DllImport("user32.dll")] static extern bool SetKeyboardState(byte[] state);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

  /** The window WebView2 draws the page in, under the app's visible top-level window. */
  public static IntPtr Page(uint pid) {
    var found = IntPtr.Zero;
    EnumWindows((top, _) => {
      uint owner;
      GetWindowThreadProcessId(top, out owner);
      if (owner != pid || !IsWindowVisible(top)) return true;
      EnumChildWindows(top, (child, __) => {
        var name = new StringBuilder(256);
        GetClassName(child, name, name.Capacity);
        if (name.ToString() == "Chrome_RenderWidgetHostHWND") { found = child; return false; }
        return true;
      }, IntPtr.Zero);
      return found == IntPtr.Zero;
    }, IntPtr.Zero);
    return found;
  }

  public static void Press(IntPtr hwnd, uint key, bool control) {
    uint none;
    uint thread = GetWindowThreadProcessId(hwnd, out none);
    uint me = GetCurrentThreadId();
    byte[] state = new byte[256];
    if (control) {
      AttachThreadInput(me, thread, true);
      GetKeyboardState(state);
      state[0x11] |= 0x80;
      state[0xA2] |= 0x80;
      SetKeyboardState(state);
      Post(hwnd, 0x0100, 0x11, false);
    }
    Post(hwnd, 0x0100, key, false);
    Post(hwnd, 0x0101, key, true);
    if (control) {
      Post(hwnd, 0x0101, 0x11, true);
      System.Threading.Thread.Sleep(300);
      state[0x11] &= 0x7F;
      state[0xA2] &= 0x7F;
      SetKeyboardState(state);
      AttachThreadInput(me, thread, false);
    }
  }

  static void Post(IntPtr hwnd, uint message, uint key, bool up) {
    long scan = MapVirtualKey(key, 0);
    long l = 1 | (scan << 16) | (up ? (3L << 30) : 0);
    PostMessage(hwnd, message, (IntPtr)key, (IntPtr)l);
  }
}
"@
$codes = @{ F5 = 0x74; R = 0x52 }
$hwnd = [Keys]::Page([uint32]$ProcessId)
if ($hwnd -eq [IntPtr]::Zero) { throw "No WebView2 window for process $ProcessId." }
[Keys]::Press($hwnd, [uint32]$codes[$Key], [bool]$Control)
