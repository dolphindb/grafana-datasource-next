#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
ARTIFACTS_DIR="${ROOT_DIR}/artifacts"
PLUGIN_DIR_NAME="dolphindb-datasource-next"
EXECUTABLE_BASE="gpx_dolphindb_datasource"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${PLUGIN_DIR_NAME}.XXXXXX")"

cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' was not found." >&2
    exit 1
  fi
}

require_command node
require_command npm
require_command mage
require_command zip
require_command unzip
require_command awk

cd "${ROOT_DIR}"

echo "Building frontend for v${VERSION}..."
npm run build

echo "Building Linux AMD64 backend..."
mage -v build:linux

echo "Building Windows AMD64 backend..."
mage -v build:windows

echo "Building Linux ARM64 backend..."
mage -v build:linuxARM64

echo "Updating backend build manifest..."
mage -v build:generateManifestFile

declare -a TARGETS=(
  "linux-amd64:${EXECUTABLE_BASE}_linux_amd64"
  "windows-amd64:${EXECUTABLE_BASE}_windows_amd64.exe"
  "linux-arm64:${EXECUTABLE_BASE}_linux_arm64"
)

mkdir -p "${ARTIFACTS_DIR}"

for target in "${TARGETS[@]}"; do
  platform="${target%%:*}"
  executable="${target#*:}"
  source_executable="${DIST_DIR}/${executable}"
  stage_dir="${WORK_DIR}/${platform}"
  package_dir="${stage_dir}/${PLUGIN_DIR_NAME}"
  archive="${ARTIFACTS_DIR}/${PLUGIN_DIR_NAME}.v${VERSION}.${platform}.zip"

  if [[ ! -f "${source_executable}" ]]; then
    echo "Error: expected backend executable '${source_executable}' was not generated." >&2
    exit 1
  fi

  mkdir -p "${package_dir}"
  cp -a "${DIST_DIR}/." "${package_dir}/"

  # Mage/webpack may leave executables for other platforms in dist. Remove all
  # of them from the staged package, then restore only this platform's binary.
  find "${package_dir}" -maxdepth 1 -type f -name "${EXECUTABLE_BASE}_*" -delete
  cp -p "${source_executable}" "${package_dir}/${executable}"

  # Store explicit Unix modes in the ZIP, independent of source file permissions.
  find "${package_dir}" -type d -exec chmod 755 {} +
  find "${package_dir}" -type f -exec chmod 644 {} +
  chmod 755 "${package_dir}/${executable}"

  rm -f "${archive}"
  (
    cd "${stage_dir}"
    zip -qr "${archive}" "${PLUGIN_DIR_NAME}"
  )

  mapfile -t packaged_executables < <(
    unzip -Z1 "${archive}" |
      awk -F/ -v directory="${PLUGIN_DIR_NAME}" -v prefix="${EXECUTABLE_BASE}_" \
        'NF == 2 && $1 == directory && index($2, prefix) == 1 { print $2 }'
  )

  if [[ "${#packaged_executables[@]}" -ne 1 || "${packaged_executables[0]}" != "${executable}" ]]; then
    echo "Error: '${archive}' does not contain exactly '${executable}'." >&2
    exit 1
  fi

  echo "Created ${archive#${ROOT_DIR}/}"
done

echo "Release packages are ready in ${ARTIFACTS_DIR#${ROOT_DIR}/}/."
