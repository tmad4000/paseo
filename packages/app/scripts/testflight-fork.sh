#!/usr/bin/env bash
#
# testflight-fork.sh — build "Paseo Fork" for iPhone and ship it to TestFlight
# locally, without EAS. The fork does not use upstream's getpaseo EAS project or
# App Store Connect app; it builds and uploads under the IdeaFlow Apple team.
#
# Pipeline: build workspace deps -> expo prebuild (generate ios/) -> xcodebuild
# archive -> -exportArchive (App Store) -> (optional) altool upload.
#
# By default this stops after producing a signed .ipa. Uploading is gated behind
# --upload AND a real App Store Connect app id, because the fork's ASC app record
# must be created once by hand first (see "Remaining Apple web step" below).
#
# Identity (from app.config.js, fork/ios-testflight):
#   App name          : Paseo Fork
#   iOS bundle id      : io.ideaflow.paseo-fork
#   Encryption compliance: ITSAppUsesNonExemptEncryption = false (HTTPS-only)
#
# Signing / Apple (this M5 login keychain + ~/.appstoreconnect; see
# ~/.claude/rules/ios-deploy.md):
#   Team              : JESMXK96LG  (IdeaFlow, Inc. — paid, 1-year profiles)
#   Distribution cert : "Apple Distribution: IdeaFlow, Inc. (JESMXK96LG)"
#   ASC API key       : KWJX4896S5  (.p8 under ~/.private_keys / ~/.appstoreconnect/private_keys)
#   ASC issuer id     : ~/.appstoreconnect/issuer_id
#
# Usage:
#   packages/app/scripts/testflight-fork.sh                 # archive + export .ipa only
#   ASC_APP_ID=<id> packages/app/scripts/testflight-fork.sh --upload
#
# Env overrides:
#   DEVELOPMENT_TEAM   default JESMXK96LG
#   APP_VARIANT        default production
#   ASC_KEY_ID         default KWJX4896S5
#   ASC_ISSUER_ID      default $(cat ~/.appstoreconnect/issuer_id)
#   ASC_APP_ID         required for --upload (the fork's App Store Connect app id)
#
# Remaining Apple web step (one-time, cannot be automated on this account —
# POST /v1/apps is FORBIDDEN, so create it in the App Store Connect UI):
#   App Store Connect -> My Apps -> + -> New App -> iOS
#     Name        : Paseo Fork
#     Bundle ID   : io.ideaflow.paseo-fork   (register it first under the
#                   JESMXK96LG team in Certificates, Identifiers & Profiles if it
#                   is not offered in the dropdown)
#     SKU         : paseo-fork-ios
#     Primary language / user access: your choice
#   Then re-run with:  ASC_APP_ID=<numeric id> ... --upload
#
set -euo pipefail

# --- resolve paths -----------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"       # packages/app
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
BUILD_DIR="$APP_DIR/build/testflight-fork"
ARCHIVE_PATH="$BUILD_DIR/PaseoFork.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"

# --- config ------------------------------------------------------------------
DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-JESMXK96LG}"
APP_VARIANT="${APP_VARIANT:-production}"
ASC_KEY_ID="${ASC_KEY_ID:-KWJX4896S5}"
DO_UPLOAD=0
for arg in "$@"; do
  case "$arg" in
    --upload) DO_UPLOAD=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------
[ "$(uname -s)" = "Darwin" ] || fail "iOS builds require macOS."
command -v xcodebuild >/dev/null 2>&1 || fail "xcodebuild not found (install Xcode)."

# The distribution cert must be in the login keychain, or archive signing fails.
if ! security find-identity -p codesigning -v 2>/dev/null | grep -q "$DEVELOPMENT_TEAM"; then
  fail "No codesigning identity for team $DEVELOPMENT_TEAM in the keychain.
       Expected: 'Apple Distribution: IdeaFlow, Inc. ($DEVELOPMENT_TEAM)'."
fi

# Homebrew rsync 3.x shadows Apple's /usr/bin/rsync and breaks CreateIPAStep
# ('Copy failed'); force Apple's rsync onto the front of PATH. See ios-deploy.md.
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# --- build workspace deps ----------------------------------------------------
log "Building workspace client deps"
( cd "$REPO_ROOT" && npm run build:client )

# --- generate the native iOS project -----------------------------------------
log "expo prebuild (APP_VARIANT=$APP_VARIANT)"
( cd "$APP_DIR" && APP_VARIANT="$APP_VARIANT" npx expo prebuild --platform ios --clean --non-interactive )

WORKSPACE="$(ls -d "$APP_DIR"/ios/*.xcworkspace 2>/dev/null | head -1)"
[ -n "$WORKSPACE" ] || fail "No .xcworkspace after prebuild (expected $APP_DIR/ios/*.xcworkspace)."
SCHEME="$(xcodebuild -list -workspace "$WORKSPACE" -json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const w=JSON.parse(s).workspace;console.log((w.schemes||[])[0]||"")})')"
[ -n "$SCHEME" ] || fail "Could not determine an Xcode scheme from $WORKSPACE."
log "Workspace: $WORKSPACE   Scheme: $SCHEME"

# --- archive -----------------------------------------------------------------
rm -rf "$ARCHIVE_PATH" "$EXPORT_DIR"
mkdir -p "$BUILD_DIR"
log "Archiving (team $DEVELOPMENT_TEAM)"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates \
  archive

# --- export a store-signed .ipa ----------------------------------------------
EXPORT_OPTS="$BUILD_DIR/ExportOptions.plist"
cat > "$EXPORT_OPTS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store</string>
  <key>teamID</key><string>$DEVELOPMENT_TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>destination</key><string>export</string>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

log "Exporting .ipa (App Store)"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTS" \
  -allowProvisioningUpdates

IPA="$(ls -1 "$EXPORT_DIR"/*.ipa 2>/dev/null | head -1)"
[ -n "$IPA" ] || fail "Export produced no .ipa in $EXPORT_DIR."
log "Built: $IPA"

# --- optional upload ---------------------------------------------------------
if [ "$DO_UPLOAD" -ne 1 ]; then
  cat <<DONE

Archive + export complete. No upload performed.

To upload to TestFlight, first create the App Store Connect app record (one-time,
see the header of this script), then run:

  ASC_APP_ID=<numeric app id> $0 --upload

DONE
  exit 0
fi

[ -n "${ASC_APP_ID:-}" ] || fail "--upload requires ASC_APP_ID (the fork's App Store Connect app id).
       Create the app record first (see this script's header), then pass ASC_APP_ID."
ASC_ISSUER_ID="${ASC_ISSUER_ID:-$(cat "$HOME/.appstoreconnect/issuer_id" 2>/dev/null || true)}"
[ -n "$ASC_ISSUER_ID" ] || fail "No ASC issuer id (set ASC_ISSUER_ID or ~/.appstoreconnect/issuer_id)."

log "Uploading to TestFlight via altool (app $ASC_APP_ID, key $ASC_KEY_ID)"
xcrun altool --upload-app \
  --type ios \
  --file "$IPA" \
  --apiKey "$ASC_KEY_ID" \
  --apiIssuer "$ASC_ISSUER_ID"

log "Uploaded. Apple processes the build (~5-15 min) before it appears in TestFlight."
