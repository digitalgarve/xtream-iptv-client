#!/usr/bin/env bash
# Signs the Tizen widget from the production build in dist/ (`npm run build:tizen`).
#
#   CERT_PASSWORD=... [VARIANT=_youtube|_autoupdate|_youtube_autoupdate] bash platforms/tizen/package.sh <version> [out-dir]
#
# Installs the Tizen Studio CLI, registers the Samsung author/distributor certificates from base64 Actions secrets
# (CERT_AUTHOR_BASE64, CERT_DISTRIBUTOR_BASE64; their shared password is CERT_PASSWORD) and writes <out-dir>/xtream-iptv-<version>_tizen.wgt with its .sha256 (out-dir: release).
# Run by the "tizen" job of .github/workflows/release.yml; it works on any Linux machine with curl.
set -euo pipefail

VERSION="${1:?version (x.y.z) required}"
ROOT="${GITHUB_WORKSPACE:-$(cd "$(dirname "$0")/../.." && pwd)}"
OUT="${2:-release}"
case "$OUT" in /*) ;; *) OUT="${ROOT}/${OUT}" ;; esac # relative to the repository
TMP="${RUNNER_TEMP:-$(mktemp -d)}"
TIZEN_STUDIO_VER="${TIZEN_STUDIO_VER:-4.5.1}"
TIZEN_PROFILE="${TIZEN_PROFILE:-xtream}"
STUDIO="${ROOT}/tizen-studio"
DATA="${STUDIO}-data"
TIZEN="${STUDIO}/tools/ide/bin/tizen"
PROFILES="${DATA}/profile/profiles.xml"
SIGN_DIR="${TMP}/tizen-sign" # the certificate is copied here: the CLI writes its password file next to it, outside the repository
CERT="${SIGN_DIR}/author.p12"
DISTRIBUTOR_CERT="${SIGN_DIR}/distributor.p12"

if [ -z "${CERT_PASSWORD:-}" ]; then
  echo "::error::Secret TIZEN_CERT_PASSWORD is not set."
  exit 1
fi
if [ -z "${CERT_AUTHOR_BASE64:-}" ] || [ -z "${CERT_DISTRIBUTOR_BASE64:-}" ]; then
  echo "::error::Set TIZEN_AUTHOR_CERT_BASE64 and TIZEN_DISTRIBUTOR_CERT_BASE64 to the matching Samsung certificates."
  exit 1
fi
if [ ! -f "${ROOT}/dist/config.xml" ]; then
  echo "::error::dist/config.xml not found: run npm run build:tizen first."
  exit 1
fi

umask 077
mkdir -p "$SIGN_DIR"
printf '%s' "$CERT_AUTHOR_BASE64" | base64 --decode > "$CERT"
printf '%s' "$CERT_DISTRIBUTOR_BASE64" | base64 --decode > "$DISTRIBUTOR_CERT"
export CERT_PASSWORD
for certificate in "$CERT" "$DISTRIBUTOR_CERT"; do
  # OpenSSL 3+ needs the legacy provider to read older RC2-encrypted PKCS#12 files.
  if ! openssl pkcs12 -in "$certificate" -passin env:CERT_PASSWORD -noout 2>/dev/null &&
     ! openssl pkcs12 -legacy -in "$certificate" -passin env:CERT_PASSWORD -noout; then
    echo "::error::Samsung certificate cannot be opened with TIZEN_CERT_PASSWORD: $(basename "$certificate")"
    exit 1
  fi
done

trap 'echo "--- Tizen CLI log ---"; cat "${DATA}/cli/logs/cli.log" 2>/dev/null || true' ERR

# Tizen Studio CLI
if [ ! -x "$TIZEN" ]; then
  if ! command -v expect >/dev/null; then sudo apt-get install -y expect; fi
  curl -fsSL -o "${TMP}/tizen-installer" \
    "https://download.tizen.org/sdk/Installer/tizen-studio_${TIZEN_STUDIO_VER}/web-cli_Tizen_Studio_${TIZEN_STUDIO_VER}_ubuntu-64.bin"
  chmod +x "${TMP}/tizen-installer"
  "${TMP}/tizen-installer" --accept-license "$STUDIO"
  rm "${TMP}/tizen-installer"
fi

# Refresh on every invocation: cached profiles may reference old certificates or temporary paths.
# Removal may fail on the first run because the profile does not exist yet; adding must succeed.
"$TIZEN" security-profiles remove -n "$TIZEN_PROFILE" >/dev/null 2>&1 || true
"$TIZEN" security-profiles add -n "$TIZEN_PROFILE" -a "$CERT" -p "$CERT_PASSWORD" -d "$DISTRIBUTOR_CERT" -dp "$CERT_PASSWORD"
"$TIZEN" cli-config "profiles.path=${PROFILES}"
chmod 600 "$PROFILES"

# Replace the password-file references with the actual passwords so signing is non-interactive.
esc() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }
CERT_PWD_ESC="$(esc "$CERT_PASSWORD")"
sed -i "s|${CERT%.p12}.pwd|${CERT_PWD_ESC}|g" "$PROFILES"
sed -i "s|${DISTRIBUTOR_CERT%.p12}.pwd|${CERT_PWD_ESC}|g" "$PROFILES"
sed -i "s|password=\"\"|password=\"${CERT_PWD_ESC}\"|g" "$PROFILES"

# Safety net: answers any password prompt that `tizen package` still raises.
cat > "${TMP}/package.exp" <<'EXP'
set timeout 300
spawn {*}$argv
expect {
  -nocase -re {password[^\n]*:} { send "$env(CERT_PASSWORD)\r"; exp_continue }
  timeout { puts "timeout waiting for tizen package"; exit 1 }
  eof
}
catch wait result
exit [lindex $result 3]
EXP

# Sign the production widget
mkdir -p "$OUT"
NAME="xtream-iptv-${VERSION}_tizen${VARIANT:-}" # the platform (and the variant: _youtube, _autoupdate) after the version
WGT_DIR="${TMP}/wgt-${NAME}"
mkdir -p "$WGT_DIR"
export CERT_PASSWORD
expect "${TMP}/package.exp" "$TIZEN" package -t wgt -s "$TIZEN_PROFILE" -o "$WGT_DIR" -- "${ROOT}/dist"
WGT="$(find "$WGT_DIR" "${ROOT}/dist" -maxdepth 1 -name '*.wgt' | head -n1)"
if [ -z "$WGT" ]; then
  echo "::error::No .wgt produced"
  exit 1
fi
# A widget without its signatures installs nowhere (TV: "Check certificate error"; Seller Office: "Unable to read author signature").
for sig in author-signature.xml signature1.xml; do
  if ! unzip -l "$WGT" | grep -q " ${sig}$"; then
    echo "::error::${NAME}.wgt is not signed (${sig} missing)"
    exit 1
  fi
done
mv "$WGT" "${OUT}/${NAME}.wgt"
(cd "$OUT" && sha256sum "${NAME}.wgt" > "${NAME}.wgt.sha256")
echo "Signed ${OUT}/${NAME}.wgt"
