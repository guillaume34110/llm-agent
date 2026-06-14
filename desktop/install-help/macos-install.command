#!/bin/bash
# Double-click this file from the DMG window to install Monkey safely.
# It removes the macOS quarantine flag that triggers the "Monkey is damaged"
# warning, then launches the app for you.
#
# Why: Monkey ships unsigned by an indie developer (no $99/year Apple cert).
# The binary is open source — read it at https://github.com/guillaume34110/llm-agent-
# Quarantine bypass is the same thing the Gatekeeper "Open anyway" button does.

set -e

APP_NAME="Monkey.app"
DMG_APP="/Volumes/Monkey/${APP_NAME}"
APP_PATH="/Applications/${APP_NAME}"

if [ ! -d "$DMG_APP" ]; then
  osascript -e 'display alert "Monkey installer" message "Open this script from the mounted Monkey.dmg window. Drag Monkey.app to Applications first if you have not already." as critical'
  exit 1
fi

osascript -e 'display dialog "Install Monkey to /Applications now?\n\nThis will remove the Apple quarantine flag (so macOS does not block the unsigned app) and launch Monkey." buttons {"Cancel", "Install"} default button "Install"'

cp -R "$DMG_APP" /Applications/
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
open "$APP_PATH"
