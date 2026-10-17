# Presses a key in a Hash Block window as Windows delivers one, for test/webview2.mjs: posted to
# the window WebView2 draws the page in, by process, so it reaches no other app. WebView2 drops a
# key posted while its page has no focus, so the test gives it focus first (#329). The DevTools
# protocol's keys never reach WebView2's own shortcuts, F5 among them (#270). Ctrl is held
# through the thread's keyboard state, which the posted keys are read with. It prints the window
# and thread it posted to, whether that window was in front, and whether each step took.
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

  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] static extern short GetKeyState(int key);

  public static string Press(IntPtr hwnd, uint key, bool control) {
    uint none;
    uint thread = GetWindowThreadProcessId(hwnd, out none);
    uint me = GetCurrentThreadId();
    byte[] state = new byte[256];
    var said = new List<string>();
    said.Add(String.Format("window 0x{0:x} on thread {1}", hwnd.ToInt64(), thread));
    said.Add("in front " + (GetForegroundWindow() == GetAncestor(hwnd, 2)));
    if (control) {
      said.Add("attached " + AttachThreadInput(me, thread, true));
      GetKeyboardState(state);
      state[0x11] |= 0x80;
      state[0xA2] |= 0x80;
      said.Add("Ctrl set " + SetKeyboardState(state));
      said.Add("Ctrl down " + (GetKeyState(0x11) < 0));
      said.Add("posted " + Post(hwnd, 0x0100, 0x11, false));
    }
    said.Add("posted " + Post(hwnd, 0x0100, key, false) + " " + Post(hwnd, 0x0101, key, true));
    if (control) {
      said.Add("posted " + Post(hwnd, 0x0101, 0x11, true));
      System.Threading.Thread.Sleep(300);
      state[0x11] &= 0x7F;
      state[0xA2] &= 0x7F;
      SetKeyboardState(state);
      AttachThreadInput(me, thread, false);
    }
    return String.Join(", ", said);
  }

  static bool Post(IntPtr hwnd, uint message, uint key, bool up) {
    long scan = MapVirtualKey(key, 0);
    long l = 1 | (scan << 16) | (up ? (3L << 30) : 0);
    return PostMessage(hwnd, message, (IntPtr)key, (IntPtr)l);
  }
}
"@
$codes = @{ F5 = 0x74; R = 0x52 }
$hwnd = [Keys]::Page([uint32]$ProcessId)
if ($hwnd -eq [IntPtr]::Zero) { throw "No WebView2 window for process $ProcessId." }
[Keys]::Press($hwnd, [uint32]$codes[$Key], [bool]$Control)
