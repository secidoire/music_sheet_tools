#!/usr/bin/env bash
# Builds the OpenCV.js used by the app into vendor/opencv/ (committed, so a normal build
# needs no toolchain). Compared with the stock opencv.js it has
#   - only core + imgproc and the functions in scripts/opencv.config.py (smaller download),
#   - WebAssembly SIMD (faster filters, resizes and warps),
#   - the .wasm as a separate file (streamed compilation, cached by the browser).
# Toolchain and sources are downloaded into .cache/opencv-build/ (~2GB).
# Usage: scripts/build-opencv.sh
set -euo pipefail

OPENCV_VERSION=5.0.0
EMSDK_VERSION=6.0.10
CMAKE_VERSION=3.31.6
root=$(cd "$(dirname "$0")/.." && pwd)
work=$root/.cache/opencv-build
mkdir -p "$work"
cd "$work"

if ! command -v cmake >/dev/null; then
  if [ ! -d "cmake-$CMAKE_VERSION-linux-x86_64" ]; then
    curl -sL "https://github.com/Kitware/CMake/releases/download/v$CMAKE_VERSION/cmake-$CMAKE_VERSION-linux-x86_64.tar.gz" | tar xz
  fi
  export PATH="$work/cmake-$CMAKE_VERSION-linux-x86_64/bin:$PATH"
fi

if [ ! -d emsdk ]; then git clone --depth 1 https://github.com/emscripten-core/emsdk.git; fi
./emsdk/emsdk install "$EMSDK_VERSION"
./emsdk/emsdk activate "$EMSDK_VERSION"
# shellcheck disable=SC1091
source ./emsdk/emsdk_env.sh

src=$work/opencv-$OPENCV_VERSION
if [ ! -d "$src" ]; then
  curl -sL "https://github.com/opencv/opencv/archive/refs/tags/$OPENCV_VERSION.tar.gz" | tar xz
fi

# The bindings template assumes the segmentation API is exported; it isn't in our whitelist.
sed -i 's|^using namespace cv::segmentation;  // FIXIT|// (segmentation not exported)|' "$src/modules/js/src/core_bindings.cpp"

modules=()
for m in 3d calib dnn features objdetect photo ptcloud stereo video; do
  modules+=(--cmake_option="-DBUILD_opencv_$m=OFF")
done
# In OpenCV 5 imgproc needs geometry, which needs flann (neither is exported to JS).
for m in geometry flann; do
  modules+=(--cmake_option="-DBUILD_opencv_$m=ON")
done

emcmake python3 "$src/platforms/js/build_js.py" "$work/build" \
  --build_wasm --simd --disable_single_file \
  --config "$root/scripts/opencv.config.py" \
  "${modules[@]}" \
  --cmake_option=-DBUILD_TESTS=OFF --cmake_option=-DBUILD_PERF_TESTS=OFF --cmake_option=-DBUILD_EXAMPLES=OFF

mkdir -p "$root/vendor/opencv"
cp "$work/build/bin/opencv_js.wasm" "$root/vendor/opencv/"
# The UMD wrapper assumes a classic script. As an ES module (the worker imports it) top-level
# `this` is undefined and a bare `Module = {}` throws, so use globalThis and take the
# Emscripten settings (the worker's locateFile for the .wasm) from globalThis.Module.
sed -e 's|^}(this, function () {|}(globalThis, function () {|' \
    -e 's|^    Module = {};|    var Module = {};|' \
    -e 's|^  if (typeof Module === .undefined.)$|  if (typeof globalThis.Module === "object") var Module = globalThis.Module; else|' \
    "$work/build/bin/opencv.js" > "$root/vendor/opencv/opencv.js"
grep -q '^}(globalThis, function () {' "$root/vendor/opencv/opencv.js"
grep -q 'var Module = globalThis.Module' "$root/vendor/opencv/opencv.js"
ls -l "$root/vendor/opencv/"
