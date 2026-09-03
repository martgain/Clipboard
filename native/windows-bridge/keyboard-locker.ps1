# Windows low-level keyboard locker helper for Clipboard Shelf
# Uses WH_KEYBOARD_LL to temporarily block global keyboard input while keeping mouse active.
# Ctrl+Alt+Shift+K is the emergency unlock chord.
# NEVER logs or stores keystrokes.

$ErrorActionPreference = "Stop"

$csharpSource = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace KeyboardLocker {
    public delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT {
        public int vkCode;
        public int scanCode;
        public int flags;
        public int time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int pt_x;
        public int pt_y;
    }

    public static class NativeMethods {
        public const int WH_KEYBOARD_LL = 13;
        public const int WM_KEYDOWN = 0x0100;
        public const int WM_KEYUP = 0x0101;
        public const int WM_SYSKEYDOWN = 0x0104;
        public const int WM_SYSKEYUP = 0x0105;
        public const uint WM_QUIT = 0x0012;

        public const int VK_SHIFT = 0x10;
        public const int VK_CONTROL = 0x11;
        public const int VK_MENU = 0x12;
        public const int VK_K = 0x4B;

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll", CharSet = CharSet.Auto, ExactSpelling = true)]
        public static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        public static extern bool TranslateMessage([In] ref MSG lpMsg);

        [DllImport("user32.dll")]
        public static extern IntPtr DispatchMessage([In] ref MSG lpMsg);

        [DllImport("user32.dll")]
        public static extern bool PostThreadMessage(uint idThread, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();
    }

    public class LockerSession {
        private static readonly object _syncRoot = new object();
        private static IntPtr _hookHandle = IntPtr.Zero;
        private static LowLevelKeyboardProc _proc;
        private static volatile bool _locked = false;
        private static uint _hookThreadId = 0;
        private static Thread _hookThread = null;
        private static ManualResetEvent _hookStarted = new ManualResetEvent(false);
        private static string _hookError = null;
        private static volatile bool _suppressNextKeyUpK = false;

        public static bool IsLocked {
            get { return _locked; }
        }

        public static void SetLocked(bool locked) {
            _locked = locked;
        }

        public static void EmitStatus(string json) {
            lock (_syncRoot) {
                Console.Out.WriteLine(json);
                Console.Out.Flush();
            }
        }

        public static bool Start(out string error) {
            error = null;
            _proc = HookCallback;
            _hookStarted.Reset();
            _hookError = null;

            _hookThread = new Thread(HookThreadLoop);
            _hookThread.IsBackground = true;
            _hookThread.Start();

            if (!_hookStarted.WaitOne(5000)) {
                error = "Timeout waiting for hook initialization";
                return false;
            }

            if (!string.IsNullOrEmpty(_hookError)) {
                error = _hookError;
                return false;
            }

            if (_hookHandle == IntPtr.Zero) {
                error = "Hook handle is null";
                return false;
            }

            return true;
        }

        public static void Stop() {
            _locked = false;
            if (_hookThreadId != 0) {
                NativeMethods.PostThreadMessage(_hookThreadId, NativeMethods.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
            }
            if (_hookThread != null && _hookThread.IsAlive) {
                _hookThread.Join(2000);
            }
            if (_hookHandle != IntPtr.Zero) {
                NativeMethods.UnhookWindowsHookEx(_hookHandle);
                _hookHandle = IntPtr.Zero;
            }
        }

        private static void HookThreadLoop() {
            _hookThreadId = NativeMethods.GetCurrentThreadId();
            try {
                using (var curProcess = Process.GetCurrentProcess())
                using (var curModule = curProcess.MainModule) {
                    IntPtr hMod = NativeMethods.GetModuleHandle(curModule.ModuleName);
                    _hookHandle = NativeMethods.SetWindowsHookEx(NativeMethods.WH_KEYBOARD_LL, _proc, hMod, 0);
                }

                if (_hookHandle == IntPtr.Zero) {
                    int err = Marshal.GetLastWin32Error();
                    _hookError = "SetWindowsHookEx failed with error code " + err;
                    _hookStarted.Set();
                    return;
                }
            } catch (Exception ex) {
                _hookError = ex.Message;
                _hookStarted.Set();
                return;
            }

            _hookStarted.Set();

            MSG msg;
            while (NativeMethods.GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
                NativeMethods.TranslateMessage(ref msg);
                NativeMethods.DispatchMessage(ref msg);
            }

            if (_hookHandle != IntPtr.Zero) {
                NativeMethods.UnhookWindowsHookEx(_hookHandle);
                _hookHandle = IntPtr.Zero;
            }
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
            if (nCode >= 0) {
                int msg = (int)wParam;
                KBDLLHOOKSTRUCT hookStruct = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                int vk = hookStruct.vkCode;

                // Recognize Ctrl+Alt+Shift+K emergency unlock chord
                if (vk == NativeMethods.VK_K) {
                    if (msg == NativeMethods.WM_KEYDOWN || msg == NativeMethods.WM_SYSKEYDOWN) {
                        bool ctrl = (NativeMethods.GetAsyncKeyState(NativeMethods.VK_CONTROL) & 0x8000) != 0;
                        bool alt = (NativeMethods.GetAsyncKeyState(NativeMethods.VK_MENU) & 0x8000) != 0;
                        bool shift = (NativeMethods.GetAsyncKeyState(NativeMethods.VK_SHIFT) & 0x8000) != 0;

                        if (ctrl && alt && shift) {
                            bool wasLocked = _locked;
                            _locked = false;
                            _suppressNextKeyUpK = true;
                            if (wasLocked) {
                                ThreadPool.QueueUserWorkItem(_ => {
                                    EmitStatus("{\"type\":\"state\",\"locked\":false,\"reason\":\"emergency-shortcut\"}");
                                });
                            }
                            return (IntPtr)1;
                        }
                    } else if (msg == NativeMethods.WM_KEYUP || msg == NativeMethods.WM_SYSKEYUP) {
                        if (_suppressNextKeyUpK) {
                            _suppressNextKeyUpK = false;
                            return (IntPtr)1;
                        }
                    }
                }

                if (_locked) {
                    return (IntPtr)1;
                }
            }

            return NativeMethods.CallNextHookEx(_hookHandle, nCode, wParam, lParam);
        }
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'KeyboardLocker.LockerSession').Type) {
    Add-Type -TypeDefinition $csharpSource
}

$hookError = ""
$started = [KeyboardLocker.LockerSession]::Start([ref]$hookError)
if (-not $started) {
    [KeyboardLocker.LockerSession]::EmitStatus(('{"type":"error","code":"HOOK_INSTALL_FAILED","message":"' + ($hookError -replace '"', '\"') + '"}'))
    exit 1
}

# Announce ready
[KeyboardLocker.LockerSession]::EmitStatus('{"type":"ready","locked":false}')

try {
    while ($null -ne ($line = [Console]::In.ReadLine())) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) {
            continue
        }

        try {
            $cmd = ConvertFrom-Json -InputObject $trimmed
            if ($cmd.action -eq "set") {
                $targetLocked = [bool]$cmd.locked
                [KeyboardLocker.LockerSession]::SetLocked($targetLocked)
                if ($targetLocked) {
                    [KeyboardLocker.LockerSession]::EmitStatus('{"type":"state","locked":true}')
                } else {
                    [KeyboardLocker.LockerSession]::EmitStatus('{"type":"state","locked":false}')
                }
            } elseif ($cmd.action -eq "stop") {
                break
            } else {
                [KeyboardLocker.LockerSession]::EmitStatus('{"type":"error","code":"UNKNOWN_ACTION","message":"Unknown action"}')
            }
        } catch {
            [KeyboardLocker.LockerSession]::EmitStatus('{"type":"error","code":"INVALID_JSON","message":"Malformed JSON command"}')
        }
    }
} finally {
    [KeyboardLocker.LockerSession]::Stop()
}

exit 0
