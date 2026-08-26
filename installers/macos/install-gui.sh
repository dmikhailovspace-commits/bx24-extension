#!/bin/bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES_DIR="$APP_ROOT/Resources"
EXT_SOURCE="$RESOURCES_DIR/extension"
UPDATER_SOURCE="$RESOURCES_DIR/pena-updater.sh"
LAUNCHER_SOURCE="$RESOURCES_DIR/pena-launcher"
INSTALL_PARENT="$HOME/Library/Application Support/PENA Agency"
INSTALL_DIR="$INSTALL_PARENT/Extension"
LAUNCHER_APP="$HOME/Applications/Bitrix24 + Фильтр чатов.app"

show_error() {
    local message="${1:-Неизвестная ошибка}"
    /usr/bin/osascript - "$message" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
    display alert "PENA BX24" message (item 1 of argv) as critical buttons {"Закрыть"} default button 1
end run
APPLESCRIPT
}

fail() {
    trap - ERR
    show_error "$1"
    exit 1
}

trap 'show_error "Установка прервана. Проверьте права доступа и повторите запуск."' ERR

[ -f "$EXT_SOURCE/manifest.json" ] || fail "В установщике не найдено расширение. Скачайте DMG заново."
[ -x "$LAUNCHER_SOURCE" ] || fail "В установщике не найден системный launcher. Скачайте DMG заново."
VERSION="$(/usr/bin/sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$EXT_SOURCE/manifest.json" | /usr/bin/head -n 1)"
[ -n "$VERSION" ] || fail "Не удалось определить версию расширения."

choice="$(/usr/bin/osascript - "$VERSION" <<'APPLESCRIPT'
on run argv
    set appVersion to item 1 of argv
    display alert "Установить PENA BX24?" message ("Версия " & appVersion & "\n\nРасширение будет установлено для приложения Bitrix24. Терминал не откроется.") buttons {"Отмена", "Установить"} default button "Установить" cancel button "Отмена"
    return button returned of result
end run
APPLESCRIPT
)" || exit 0
[ "$choice" = "Установить" ] || exit 0

BITRIX_EXE=""
for candidate in \
    "/Applications/Bitrix24.app/Contents/MacOS/Bitrix24" \
    "$HOME/Applications/Bitrix24.app/Contents/MacOS/Bitrix24"
do
    if [ -f "$candidate" ]; then
        BITRIX_EXE="$candidate"
        break
    fi
done

if [ -z "$BITRIX_EXE" ]; then
    selected="$(/usr/bin/osascript <<'APPLESCRIPT'
try
    set pickedApp to choose application with prompt "Выберите приложение Bitrix24"
    return POSIX path of pickedApp
on error number -128
    return ""
end try
APPLESCRIPT
)"
    [ -n "$selected" ] || exit 0
    BITRIX_EXE="${selected%/}/Contents/MacOS/Bitrix24"
fi
[ -f "$BITRIX_EXE" ] || fail "Выбранное приложение не похоже на Bitrix24."

/bin/mkdir -p "$INSTALL_PARENT" "$HOME/Applications"
STAGE_DIR="$INSTALL_PARENT/.Extension.installing.$$"
BACKUP_DIR="$INSTALL_PARENT/.Extension.backup.$$"
/bin/rm -rf "$STAGE_DIR" "$BACKUP_DIR"
/bin/mkdir -p "$STAGE_DIR"
/usr/bin/ditto "$EXT_SOURCE" "$STAGE_DIR"
[ -f "$STAGE_DIR/manifest.json" ] || fail "Не удалось подготовить файлы расширения."

if [ -d "$INSTALL_DIR" ]; then /bin/mv "$INSTALL_DIR" "$BACKUP_DIR"; fi
if ! /bin/mv "$STAGE_DIR" "$INSTALL_DIR"; then
    [ -d "$BACKUP_DIR" ] && /bin/mv "$BACKUP_DIR" "$INSTALL_DIR"
    fail "Не удалось обновить установленное расширение."
fi
/bin/rm -rf "$BACKUP_DIR"

LAUNCHER_STAGE="$HOME/Applications/.Bitrix24-PENA.installing.$$"
/bin/rm -rf "$LAUNCHER_STAGE"
/bin/mkdir -p "$LAUNCHER_STAGE/Contents/MacOS" "$LAUNCHER_STAGE/Contents/Resources"
/bin/cp "$LAUNCHER_SOURCE" "$LAUNCHER_STAGE/Contents/MacOS/launcher"
/bin/chmod 755 "$LAUNCHER_STAGE/Contents/MacOS/launcher"
/bin/cp "$RESOURCES_DIR/launcher-Info.plist" "$LAUNCHER_STAGE/Contents/Info.plist"
/usr/bin/sed -i '' -e "s|__VERSION__|$VERSION|g" "$LAUNCHER_STAGE/Contents/Info.plist"
/usr/bin/printf '%s\n' "$BITRIX_EXE" > "$LAUNCHER_STAGE/Contents/Resources/bitrix-executable.path"
/usr/bin/printf '%s\n' "$INSTALL_DIR" > "$LAUNCHER_STAGE/Contents/Resources/extension-directory.path"
/bin/rm -rf "$LAUNCHER_APP"
/bin/mv "$LAUNCHER_STAGE" "$LAUNCHER_APP"
/usr/bin/xattr -cr "$LAUNCHER_APP" 2>/dev/null || true

if [ -f "$UPDATER_SOURCE" ]; then
    /bin/cp "$UPDATER_SOURCE" "$INSTALL_DIR/pena_updater.sh"
    /bin/chmod 755 "$INSTALL_DIR/pena_updater.sh"
    /bin/bash "$INSTALL_DIR/pena_updater.sh" --setup >/dev/null 2>&1 || true
fi

UNINSTALL_PATH="$INSTALL_DIR/uninstall.sh"
cat > "$UNINSTALL_PATH" <<'UNINSTALL'
#!/bin/bash
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCHER_APP="$HOME/Applications/Bitrix24 + Фильтр чатов.app"
PLIST_FILE="$HOME/Library/LaunchAgents/ru.pena-agency.updater.plist"
/bin/launchctl bootout "gui/$(/usr/bin/id -u)" "$PLIST_FILE" 2>/dev/null || true
/bin/launchctl unload "$PLIST_FILE" 2>/dev/null || true
/bin/rm -f "$PLIST_FILE"
/bin/rm -rf "$LAUNCHER_APP"
/bin/rm -rf "$INSTALL_DIR"
/usr/bin/osascript -e 'display alert "PENA BX24 удалён" message "Расширение, launcher и автообновление удалены." buttons {"Закрыть"} default button 1' >/dev/null 2>&1 || true
UNINSTALL
/bin/chmod 755 "$UNINSTALL_PATH"

trap - ERR
result="$(/usr/bin/osascript - "$VERSION" <<'APPLESCRIPT'
on run argv
    set appVersion to item 1 of argv
    display alert "PENA BX24 установлен" message ("Версия " & appVersion & " готова к работе.\n\nЗапускайте Bitrix24 через приложение «Bitrix24 + Фильтр чатов» в папке Applications.") buttons {"Закрыть", "Запустить Bitrix24"} default button "Запустить Bitrix24"
    return button returned of result
end run
APPLESCRIPT
)" || true

if [ "$result" = "Запустить Bitrix24" ]; then
    /usr/bin/open "$LAUNCHER_APP"
fi
