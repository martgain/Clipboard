# Windows live smoke test for the keyboard lock helper.
# Launches the helper in isolation and drives it against a scratch Notepad window.
# Stages: pre-lock, locked, mouse-unlock, emergency-unlock, post-unlock.
# Never touches the Clipboard Shelf library, user data, or any real document.

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$helperPath = Join-Path $projectRoot "native/windows-bridge/keyboard-locker.ps1"

if (-not (Test-Path $helperPath)) {
    Write-Error "keyboard-locker.ps1 helper not found at $helperPath"
    exit 1
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$csharpSource = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class KeyboardLockSmokeNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")]
    public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int SendMessage(IntPtr hWnd, int msg, int wParam, StringBuilder lParam);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint Type;
        public KEYBDINPUT Keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint numberOfInputs, INPUT[] inputs, int inputSize);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    public const int WM_GETTEXT = 0x000D;
    public const int WM_GETTEXTLENGTH = 0x000E;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_KEYUP = 0x0002;

    public static string ReadEditText(IntPtr editHandle) {
        int length = SendMessage(editHandle, WM_GETTEXTLENGTH, 0, null);
        var buffer = new StringBuilder(length + 1);
        SendMessage(editHandle, WM_GETTEXT, buffer.Capacity, buffer);
        return buffer.ToString();
    }

    public static int SendText(string text) {
        var inputs = new System.Collections.Generic.List<INPUT>();
        foreach (char character in text) {
            short mappedKey = VkKeyScan(character);
            if (mappedKey == -1) return -1;
            ushort virtualKey = (ushort)(mappedKey & 0xff);
            byte modifiers = (byte)((mappedKey >> 8) & 0xff);
            if ((modifiers & 1) != 0) inputs.Add(KeyInput(0x10, 0));
            inputs.Add(KeyInput(virtualKey, 0));
            inputs.Add(KeyInput(virtualKey, KEYEVENTF_KEYUP));
            if ((modifiers & 1) != 0) inputs.Add(KeyInput(0x10, KEYEVENTF_KEYUP));
        }
        uint sentCount = SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
        return sentCount == inputs.Count ? 1 : -Math.Max(1, Marshal.GetLastWin32Error());
    }

    public static int SendEmergencyChord() {
        var inputs = new[] {
            KeyInput(0x11, 0), KeyInput(0x12, 0), KeyInput(0x10, 0), KeyInput(0x4b, 0),
            KeyInput(0x4b, KEYEVENTF_KEYUP), KeyInput(0x10, KEYEVENTF_KEYUP),
            KeyInput(0x12, KEYEVENTF_KEYUP), KeyInput(0x11, KEYEVENTF_KEYUP)
        };
        uint sentCount = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        return sentCount == inputs.Length ? 1 : -Math.Max(1, Marshal.GetLastWin32Error());
    }

    private static INPUT KeyInput(ushort virtualKey, uint flags) {
        return new INPUT {
            Type = INPUT_KEYBOARD,
            Keyboard = new KEYBDINPUT { VirtualKey = virtualKey, Flags = flags }
        };
    }

    [DllImport("user32.dll")]
    private static extern short VkKeyScan(char character);

    // Windows blocks a plain SetForegroundWindow call from a background process; attaching
    // input queues with the current foreground thread is the standard way to hand off focus
    // to a scratch window this script owns without disturbing unrelated foreground windows.
    public static bool ForceForeground(IntPtr targetWindow) {
        uint foregroundProcessId;
        uint targetThreadId = GetWindowThreadProcessId(GetForegroundWindow(), out foregroundProcessId);
        uint currentThreadId = GetCurrentThreadId();
        bool attached = targetThreadId != currentThreadId && AttachThreadInput(currentThreadId, targetThreadId, true);
        bool result = SetForegroundWindow(targetWindow);
        if (attached) {
            AttachThreadInput(currentThreadId, targetThreadId, false);
        }
        return result;
    }
}
'@
Add-Type -TypeDefinition $csharpSource

function Fail {
    param([string]$Stage, [string]$Message)
    throw "[$Stage] FAILED: $Message"
}

