cmake_minimum_required(VERSION 3.16)
project(innochat LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE "Release" CACHE STRING "Build type: Debug, Release, RelWithDebInfo, MinSizeRel" FORCE)
endif()

find_package(Threads REQUIRED)

# ============================================
# Options
# ============================================
option(PROXY_WITH_UI "Embed Web UI into the binary" ON)
option(PROXY_WITH_HTTPS "Enable HTTPS proxy (downloads BoringSSL)" OFF)

# ============================================
# cpp-httplib
# ============================================
add_library(cpp-httplib STATIC
    vendor/cpp-httplib/httplib.cpp
    vendor/cpp-httplib/httplib.h
)
target_include_directories(cpp-httplib PUBLIC vendor/cpp-httplib)
target_link_libraries(cpp-httplib PRIVATE Threads::Threads)
if(WIN32)
    target_link_libraries(cpp-httplib PRIVATE ws2_32)
endif()
if(MSVC)
    target_compile_options(cpp-httplib PRIVATE /w)
else()
    target_compile_options(cpp-httplib PRIVATE -w)
endif()

# ============================================
# BoringSSL (HTTPS support)
# ============================================
if(PROXY_WITH_HTTPS)
    set(LOCAL_BORINGSSL "${CMAKE_CURRENT_SOURCE_DIR}/vendor/boringssl")
    if(EXISTS "${LOCAL_BORINGSSL}/CMakeLists.txt")
        message(STATUS "Using local BoringSSL at vendor/boringssl")
        set(BSSL_DIR "${LOCAL_BORINGSSL}")
    elseif(DEFINED BORINGSSL_SOURCE_DIR AND EXISTS "${BORINGSSL_SOURCE_DIR}/CMakeLists.txt")
        message(STATUS "Using BoringSSL from BORINGSSL_SOURCE_DIR")
        set(BSSL_DIR "${BORINGSSL_SOURCE_DIR}")
    else()
        message(STATUS "Fetching BoringSSL from internet (requires git)")
        include(FetchContent)
        set(BORINGSSL_VERSION "0.20260508.0")
        FetchContent_Declare(boringssl
            GIT_REPOSITORY https://boringssl.googlesource.com/boringssl
            GIT_TAG ${BORINGSSL_VERSION}
        )
        FetchContent_GetProperties(boringssl)
        if(NOT boringssl_POPULATED)
            FetchContent_Populate(boringssl)
        endif()
        set(BSSL_DIR ${boringssl_SOURCE_DIR})
    endif()

    set(SAVED_BUILD_SHARED_LIBS ${BUILD_SHARED_LIBS})
    set(BUILD_SHARED_LIBS OFF)
    set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
    set(OPENSSL_NO_ASM ON CACHE BOOL "" FORCE)
    add_subdirectory(${BSSL_DIR} ${CMAKE_CURRENT_BINARY_DIR}/boringssl EXCLUDE_FROM_ALL)
    set(BUILD_SHARED_LIBS ${SAVED_BUILD_SHARED_LIBS})

    target_compile_definitions(cpp-httplib PUBLIC CPPHTTPLIB_OPENSSL_SUPPORT)
    target_link_libraries(cpp-httplib PUBLIC ssl crypto)
endif()

