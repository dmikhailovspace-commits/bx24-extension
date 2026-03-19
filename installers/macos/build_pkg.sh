#!/bin/bash
# ==============================================================
# PENA Agency — Сборка macOS .pkg установщика
# Версия: 5.0.0
#
# Требования:
#   - macOS с Xcode Command Line Tools (xcode-select --install)
#   - pkgbuild, productbuild (входят в CLT)
#
# Запуск:
#   chmod +x installers/build_pkg_macos.sh
#   ./installers/build_pkg_macos.sh
#
# Результат: dist/PENA_Agency_v5.0.0.pkg
# ==============================================================

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}OK   $*${NC}"; }
warn() { echo -e "  ${YELLOW}>>   $*${NC}"; }
fail() { echo -e "  ${RED}!!   $*${NC}"; exit 1; }
info() { echo -e "  ${CYAN}->   $*${NC}"; }
div()  { echo -e "${CYAN}$(printf '=%.0s' {1..54})${NC}"; }

APP_VERSION="5.0.0"
APP_NAME="Сортировщик чатов BX24"
BUNDLE_ID="ru.pena-agency.bx24-extension"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_SOURCE="$(cd "$SCRIPT_DIR/../../extension" && pwd)"
DIST_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)/dist"

div
echo -e "${CYAN}  $APP_NAME — Сборка macOS .pkg установщика${NC}"
div
echo ""

# ── Проверяем инструменты ──────────────────────────────────────
command -v pkgbuild      &>/dev/null || fail "pkgbuild не найден. Установите Xcode CLT: xcode-select --install"
command -v productbuild  &>/dev/null || fail "productbuild не найден. Установите Xcode CLT: xcode-select --install"
[ -f "$EXT_SOURCE/manifest.json" ]   || fail "manifest.json не найден в: $EXT_SOURCE"

mkdir -p "$DIST_DIR"
ok "Инструменты найдены."
echo ""

# ── Временные рабочие директории ──────────────────────────────
TMP_ROOT=$(mktemp -d /tmp/pena_pkg_XXXXXX)
PKG_ROOT="$TMP_ROOT/pkg_root"      # файлы расширения
PKG_SCRIPTS="$TMP_ROOT/scripts"    # pre/post-install скрипты

mkdir -p "$PKG_ROOT/Library/Application Support/PENA Agency/Extension"
mkdir -p "$PKG_SCRIPTS"

INSTALL_BASE="$PKG_ROOT/Library/Application Support/PENA Agency/Extension"

cleanup() { rm -rf "$TMP_ROOT" 2>/dev/null; }
trap cleanup EXIT

# ── Копируем файлы расширения ─────────────────────────────────
info "Копирую файлы расширения..."
rsync -a \
    --exclude='installers/' \
    --exclude='.claude/' \
    --exclude='.git/' \
    --exclude='*.sh' \
    --exclude='*.ps1' \
    --exclude='*.bat' \
    --exclude='*.iss' \
    --exclude='README.md' \
    "$EXT_SOURCE/" "$INSTALL_BASE/"

[ -f "$INSTALL_BASE/manifest.json" ] || fail "Файлы не скопировались."
ok "Файлы расширения скопированы."

# Также включаем скрипт обновления
cp "$SCRIPT_DIR/updater.sh" "$INSTALL_BASE/updater.sh" 2>/dev/null || true
chmod +x "$INSTALL_BASE/updater.sh" 2>/dev/null || true

# ── Postinstall скрипт (выполняется после установки .pkg) ─────
info "Создаю postinstall скрипт..."
cat > "$PKG_SCRIPTS/postinstall" << 'POSTINSTALL_EOF'
#!/bin/bash
# Этот скрипт запускается macOS Installer после копирования файлов.
# $3 = целевой том (обычно /)

INSTALL_DIR="/Library/Application Support/PENA Agency/Extension"
UPDATER="$INSTALL_DIR/pena_updater.sh"

# Делаем скрипт обновления исполняемым
[ -f "$UPDATER" ] && chmod +x "$UPDATER"

