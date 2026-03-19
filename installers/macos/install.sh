#!/bin/bash
# ==============================================================
# PENA Agency — Установщик расширения для Битрикс24
# Версия: 2.3.0  |  Платформа: macOS
# ==============================================================
# Запуск:
#   chmod +x installers/install_macos.sh
#   ./installers/install_macos.sh
# ==============================================================

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GRAY='\033[0;90m'
NC='\033[0m'

div()  { echo -e "${CYAN}$(printf '=%.0s' {1..54})${NC}"; }
ok()   { echo -e "  ${GREEN}OK  $*${NC}"; }
warn() { echo -e "  ${YELLOW}>>  $*${NC}"; }
info() { echo -e "  ${CYAN}->  $*${NC}"; }
fail() { echo -e "  ${RED}!!  $*${NC}"; }

# --------------------------------------------------------------
# Обработчик ошибок — показывает сообщение и ждёт Enter
# --------------------------------------------------------------
error_exit() {
    echo ""
    div
    fail "УСТАНОВКА ПРЕРВАНА"
    fail "$1"
    div
    echo ""
    echo -n "  Нажмите Enter для выхода..."
    read -r
    exit 1
}

div
echo -e "${CYAN}  PENA Agency - Установщик расширения${NC}"
echo -e "${CYAN}  Bitrix24  |  macOS  |  v2.3.0${NC}"
div
echo ""

# ==============================================================
# 1. Пути
# ==============================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_SOURCE="$(cd "$SCRIPT_DIR/../../extension" && pwd)"
INSTALL_DIR="$HOME/Library/Application Support/PENA Agency/Extension"

echo -e "  ${GRAY}Исходная папка:   $EXT_SOURCE${NC}"
echo -e "  ${GRAY}Папка установки:  $INSTALL_DIR${NC}"
echo ""

[ -f "$EXT_SOURCE/manifest.json" ] || \
    error_exit "manifest.json не найден в: $EXT_SOURCE — убедитесь, что папка installers находится внутри папки расширения."

# ==============================================================
# 2. Копируем файлы расширения
# ==============================================================
warn "Копирую файлы расширения..."

if [ -d "$INSTALL_DIR" ]; then
    warn "Найдена предыдущая установка — обновляю..."
    rm -rf "$INSTALL_DIR" || error_exit "Не удалось удалить предыдущую установку: $INSTALL_DIR"
fi

mkdir -p "$INSTALL_DIR" || error_exit "Не удалось создать папку: $INSTALL_DIR"

if command -v rsync &>/dev/null; then
    rsync -a \
        --exclude='installers/' \
        --exclude='.claude/' \
        --exclude='docs/' \
        --exclude='gitInf/' \
        --exclude='.git/' \
        --exclude='*.sh' \
        --exclude='*.ps1' \
        --exclude='*.bat' \
        --exclude='README.md' \
        --exclude='.gitignore' \
        "$EXT_SOURCE/" "$INSTALL_DIR/" \
        || error_exit "Ошибка копирования файлов (rsync)"