# ============================================
# UI assets (pre-built or from source)
# ============================================
set(ASSETS_HEADER "${CMAKE_CURRENT_BINARY_DIR}/assets.h")
set(UI_PREBUILT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/ui-assets")
set(UI_SOURCE_DIR  "${CMAKE_CURRENT_SOURCE_DIR}/ui")

function(generate_assets_header asset_dir)
    set(sources "")
    file(GLOB asset_files "${asset_dir}/*")
    foreach(f ${asset_files})
        get_filename_component(name "${f}" NAME)
        if(name MATCHES "^(index\\.html|bundle\\.js|bundle\\.css|loading\\.html)$")
            file(READ "${f}" data_raw HEX)
            string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," hex "${data_raw}")
            string(LENGTH "${data_raw}" len_hex)
            math(EXPR len_bytes "${len_hex} / 2")
            string(REGEX REPLACE "[.-]" "_" cname "${name}")
            set(sources "${sources}static const unsigned char asset_${cname}[] = { ${hex} };\n")
            set(sources "${sources}static const size_t asset_${cname}_size = ${len_bytes};\n\n")
        endif()
    endforeach()
    file(WRITE "${ASSETS_HEADER}"
        "// auto-generated UI assets\n#pragma once\n#include <cstddef>\n\n${sources}")
endfunction()

if(PROXY_WITH_UI)
    find_program(NPM_EXECUTABLE NAMES npm.cmd npm)
    if(WIN32 AND NPM_EXECUTABLE)
        # On Windows CMake's execute_process uses cmd.exe which cannot
        # run bash scripts. Force npm.cmd invocation via cmd /c.
        get_filename_component(NPM_DIR "${NPM_EXECUTABLE}" DIRECTORY)
        if(EXISTS "${NPM_DIR}/npm.cmd")
            set(NPM_EXECUTABLE "${NPM_DIR}/npm.cmd")
        endif()
    endif()
    set(UI_BUILT_DIR "${UI_PREBUILT_DIR}")

    if(NPM_EXECUTABLE AND EXISTS "${UI_SOURCE_DIR}/package.json")
        message(STATUS "Building UI from source (npm: ${NPM_EXECUTABLE})...")

        # Ensure node is on PATH so npm's child processes can find it
        find_program(NODE_EXECUTABLE NAMES node.exe node)
        if(NODE_EXECUTABLE)
            get_filename_component(NODE_DIR "${NODE_EXECUTABLE}" DIRECTORY)
            if(WIN32)
                set(ENV{PATH} "${NODE_DIR};$ENV{PATH}")
            else()
                set(ENV{PATH} "${NODE_DIR}:$ENV{PATH}")
            endif()
        endif()

        execute_process(
            COMMAND ${NPM_EXECUTABLE} install
            WORKING_DIRECTORY "${UI_SOURCE_DIR}"
            RESULT_VARIABLE NPM_INSTALL_RESULT
        )
        if(NPM_INSTALL_RESULT EQUAL 0)
            execute_process(
                COMMAND ${NPM_EXECUTABLE} run build
                WORKING_DIRECTORY "${UI_SOURCE_DIR}"
                RESULT_VARIABLE NPM_BUILD_RESULT
            )
            if(NPM_BUILD_RESULT EQUAL 0)
                file(COPY "${UI_SOURCE_DIR}/dist/" DESTINATION "${UI_PREBUILT_DIR}")
                message(STATUS "UI built from source successfully")
            else()
                message(WARNING "npm build failed, using pre-built UI")
            endif()
        else()
            message(WARNING "npm install failed, using pre-built UI")
        endif()
    else()
        message(STATUS "Using pre-built UI assets")
    endif()

    if(NOT EXISTS "${UI_PREBUILT_DIR}/index.html")
        message(FATAL_ERROR "UI enabled but no assets found at ${UI_PREBUILT_DIR}")
    endif()

    generate_assets_header("${UI_PREBUILT_DIR}")
    message(STATUS "UI assets embedded")
else()
    file(WRITE "${ASSETS_HEADER}" "// UI disabled\n#pragma once\n#include <cstddef>\n")
    target_compile_definitions(innochat PRIVATE PROXY_NO_UI)
    message(STATUS "UI disabled")
endif()

# ============================================
# proxy server
# ============================================
add_executable(innochat
    main.cpp
    "${ASSETS_HEADER}"
)

target_include_directories(innochat PRIVATE ${CMAKE_CURRENT_BINARY_DIR} ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(innochat PRIVATE cpp-httplib Threads::Threads)
if(CMAKE_BUILD_TYPE STREQUAL "Release" AND NOT MSVC)
    target_link_options(innochat PRIVATE -s)  # strip at link time
endif()
if(WIN32)
    target_link_libraries(innochat PRIVATE ws2_32 crypt32)
endif()

if(MINGW)
    target_link_options(innochat PRIVATE -static-libgcc -static-libstdc++)
endif()

if(PROXY_WITH_HTTPS)
    target_compile_definitions(innochat PRIVATE CPPHTTPLIB_OPENSSL_SUPPORT)
endif()

# strip debug symbols in Release builds
if(CMAKE_BUILD_TYPE STREQUAL "Release" AND NOT MSVC AND CMAKE_STRIP)
    add_custom_command(TARGET innochat POST_BUILD
        COMMAND ${CMAKE_STRIP} "$<TARGET_FILE:innochat>"
        COMMENT "Stripping debug symbols"
    )
endif()
