#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EXTENSION_DIR="$PROJECT_ROOT/extension"
DIST_DIR="$PROJECT_ROOT/dist"
VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$EXTENSION_DIR/manifest.json" | head -n 1)"

[ -n "$VERSION" ] || { echo "Cannot read extension version." >&2; exit 1; }
command -v hdiutil >/dev/null 2>&1 || { echo "hdiutil is required; run this builder on macOS." >&2; exit 1; }
command -v go >/dev/null 2>&1 || { echo "Go is required to build the Universal macOS launcher." >&2; exit 1; }
command -v lipo >/dev/null 2>&1 || { echo "lipo is required to assemble the Universal macOS launcher." >&2; exit 1; }

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pena-bx24-dmg.XXXXXX")"
PAYLOAD_DIR="$TEMP_ROOT/payload"
INSTALLER_APP="$PAYLOAD_DIR/PENA BX24 Installer.app"
APP_CONTENTS="$INSTALLER_APP/Contents"
BUILD_DIR="$TEMP_ROOT/build"
OUTPUT_DMG="$DIST_DIR/PENA_Agency_macOS_Universal_v${VERSION}.dmg"
trap 'rm -rf "$TEMP_ROOT"' EXIT INT TERM

mkdir -p "$APP_CONTENTS/MacOS" "$APP_CONTENTS/Resources/extension" "$BUILD_DIR" "$DIST_DIR"
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o "$BUILD_DIR/pena-launcher-amd64" "$SCRIPT_DIR/launcher/main.go"
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags='-s -w' -o "$BUILD_DIR/pena-launcher-arm64" "$SCRIPT_DIR/launcher/main.go"
lipo -create \
    "$BUILD_DIR/pena-launcher-amd64" \
    "$BUILD_DIR/pena-launcher-arm64" \
    -output "$BUILD_DIR/pena-launcher-universal"
/usr/bin/ditto "$EXTENSION_DIR" "$APP_CONTENTS/Resources/extension"
/usr/bin/ditto "$SCRIPT_DIR/updater.sh" "$APP_CONTENTS/Resources/pena-updater.sh"
/usr/bin/ditto "$SCRIPT_DIR/launcher-Info.plist" "$APP_CONTENTS/Resources/launcher-Info.plist"
/usr/bin/ditto "$SCRIPT_DIR/install-gui.sh" "$APP_CONTENTS/Resources/install-gui.sh"
/usr/bin/ditto "$BUILD_DIR/pena-launcher-universal" "$APP_CONTENTS/MacOS/PENA BX24 Installer"
/usr/bin/ditto "$BUILD_DIR/pena-launcher-universal" "$APP_CONTENTS/Resources/pena-launcher"
chmod 755 "$APP_CONTENTS/MacOS/PENA BX24 Installer" "$APP_CONTENTS/Resources/install-gui.sh" "$APP_CONTENTS/Resources/pena-launcher" "$APP_CONTENTS/Resources/pena-updater.sh"
cat > "$APP_CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>PENA BX24 Installer</string>
    <key>CFBundleIdentifier</key><string>agency.pena.bx24.installer</string>
    <key>CFBundleName</key><string>PENA BX24 Installer</string>
    <key>CFBundleDisplayName</key><string>PENA BX24 Installer</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>LSMinimumSystemVersion</key><string>10.15</string>
	<key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

rm -f "$OUTPUT_DMG"
hdiutil create \
    -volname "PENA BX24 Installer" \
    -srcfolder "$PAYLOAD_DIR" \
    -format UDZO \
    -fs HFS+ \
    -ov \
    "$OUTPUT_DMG"
hdiutil verify "$OUTPUT_DMG"

echo "OK $OUTPUT_DMG"