else
    for item in "$EXT_SOURCE"/*; do
        name="$(basename "$item")"
        case "$name" in
            installers|docs|.claude|gitInf|.git|*.sh|*.ps1|*.bat|README.md|.gitignore)
                continue ;;
        esac
        cp -R "$item" "$INSTALL_DIR/" || warn "Не удалось скопировать: $name"
    done
fi

[ -f "$INSTALL_DIR/manifest.json" ] || \
    error_exit "Файлы не скопировались. Проверьте права доступа к: $INSTALL_DIR"

ok "Файлы скопированы: $INSTALL_DIR"
echo ""

# ==============================================================
# 3. Ищем Битрикс24
# ==============================================================
BITRIX_CANDIDATES=(
    "/Applications/Bitrix24.app/Contents/MacOS/Bitrix24"
    "$HOME/Applications/Bitrix24.app/Contents/MacOS/Bitrix24"
)

BITRIX_EXE=""
for p in "${BITRIX_CANDIDATES[@]}"; do
    [ -f "$p" ] && BITRIX_EXE="$p" && break
done

if [ -z "$BITRIX_EXE" ]; then
    warn "Битрикс24 не найден по стандартным путям."
    echo ""
    echo -n "  Введите полный путь к Bitrix24 (MacOS/Bitrix24): "
    read -r BITRIX_EXE
    BITRIX_EXE="${BITRIX_EXE//\"/}"  # убираем кавычки
    BITRIX_EXE="${BITRIX_EXE# }"     # убираем ведущий пробел
    BITRIX_EXE="${BITRIX_EXE% }"     # убираем хвостовой пробел
    [ -f "$BITRIX_EXE" ] || error_exit "Файл не найден: $BITRIX_EXE"
fi

ok "Битрикс24: $BITRIX_EXE"
echo ""

# ==============================================================
# 4. Создаём launcher-приложение (.app)
# ==============================================================
APP_NAME="Bitrix24 + Фильтр чатов.app"
APPS_DIR="$HOME/Applications"
DESKTOP_DIR="$HOME/Desktop"
APP_INST="$APPS_DIR/$APP_NAME"
APP_DESK="$DESKTOP_DIR/$APP_NAME"

[ -e "$APP_INST" ] && rm -rf "$APP_INST"
[ -e "$APP_DESK" ] && rm -rf "$APP_DESK"
mkdir -p "$APPS_DIR"

build_app() {
    local TARGET="$1"
    mkdir -p "$TARGET/Contents/MacOS"     || return 1
    mkdir -p "$TARGET/Contents/Resources" || return 1

    # Launcher (bash — работает на всех версиях macOS 10.13+)
    cat > "$TARGET/Contents/MacOS/launcher" << LAUNCHER_EOF
#!/bin/bash
exec "$BITRIX_EXE" \\
    --disable-extensions-except="$INSTALL_DIR" \\
    --load-extension="$INSTALL_DIR"
LAUNCHER_EOF
    chmod +x "$TARGET/Contents/MacOS/launcher" || return 1

    # Копируем иконку Битрикс24
    local RESOURCES_DIR ICON_FILE ICON_KEY=""
    RESOURCES_DIR="$(dirname "$(dirname "$BITRIX_EXE")")/Resources"
    ICON_FILE="$(find "$RESOURCES_DIR" -name "*.icns" -maxdepth 2 2>/dev/null | head -n 1)"
    if [ -n "$ICON_FILE" ] && [ -f "$ICON_FILE" ]; then
        cp "$ICON_FILE" "$TARGET/Contents/Resources/AppIcon.icns" 2>/dev/null || true
        ICON_KEY="    <key>CFBundleIconFile</key>
    <string>AppIcon</string>"
    fi

    cat > "$TARGET/Contents/Info.plist" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>    <string>launcher</string>
    <key>CFBundleIdentifier</key>   <string>ru.pena-agency.bx24chatsort</string>
    <key>CFBundleName</key>         <string>Bitrix24 + Фильтр чатов</string>
    <key>CFBundleDisplayName</key>  <string>Bitrix24 + Фильтр чатов</string>
    <key>CFBundlePackageType</key>  <string>APPL</string>
    <key>CFBundleShortVersionString</key> <string>2.3.0</string>
    <key>LSMinimumSystemVersion</key>    <string>10.13</string>
    ${ICON_KEY}
</dict>
</plist>
PLIST_EOF
    return 0
}

APP_BUILT=false
if build_app "$APP_INST"; then
    xattr -cr "$APP_INST" 2>/dev/null || true   # снимаем карантин macOS
    ok "Создано приложение: $APP_INST"
    APP_BUILT=true
else
    warn "Не удалось создать launcher-приложение."
fi

if $APP_BUILT && [ -d "$DESKTOP_DIR" ]; then
    if cp -R "$APP_INST" "$APP_DESK" 2>/dev/null; then
        xattr -cr "$APP_DESK" 2>/dev/null || true
        ok "Ярлык на рабочем столе: $APP_DESK"
    else
        warn "Не удалось скопировать ярлык на рабочий стол."
    fi
fi
echo ""

# ==============================================================
# 5. Автообновление — LaunchAgent
# ==============================================================
UPDATER_SRC="$SCRIPT_DIR/updater.sh"
UPDATER_DST="$INSTALL_DIR/updater.sh"

if [ -f "$UPDATER_SRC" ]; then
    cp "$UPDATER_SRC" "$UPDATER_DST"
    chmod +x "$UPDATER_DST"
    # Вызываем --setup для регистрации LaunchAgent
    bash "$UPDATER_DST" --setup 2>/dev/null && \
        ok "Автообновление: зарегистрировано (ежедневно в 10:00)" || \
        warn "Не удалось зарегистрировать LaunchAgent — повторите вручную: bash \"$UPDATER_DST\" --setup"
else
    warn "updater.sh не найден — автообновление не настроено."
fi
echo ""

# ==============================================================
# 6. Деинсталлятор
# ==============================================================
UNINSTALL_PATH="$INSTALL_DIR/uninstall.sh"

{
    cat << 'UHEAD'
#!/bin/bash
# PENA Agency — Деинсталлятор (macOS)
CYAN='\033[0;36m'; GREEN='\033[0;32m'; NC='\033[0m'
UHEAD

    # Вставляем пути, определённые при установке
    printf 'APP_INST="%s"\n'    "$APP_INST"
    printf 'APP_DESK="%s"\n'    "$APP_DESK"
    printf 'INSTALL_DIR="%s"\n' "$INSTALL_DIR"

    cat << 'UBODY'

echo -e "${CYAN}Удаление PENA Agency Extension...${NC}"
[ -e "$APP_DESK" ]    && rm -rf "$APP_DESK"    && echo -e "  ${GREEN}Удалено: $APP_DESK${NC}"
[ -e "$APP_INST" ]    && rm -rf "$APP_INST"    && echo -e "  ${GREEN}Удалено: $APP_INST${NC}"
[ -d "$INSTALL_DIR" ] && rm -rf "$INSTALL_DIR" && echo -e "  ${GREEN}Удалена: $INSTALL_DIR${NC}"
PARENT="$(dirname "$INSTALL_DIR")"
[ -d "$PARENT" ] && rmdir "$PARENT" 2>/dev/null || true
echo ""
echo -e "${GREEN}PENA Agency успешно удалён.${NC}"
UBODY
} > "$UNINSTALL_PATH"

chmod +x "$UNINSTALL_PATH"
ok "Деинсталлятор: $UNINSTALL_PATH"
echo ""

# ==============================================================
# 6. Итог
# ==============================================================
div
ok "Установка завершена успешно!"
div
echo ""
info "Расширение: $INSTALL_DIR"
$APP_BUILT && info "Приложение:  $APP_INST"
[ -e "$APP_DESK" ] && info "Ярлык:       $APP_DESK"
echo ""
warn "Для удаления: $UNINSTALL_PATH"
echo ""
echo -n "  Запустить Битрикс24 прямо сейчас? (y/n): "
read -r ANSWER
if [[ "$ANSWER" =~ ^[YyДд]$ ]]; then
    ok "Запускаю..."
    if $APP_BUILT && [ -d "$APP_INST" ]; then
        open "$APP_INST" 2>/dev/null || \
            nohup "$BITRIX_EXE" \
                --disable-extensions-except="$INSTALL_DIR" \
                --load-extension="$INSTALL_DIR" &>/dev/null &
    else
        nohup "$BITRIX_EXE" \
            --disable-extensions-except="$INSTALL_DIR" \
            --load-extension="$INSTALL_DIR" &>/dev/null &
    fi
fi
echo ""
