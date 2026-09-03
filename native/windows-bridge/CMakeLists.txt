cmake_minimum_required(VERSION 3.20)

project(clipboard-listener LANGUAGES CXX)

if (NOT WIN32)
  message(FATAL_ERROR "clipboard-listener is a Windows-only helper")
endif()

add_executable(clipboard-listener
  main.cpp
  clipboard_listener.cpp
)

target_compile_features(clipboard-listener PRIVATE cxx_std_17)
target_compile_definitions(clipboard-listener PRIVATE
  UNICODE
  _UNICODE
  WIN32_LEAN_AND_MEAN
  NOMINMAX
)
target_link_libraries(clipboard-listener PRIVATE user32)