function Read-HelperLine {
    param([System.Diagnostics.Process]$Process, [int]$TimeoutMs = 5000)
    $task = $Process.StandardOutput.ReadLineAsync()
    if (-not $task.Wait($TimeoutMs)) {
        Fail "helper" "Timed out waiting for helper output"
    }
    return $task.Result
}

function Send-HelperCommand {
    param([System.Diagnostics.Process]$Process, [hashtable]$Command)
    $json = $Command | ConvertTo-Json -Compress
    $Process.StandardInput.WriteLine($json)
    $Process.StandardInput.Flush()
}

function Type-IntoNotepad {
    param([IntPtr]$WindowHandle, [string]$Text)
    if (-not [KeyboardLockSmokeNative]::ForceForeground($WindowHandle)) {
        Fail "setup" "Could not bring the scratch Notepad window to the foreground; another window is holding focus"
    }
    Start-Sleep -Milliseconds 200
    $sendResult = [KeyboardLockSmokeNative]::SendText($Text)
    if ($sendResult -ne 1) {
        Fail "typing" "Win32 SendInput could not emit the test text (code $sendResult)"
    }
    Start-Sleep -Milliseconds 300
}

$exitCode = 0
$notepad = $null
$helperProcess = $null

try {
    # Launch an isolated, throwaway Notepad window; nothing here is saved to disk.
    $notepad = Start-Process notepad.exe -PassThru
    Start-Sleep -Milliseconds 800
    $notepad.Refresh()
    if ($notepad.MainWindowHandle -eq [IntPtr]::Zero) {
        Fail "setup" "Could not obtain the Notepad main window handle"
    }
    $editHandle = [KeyboardLockSmokeNative]::FindWindowEx($notepad.MainWindowHandle, [IntPtr]::Zero, "Edit", $null)
    if ($editHandle -eq [IntPtr]::Zero) {
        Fail "setup" "Could not locate the Notepad edit control"
    }

    # Start the keyboard lock helper in isolation.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "powershell.exe"
    $psi.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$helperPath`""
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $helperProcess = [System.Diagnostics.Process]::Start($psi)

    $readyEvent = Read-HelperLine $helperProcess | ConvertFrom-Json
    if ($readyEvent.type -ne "ready" -or $readyEvent.locked -ne $false) {
        Fail "setup" "Helper did not announce a ready, unlocked state"
    }

    # PRE-LOCK CHECK: keyboard input reaches Notepad normally before locking.
    Type-IntoNotepad $notepad.MainWindowHandle "PRE-LOCK-OK"
    if ([KeyboardLockSmokeNative]::ReadEditText($editHandle) -notlike "*PRE-LOCK-OK*") {
        Fail "pre-lock" "Typing did not reach Notepad before locking"
    }
    Write-Host "[pre-lock] OK: keyboard input reached Notepad before locking"

    # LOCKED CHECK: keyboard input is blocked once the helper reports locked=true.
    Send-HelperCommand $helperProcess @{ action = "set"; locked = $true }
    $lockedEvent = Read-HelperLine $helperProcess | ConvertFrom-Json
    if ($lockedEvent.type -ne "state" -or $lockedEvent.locked -ne $true) {
        Fail "locked" "Helper did not confirm the locked state"
    }
    Type-IntoNotepad $notepad.MainWindowHandle "LOCKED-LEAK"
    if ([KeyboardLockSmokeNative]::ReadEditText($editHandle) -like "*LOCKED-LEAK*") {
        Fail "locked" "Keyboard input reached Notepad while locked"
    }
    Write-Host "[locked] OK: keyboard input was blocked while locked"

    # MOUSE-UNLOCK CHECK: the mouse still works while locked, and the unlock command a
    # mouse click on the shelf button would send restores keyboard input.
    $rect = New-Object KeyboardLockSmokeNative+RECT
    [KeyboardLockSmokeNative]::GetWindowRect($notepad.MainWindowHandle, [ref]$rect) | Out-Null
    $clickX = [int](($rect.Left + $rect.Right) / 2)
    $clickY = $rect.Top + 15
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($clickX, $clickY)
    Start-Sleep -Milliseconds 150
    [KeyboardLockSmokeNative]::mouse_event([KeyboardLockSmokeNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    [KeyboardLockSmokeNative]::mouse_event([KeyboardLockSmokeNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 200
    if ([KeyboardLockSmokeNative]::GetForegroundWindow() -ne $notepad.MainWindowHandle) {
        Fail "mouse-unlock" "A mouse click did not reach the Notepad window while locked"
    }

    Send-HelperCommand $helperProcess @{ action = "set"; locked = $false }
    $mouseUnlockEvent = Read-HelperLine $helperProcess | ConvertFrom-Json
    if ($mouseUnlockEvent.type -ne "state" -or $mouseUnlockEvent.locked -ne $false) {
        Fail "mouse-unlock" "Helper did not confirm the mouse-triggered unlock"
    }
    Type-IntoNotepad $notepad.MainWindowHandle "MOUSE-UNLOCK-OK"
    if ([KeyboardLockSmokeNative]::ReadEditText($editHandle) -notlike "*MOUSE-UNLOCK-OK*") {
        Fail "mouse-unlock" "Keyboard input did not resume after the mouse unlock"
    }
    Write-Host "[mouse-unlock] OK: the mouse worked while locked and the unlock command restored typing"

    # EMERGENCY-UNLOCK CHECK: Ctrl+Alt+Shift+K unlocks even without touching the mouse.
    Send-HelperCommand $helperProcess @{ action = "set"; locked = $true }
    $relockEvent = Read-HelperLine $helperProcess | ConvertFrom-Json
    if ($relockEvent.type -ne "state" -or $relockEvent.locked -ne $true) {
        Fail "emergency-unlock" "Helper did not re-lock before the emergency chord test"
    }
    if (-not [KeyboardLockSmokeNative]::ForceForeground($notepad.MainWindowHandle)) {
        Fail "emergency-unlock" "Could not bring the scratch Notepad window to the foreground; another window is holding focus"
    }
    Start-Sleep -Milliseconds 200
    $sendResult = [KeyboardLockSmokeNative]::SendEmergencyChord()
    if ($sendResult -ne 1) {
        Fail "emergency-unlock" "Win32 SendInput could not emit the emergency chord (code $sendResult)"
    }
    $emergencyEvent = Read-HelperLine $helperProcess | ConvertFrom-Json
    if ($emergencyEvent.type -ne "state" -or $emergencyEvent.locked -ne $false -or $emergencyEvent.reason -ne "emergency-shortcut") {
        Fail "emergency-unlock" "Ctrl+Alt+Shift+K did not unlock through the helper"
    }
    Write-Host "[emergency-unlock] OK: Ctrl+Alt+Shift+K unlocked the keyboard"

    # POST-UNLOCK CHECK: keyboard input resumes normally after the emergency unlock.
    Type-IntoNotepad $notepad.MainWindowHandle "POST-UNLOCK-OK"
    if ([KeyboardLockSmokeNative]::ReadEditText($editHandle) -notlike "*POST-UNLOCK-OK*") {
        Fail "post-unlock" "Keyboard input did not resume after the emergency unlock"
    }
    Write-Host "[post-unlock] OK: keyboard input resumed after unlocking"

    Send-HelperCommand $helperProcess @{ action = "stop" }
    if (-not $helperProcess.WaitForExit(3000)) {
        Fail "post-unlock" "Helper did not exit after the stop command"
    }
    if ($helperProcess.ExitCode -ne 0) {
        Fail "post-unlock" "Helper exited with a nonzero code after stop"
    }

    Write-Host "Keyboard lock live smoke test passed: pre-lock, locked, mouse-unlock, emergency-unlock, and post-unlock checks all succeeded."
} catch {
    Write-Error $_
    $exitCode = 1
} finally {
    if ($helperProcess -and -not $helperProcess.HasExited) {
        try { $helperProcess.Kill() } catch {}
    }
    if ($notepad -and -not $notepad.HasExited) {
        try { $notepad.Kill() } catch {}
    }
}

exit $exitCode