# Для каждого пользователя-человека на машине — регистрируем LaunchAgent
for USER_HOME in /Users/*/; do
    USER=$(basename "$USER_HOME")
    [ "$USER" = "Shared" ] && continue
    [ "$USER" = "Guest" ] && continue

    USER_ID=$(id -u "$USER" 2>/dev/null) || continue
    AGENTS_DIR="$USER_HOME/Library/LaunchAgents"

    mkdir -p "$AGENTS_DIR" 2>/dev/null || continue
    chown "$USER" "$AGENTS_DIR" 2>/dev/null || true

    PLIST="$AGENTS_DIR/ru.pena-agency.updater.plist"
    USER_LOG="$USER_HOME/Library/Logs/pena_agency_updater.log"

    cat > "$PLIST" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ru.pena-agency.updater</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$INSTALL_DIR/pena_updater.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>   <integer>10</integer>
        <key>Minute</key> <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>$USER_LOG</string>
    <key>StandardErrorPath</key>
    <string>$USER_LOG</string>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
PLIST_EOF
    chown "$USER" "$PLIST" 2>/dev/null || true

    # Загружаем от имени пользователя
    launchctl bootstrap "gui/$USER_ID" "$PLIST" 2>/dev/null || \
        sudo -u "$USER" launchctl load "$PLIST" 2>/dev/null || true
done

echo "PENA Agency postinstall завершён."
exit 0
POSTINSTALL_EOF
chmod +x "$PKG_SCRIPTS/postinstall"
ok "Postinstall скрипт создан."

# ── Preinstall скрипт ─────────────────────────────────────────
cat > "$PKG_SCRIPTS/preinstall" << 'PREINSTALL_EOF'
#!/bin/bash
# Останавливаем LaunchAgent перед обновлением
launchctl unload "/Library/LaunchAgents/ru.pena-agency.updater.plist" 2>/dev/null || true
for USER_HOME in /Users/*/; do
    USER=$(basename "$USER_HOME")
    PLIST="$USER_HOME/Library/LaunchAgents/ru.pena-agency.updater.plist"
    USER_ID=$(id -u "$USER" 2>/dev/null) || continue
    launchctl bootout "gui/$USER_ID" "$PLIST" 2>/dev/null || \
        sudo -u "$USER" launchctl unload "$PLIST" 2>/dev/null || true
done
exit 0
PREINSTALL_EOF
chmod +x "$PKG_SCRIPTS/preinstall"

# ── Собираем component package ────────────────────────────────
info "Собираю component package (pkgbuild)..."
COMPONENT_PKG="$TMP_ROOT/component.pkg"

pkgbuild \
    --root "$PKG_ROOT" \
    --scripts "$PKG_SCRIPTS" \
    --identifier "$BUNDLE_ID" \
    --version "$APP_VERSION" \
    --install-location "/" \
    "$COMPONENT_PKG" \
    || fail "pkgbuild завершился с ошибкой."

ok "Component package создан."

# ── Distribution XML для productbuild ─────────────────────────
info "Генерирую distribution.xml..."
DIST_XML="$TMP_ROOT/distribution.xml"

cat > "$DIST_XML" << DISTXML_EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
    <title>Сортировщик чатов BX24 v$APP_VERSION</title>
    <organization>ru.pena-agency</organization>
    <domains enable_localSystem="true"/>

    <background file="background.png" mime-type="image/png" alignment="center" scaling="none"/>

    <welcome    file="welcome.rtf"    mime-type="text/rtf"/>
    <conclusion file="conclusion.rtf" mime-type="text/rtf"/>

    <options require-scripts="true" customize="never" allow-external-scripts="false"/>

    <volume-check>
        <allowed-os-versions>
            <os-version min="10.13"/>
        </allowed-os-versions>
    </volume-check>

    <choices-outline>
        <line choice="pena_agency"/>
    </choices-outline>

    <choice id="pena_agency"
            title="PENA Agency Extension"
            description="Расширение для фильтрации и сортировки чатов Bitrix24"
            customLocation="/Library/Application Support/PENA Agency/Extension">
        <pkg-ref id="$BUNDLE_ID"/>
    </choice>

    <pkg-ref id="$BUNDLE_ID"
             version="$APP_VERSION"
             onConclusion="none">component.pkg</pkg-ref>
</installer-gui-script>
DISTXML_EOF

# Простые RTF-тексты welcome/conclusion
cat > "$TMP_ROOT/welcome.rtf" << 'RTF_EOF'
{\rtf1\ansi\ansicpg1252
{\b Сортировщик чатов BX24 v5.0.0}\
\
Расширение добавляет фильтрацию и сортировку чатов Bitrix24 по ключевым словам, тегам и категориям.\
\
После установки:\
  \u8226  Откройте Bitrix24 через ярлык «Bitrix24 + Фильтр чатов» на рабочем столе\
  \u8226  Автообновление зарегистрируется автоматически (ежедневно в 10:00)
}
RTF_EOF

cat > "$TMP_ROOT/conclusion.rtf" << 'RTF_EOF'
{\rtf1\ansi\ansicpg1252
{\b Установка завершена!}\
\
Сортировщик чатов BX24 v5.0.0 установлен.\
\
Запустите Bitrix24 через ярлык «Bitrix24 + Фильтр чатов» на Рабочем столе или в папке ~/Applications.\
\
Расширение будет обновляться автоматически. Лог: ~/Library/Logs/bx24_chatsorter_updater.log
}
RTF_EOF

# ── Финальный .pkg ────────────────────────────────────────────
info "Собираю финальный .pkg (productbuild)..."
OUTPUT_PKG="$DIST_DIR/BX24_ChatSorter_v${APP_VERSION}.pkg"

productbuild \
    --distribution "$DIST_XML" \
    --package-path "$TMP_ROOT" \
    "$OUTPUT_PKG" \
    || fail "productbuild завершился с ошибкой."

echo ""
div
ok "macOS .pkg установщик создан:"
info "$OUTPUT_PKG"
div
echo ""
info "Установка: дважды щёлкните по файлу .pkg"
info "Или через терминал: sudo installer -pkg \"$OUTPUT_PKG\" -target /"
echo ""
