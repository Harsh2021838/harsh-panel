#!/bin/bash
# Frameshift panel installer for macOS. Double-click (first time: right-click > Open).
# Installs for this user only, so no password is needed.
cd "$(dirname "$0")"
SRC="$PWD/com.harsh.panel"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.harsh.panel"

echo ""
echo "  Installing the Frameshift panel for Premiere Pro and After Effects"
echo ""

if pgrep -f "MacOS/Adobe Premiere Pro" >/dev/null || pgrep -f "MacOS/After Effects" >/dev/null; then
  echo "  Premiere Pro or After Effects is open. Please quit them, then press Enter."
  read -r
fi
if [ ! -f "$SRC/CSXS/manifest.xml" ]; then
  echo "  Couldn't find the panel next to this installer."
  echo "  Unzip the whole download first, then run this again."
  read -r -p "  Press Enter to close." _
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -R "$SRC" "$DEST"
# Files from the internet are quarantined by macOS; unblock the panel.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null

# Allow unsigned panels in every Premiere version from 2022 on (CEP 9-12).
for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done
killall cfprefsd 2>/dev/null

echo "  Done. Open Premiere Pro or After Effects, then Window > Extensions > Frameshift."
echo "  To update later, run the new installer the same way."
echo ""
read -r -p "  Press Enter to close." _
