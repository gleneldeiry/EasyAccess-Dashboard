#!/bin/zsh
# Builds EasyAccess.app in the project folder. Re-run after changing desktop/*.swift.
# (Changes to the dashboard itself — server.js, public/ — don't need a rebuild.)
set -e
cd "$(dirname "$0")/.."
PROJECT="$(pwd)"
DEST="$PROJECT/EasyAccess.app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# build + sign outside Documents (iCloud keeps tagging files there, which codesign rejects)
APP="$TMP/EasyAccess.app"

echo "Building EasyAccess.app…"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# app binary, with this project's folder baked in
sed "s|__PROJECT_DIR__|$PROJECT|" desktop/EasyAccess.swift > "$TMP/main.swift"
swiftc -O -o "$APP/Contents/MacOS/EasyAccess" "$TMP/main.swift"

# icon
swift desktop/make-icon.swift "$TMP/icon.png"
mkdir "$TMP/AppIcon.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon.png" --out "$TMP/AppIcon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$TMP/icon.png" --out "$TMP/AppIcon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>EasyAccess</string>
  <key>CFBundleDisplayName</key><string>EasyAccess</string>
  <key>CFBundleIdentifier</key><string>local.easyaccess.dashboard</string>
  <key>CFBundleExecutable</key><string>EasyAccess</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST

# local (ad-hoc) signature so macOS treats it as one consistent app, e.g. for notification permission
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"
codesign --verify "$APP"
rm -rf "$DEST"
ditto --norsrc --noextattr "$APP" "$DEST"
echo "Done: $DEST"
