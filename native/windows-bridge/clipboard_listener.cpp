#include <windows.h>

#include <chrono>
#include <ctime>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <sstream>
#include <string>
#include <vector>

namespace {

struct SourceInfo {
  DWORD pid = 0;
  std::string executable;
};

struct ListenerState {
  HWND window = nullptr;
  UINT htmlFormat = 0;
  UINT rtfFormat = 0;
  unsigned long long sequence = 0;
};

std::string toUtf8(const std::wstring& value) {
  if (value.empty()) {
    return {};
  }

  const int required = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (required <= 0) {
    return {};
  }

  std::string result(static_cast<size_t>(required), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), required, nullptr, nullptr);
  return result;
}

std::string jsonEscape(const std::string& value) {
  std::ostringstream escaped;
  for (const unsigned char character : value) {
    switch (character) {
      case '"': escaped << "\\\""; break;
      case '\\': escaped << "\\\\"; break;
      case '\b': escaped << "\\b"; break;
      case '\f': escaped << "\\f"; break;
      case '\n': escaped << "\\n"; break;
      case '\r': escaped << "\\r"; break;
      case '\t': escaped << "\\t"; break;
      default:
        if (character < 0x20) {
          escaped << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(character);
        } else {
          escaped << character;
        }
    }
  }
  return escaped.str();
}

std::string capturedAt() {
  const auto now = std::chrono::system_clock::now();
  const std::time_t time = std::chrono::system_clock::to_time_t(now);
  std::tm utc{};
  gmtime_s(&utc, &time);

  std::ostringstream output;
  output << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
  return output.str();
}

SourceInfo sourceProcess(HWND owner) {
  SourceInfo source;
  if (!owner) {
    return source;
  }

  GetWindowThreadProcessId(owner, &source.pid);
  if (source.pid == 0) {
    return source;
  }

  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, source.pid);
  if (!process) {
    return source;
  }

  wchar_t executablePath[32768]{};
  DWORD pathLength = static_cast<DWORD>(std::size(executablePath));
  if (QueryFullProcessImageNameW(process, 0, executablePath, &pathLength)) {
    std::wstring path(executablePath, pathLength);
    const size_t separator = path.find_last_of(L"\\/");
    source.executable = toUtf8(separator == std::wstring::npos ? path : path.substr(separator + 1));
  }

  CloseHandle(process);
  return source;
}

std::vector<std::string> availableFormats(const ListenerState& state) {
  std::vector<std::string> formats;
  if (IsClipboardFormatAvailable(CF_UNICODETEXT)) {
    formats.emplace_back("text");
  }
  if (IsClipboardFormatAvailable(CF_DIB) || IsClipboardFormatAvailable(CF_DIBV5)) {
    formats.emplace_back("image");
  }
  if (state.htmlFormat != 0 && IsClipboardFormatAvailable(state.htmlFormat)) {
    formats.emplace_back("html");
  }
  if (state.rtfFormat != 0 && IsClipboardFormatAvailable(state.rtfFormat)) {
    formats.emplace_back("rtf");
  }
  if (IsClipboardFormatAvailable(CF_HDROP)) {
    formats.emplace_back("file");
  }
  return formats;
}

void emitClipboardEvent(ListenerState& state) {
  const SourceInfo source = sourceProcess(GetClipboardOwner());
  const std::vector<std::string> formats = availableFormats(state);

  std::cout << "{\"sequence\":" << ++state.sequence
            << ",\"capturedAt\":\"" << jsonEscape(capturedAt()) << "\",\"sourceApp\":";
  if (source.pid == 0 && source.executable.empty()) {
    std::cout << "null";
  } else {
    std::cout << "{\"executable\":\"" << jsonEscape(source.executable.empty() ? "unknown" : source.executable)
              << "\",\"pid\":" << source.pid << "}";
  }

  std::cout << ",\"formats\":[";
  for (size_t index = 0; index < formats.size(); ++index) {
    if (index != 0) {
      std::cout << ',';
    }
    std::cout << "\"" << jsonEscape(formats[index]) << "\"";
  }
  std::cout << "]}\n" << std::flush;
}

LRESULT CALLBACK clipboardWindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
  auto* state = reinterpret_cast<ListenerState*>(GetWindowLongPtrW(window, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    const auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
    state = static_cast<ListenerState*>(create->lpCreateParams);
    SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(state));
  }

  if (message == WM_CLIPBOARDUPDATE && state) {
    emitClipboardEvent(*state);
    return 0;
  }

  if (message == WM_DESTROY) {
    if (state) {
      RemoveClipboardFormatListener(window);
    }
    PostQuitMessage(0);
    return 0;
  }

  return DefWindowProcW(window, message, wParam, lParam);
}

} // namespace

int runClipboardListener() {
  const HINSTANCE instance = GetModuleHandleW(nullptr);
  const wchar_t className[] = L"ClipboardShelfMessageOnlyListener";

  WNDCLASSEXW windowClass{};
  windowClass.cbSize = sizeof(windowClass);
  windowClass.hInstance = instance;
  windowClass.lpfnWndProc = clipboardWindowProc;
  windowClass.lpszClassName = className;
  if (RegisterClassExW(&windowClass) == 0) {
    return 10;
  }

  ListenerState state;
  state.htmlFormat = RegisterClipboardFormatW(L"HTML Format");
  state.rtfFormat = RegisterClipboardFormatW(L"Rich Text Format");
  state.window = CreateWindowExW(
    0,
    className,
    L"Clipboard Shelf listener",
    0,
    0,
    0,
    0,
    0,
    HWND_MESSAGE,
    nullptr,
    instance,
    &state
  );
  if (!state.window) {
    UnregisterClassW(className, instance);
    return 11;
  }

  if (!AddClipboardFormatListener(state.window)) {
    DestroyWindow(state.window);
    UnregisterClassW(className, instance);
    return 12;
  }

  MSG message{};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }

  if (state.window) {
    DestroyWindow(state.window);
  }
  UnregisterClassW(className, instance);
  return 0;
}
