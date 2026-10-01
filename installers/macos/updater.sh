#!/bin/bash
# ==============================================================
# PENA Agency — Скрипт автообновления (macOS)
# Режимы запуска:
#   --setup  : Первоначальная настройка (запускается установщиком)
#              Регистрирует LaunchAgent для ежедневного обновления.
#   (нет)    : Только проверяет. Установка требует --approved-version.
#
# LaunchAgent запускает этот скрипт ежедневно автоматически.
# ==============================================================

# ── Конфигурация релизного репозитория ──
UPDATE_JSON_URL="https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json"
INSTALL_DIR="$HOME/Library/Application Support/PENA Agency/Extension"
TRUSTED_RAW_PREFIX="https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_NAME="ru.pena-agency.updater"
PLIST_FILE="$LAUNCH_AGENTS_DIR/$PLIST_NAME.plist"
LOG_FILE="$HOME/Library/Logs/pena_agency_updater.log"
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
# ──────────────────────────────────────────────────────────────

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
REQUIRED_EXTENSION_FILES="background.js
content.js
native-catalog.js
native-interaction-state.js
native-time-control.js
native-lifecycle.js
dialog-repository.js
injected.js
injected.css
manifest.json
popup.html
popup.js
fonts/Onest-Variable.ttf
fonts/Unbounded-Variable.ttf
icons/icon16.png
icons/icon48.png
icons/icon128.png
icons/logo.png"

log() {
    local ts; ts=$(date "+%Y-%m-%d %H:%M:%S")
    local msg="[$ts] $1"
    echo -e "  $msg"
    mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null
    echo "$msg" >> "$LOG_FILE" 2>/dev/null
}

notify() {
    # macOS системное уведомление
    osascript -e "display notification \"$2\" with title \"$1\"" 2>/dev/null || true
}

version_is_newer() {
    # BSD sort в macOS не гарантирует -V, поэтому сравниваем числовые части через awk.
    awk -v a="$1" -v b="$2" 'BEGIN {
        na = split(a, av, "."); nb = split(b, bv, "."); n = na > nb ? na : nb;
        for (i = 1; i <= n; i++) {
            ai = (i <= na ? av[i] : 0) + 0;
            bi = (i <= nb ? bv[i] : 0) + 0;
            if (ai > bi) exit 0;
            if (ai < bi) exit 1;
        }
        exit 1;
    }'
}

# plutil is part of supported macOS; python3 may only be an Xcode installer stub.
json_scalar() {
    printf '%s' "$1" | /usr/bin/plutil -extract "$2" raw -o - - 2>/dev/null
}

json_array_lines() {
    printf '%s' "$1" | /usr/bin/plutil -extract "$2" xml1 -o - - 2>/dev/null |
        sed -n 's:.*<string>\([^<]*\)</string>.*:\1:p'
}

safe_release_path() {
    local value="$1"
    [ -n "$value" ] || return 1
    case "$value" in
        /*|*\\*|*[!A-Za-z0-9._/-]*) return 1 ;;
    esac
    case "/$value/" in
        */../*) return 1 ;;
    esac
    return 0
}

contains_line() {
    printf '%s\n' "$1" | grep -Fqx "$2"
}

download_release_file() {
    local url="$1" destination="$2" temporary="${2}.download"
    mkdir -p "$(dirname "$destination")" || return 1
    rm -f "$temporary"
    if ! curl -fsSL --retry 2 --retry-delay 1 --connect-timeout 10 --max-time 60 "$url" -o "$temporary"; then
        local relative="${url#"$TRUSTED_RAW_PREFIX/"}" tag
        tag="${relative%%/*}"
        [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || return 1
        curl -fsSL --connect-timeout 10 --max-time 60 -H 'Accept: application/vnd.github.raw+json' \
            "https://api.github.com/repos/dmikhailovspace-commits/bx24-extension/contents/${relative#*/}?ref=$tag" -o "$temporary" || return 1
    fi
    [ -s "$temporary" ] || return 1
    mv -f "$temporary" "$destination" || return 1
}

installed_release_healthy() {
    local required_file module
    local manifest worker
    manifest=$(cat "$INSTALL_DIR/manifest.json" 2>/dev/null)
    worker=$(json_scalar "$manifest" background.service_worker)
    safe_release_path "$worker" && [ -s "$INSTALL_DIR/$worker" ] || return 1
    while IFS= read -r required_file; do
        [ -s "$INSTALL_DIR/$required_file" ] || return 1
    done << REQUIRED_FILES_EOF
$REQUIRED_EXTENSION_FILES
REQUIRED_FILES_EOF
    [ -s "$INSTALL_DIR/pena_updater.sh" ] || return 1
    for module in native-catalog.js native-interaction-state.js native-time-control.js native-lifecycle.js dialog-repository.js injected.js; do
        grep -Fq "\"$module\"" "$INSTALL_DIR/manifest.json" || return 1
    done
    return 0
}

# ==============================================================
# РЕЖИМ НАСТРОЙКИ (--setup)
# ==============================================================
register_native_host() {
    local parent host manifest dir
    parent=$(dirname "$INSTALL_DIR")
    host="$parent/pena-native-host.sh"
    mkdir -p "$parent" || return 1
    printf '#!/bin/bash\nexec /bin/bash %q --native-host "$@"\n' "$INSTALL_DIR/pena_updater.sh" > "$host"
    chmod 755 "$host"
    manifest=$(/usr/bin/osascript -l JavaScript -e 'function run(a){return JSON.stringify({name:"com.pena.agency.helper",description:"PENA BX24 update helper",path:a[0],type:"stdio",allowed_origins:["chrome-extension://hlhefpcndfepdlgbjcokkcodcbfnnepm/"]})}' "$host") || return 1
    for dir in 'Google/Chrome' Chromium 'Microsoft Edge'; do
        mkdir -p "$HOME/Library/Application Support/$dir/NativeMessagingHosts" || return 1
        printf '%s' "$manifest" > "$HOME/Library/Application Support/$dir/NativeMessagingHosts/com.pena.agency.helper.json"
    done
}

native_reply() {
    local body="$1" length=${#1}
    printf "\\$(printf '%03o' $((length & 255)))\\$(printf '%03o' $(((length >> 8) & 255)))\\$(printf '%03o' $(((length >> 16) & 255)))\\$(printf '%03o' $(((length >> 24) & 255)))"
    printf '%s' "$body"
}

if [ "${1:-}" = '--native-host' ]; then
    # Only the fixed extension may start this native host. All stdout is framed.
    [ "${2:-}" = 'chrome-extension://hlhefpcndfepdlgbjcokkcodcbfnnepm/' ] || exit 1
    bytes=($(od -An -tu1 -N4))
    [ "${#bytes[@]}" -eq 4 ] || exit 1
    length=$((bytes[0] + (bytes[1]<<8) + (bytes[2]<<16) + (bytes[3]<<24)))
    [ "$length" -gt 0 ] && [ "$length" -le 4096 ] || exit 1
    message=$(dd bs=1 count="$length" 2>/dev/null)
    [ "$(printf '%s' "$message" | wc -c | tr -d ' ')" = "$length" ] || exit 1
    action=$(json_scalar "$message" action)
    status_file="$(dirname "$INSTALL_DIR")/update-status.json"
    case "$action" in
        status)
            state=$(cat "$status_file" 2>/dev/null); [ -n "$state" ] || state='"idle"'
            native_reply "{\"ok\":true,\"protocol\":1,\"state\":$state}"
            ;;
        apply)
            version=$(json_scalar "$message" version)
            [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || { native_reply '{"ok":false,"error":"invalid_version"}'; exit 1; }
            printf '{"version":"%s","status":"installing"}' "$version" > "$status_file"
            (
                /bin/bash "$INSTALL_DIR/pena_updater.sh" --approved-version "$version"
                result=$?; state=error; [ "$result" -eq 0 ] && state=done
                printf '{"version":"%s","status":"%s"}' "$version" "$state" > "$status_file"
            ) </dev/null >>"$LOG_FILE" 2>&1 &
            native_reply '{"ok":true,"started":true}'
            ;;
        *) native_reply '{"ok":false,"error":"unknown_action"}' ;;
    esac
    exit 0
fi

if [ "${1:-}" = "--setup" ]; then
    log "=== РЕЖИМ НАСТРОЙКИ ==="

    # Копируем себя в папку расширения (чтобы LaunchAgent всегда мог нас найти)
    INSTALLED_UPDATER="$INSTALL_DIR/pena_updater.sh"
    if [ -f "$SCRIPT_PATH" ]; then
        cp "$SCRIPT_PATH" "$INSTALLED_UPDATER" 2>/dev/null || true
        chmod +x "$INSTALLED_UPDATER" 2>/dev/null || true
    fi

    # Создаём LaunchAgent plist
    mkdir -p "$LAUNCH_AGENTS_DIR"
    cat > "$PLIST_FILE" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$INSTALLED_UPDATER</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>   <integer>10</integer>
        <key>Minute</key> <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_FILE</string>
    <key>StandardErrorPath</key>
    <string>$LOG_FILE</string>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
PLIST_EOF

    # Загружаем LaunchAgent
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
    if launchctl load "$PLIST_FILE" 2>/dev/null; then
        log "LaunchAgent зарегистрирован: $PLIST_NAME (ежедневно в 10:00)"
    else
        log "ПРЕДУПРЕЖДЕНИЕ: Не удалось загрузить LaunchAgent (macOS 13+: используется launchctl bootstrap)"
        # Для macOS Ventura+ (launchd domain)
        launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE" 2>/dev/null || \
            log "ПРЕДУПРЕЖДЕНИЕ: Запуск launchctl bootstrap также не удался — перезагрузитесь или загрузите вручную."
    fi

    register_native_host || log "Не удалось зарегистрировать помощник обновления."
    log "Настройка завершена."
    exit 0
fi

# ==============================================================
# РЕЖИМ ОБНОВЛЕНИЯ (запуск без параметров — из LaunchAgent)
# ==============================================================
log "=== ПРОВЕРКА ОБНОВЛЕНИЯ ==="

# Проверяем установку
if [ ! -f "$INSTALL_DIR/manifest.json" ]; then
    log "Расширение не установлено: $INSTALL_DIR — выход."
    exit 0
fi

# Читаем текущую версию тем же JSON-парсером, которым будет проверен staging.
LOCAL_MANIFEST=$(cat "$INSTALL_DIR/manifest.json" 2>/dev/null)
LOCAL_VERSION=$(json_scalar "$LOCAL_MANIFEST" version)

if [ -z "$LOCAL_VERSION" ]; then
    log "Не удалось определить текущую версию."
    exit 1
fi
log "Установлена версия: $LOCAL_VERSION"

# Получаем update.json
UPDATE_JSON=$(curl -fsSL --retry 2 --retry-delay 1 --connect-timeout 5 --max-time 15 -H 'Cache-Control: no-cache' "$UPDATE_JSON_URL" 2>/dev/null)
if [ -z "$UPDATE_JSON" ]; then
    UPDATE_JSON=$(curl -fsSL --connect-timeout 5 --max-time 15 -H 'Accept: application/vnd.github.raw+json' 'https://api.github.com/repos/dmikhailovspace-commits/bx24-extension/contents/update.json?ref=main' 2>/dev/null)
fi
if [ -z "$UPDATE_JSON" ]; then
    log "Не удалось получить update.json — пробуем завтра."
    exit 0
fi

REMOTE_VERSION=$(json_scalar "$UPDATE_JSON" version)
RAW_BASE_URL=$(json_scalar "$UPDATE_JSON" raw_base_url)
EXTENSION_FILES=$(json_array_lines "$UPDATE_JSON" extension_files)
MACOS_FILES=$(json_array_lines "$UPDATE_JSON" macos_files)

if [ -z "$REMOTE_VERSION" ] || [ -z "$RAW_BASE_URL" ] || [ -z "$EXTENSION_FILES" ]; then
    log "Некорректный update.json: отсутствует версия, raw_base_url или extension_files."
    exit 1
fi
if ! contains_line "$MACOS_FILES" "installers/macos/updater.sh"; then
    log "Некорректный update.json: отсутствует обязательный macOS updater."
    exit 1
fi

EXPECTED_RAW_BASE="$TRUSTED_RAW_PREFIX/v$REMOTE_VERSION"
if [ "$RAW_BASE_URL" != "$EXPECTED_RAW_BASE" ]; then
    log "ОШИБКА: raw_base_url должен указывать на неизменяемый тег $EXPECTED_RAW_BASE"
    exit 1
fi

log "Доступна версия: $REMOTE_VERSION"

NEEDS_REPAIR=false
if ! installed_release_healthy; then
    NEEDS_REPAIR=true
    log "Установленный release неполный."
fi

if ! version_is_newer "$REMOTE_VERSION" "$LOCAL_VERSION" && \
   { [ "$REMOTE_VERSION" != "$LOCAL_VERSION" ] || ! $NEEDS_REPAIR; }; then
    log "Обновление не требуется."
    exit 0
fi

if [ "$REMOTE_VERSION" = "$LOCAL_VERSION" ]; then
    log "Восстанавливаю неполный release $REMOTE_VERSION"
fi

if [ "${1:-}" != '--approved-version' ]; then
    log "Доступно обновление $REMOTE_VERSION. Ожидаем согласия в панели расширения."
    exit 0
fi
if [ "${2:-}" != "$REMOTE_VERSION" ] || ! [[ "$REMOTE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
    log "Версия изменилась. Требуется новое согласие."
    exit 1
fi
log "Загружаю подтверждённое обновление $REMOTE_VERSION ..."

while IFS= read -r required_file; do
    if ! contains_line "$EXTENSION_FILES" "$required_file"; then
        log "ОШИБКА: update.json не содержит обязательный runtime-файл: $required_file"
        exit 1
    fi
done << REQUIRED_FILES_EOF
$REQUIRED_EXTENSION_FILES
REQUIRED_FILES_EOF

INSTALL_PARENT=$(dirname "$INSTALL_DIR")
STAGE_DIR="$INSTALL_PARENT/Extension.update.$$.${RANDOM:-0}"
BACKUP_DIR="$INSTALL_DIR.previous"
LOCK_DIR="$INSTALL_PARENT/.extension-update.lock"

mkdir -p "$INSTALL_PARENT" || exit 1
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    LOCK_PID=$(cat "$LOCK_DIR/pid" 2>/dev/null)
    if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
        log "Другой процесс уже обновляет расширение."
        exit 0
    fi
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" 2>/dev/null || { log "Не удалось получить lock обновления."; exit 1; }
fi
printf '%s' "$$" > "$LOCK_DIR/pid"

cleanup_update() {
    [ -d "$STAGE_DIR" ] && rm -rf "$STAGE_DIR"
    [ -d "$LOCK_DIR" ] && rm -rf "$LOCK_DIR"
}
trap cleanup_update EXIT INT TERM

mkdir -p "$STAGE_DIR" || { log "Не удалось создать staging-каталог."; exit 1; }
if ! /usr/bin/ditto "$INSTALL_DIR" "$STAGE_DIR" 2>/dev/null; then
    log "Не удалось скопировать текущую установку в staging-каталог."
    exit 1
fi

while IFS= read -r file; do
    [ -n "$file" ] || continue
    if ! safe_release_path "$file"; then
        log "ОШИБКА: недопустимый путь release-файла: $file"
        exit 1
    fi
    if ! download_release_file "$RAW_BASE_URL/extension/$file" "$STAGE_DIR/$file"; then
        log "ОШИБКА: не удалось скачать $file; текущая версия не изменена."
        exit 1
    fi
    log "Загружен: $file"
done << EXTENSION_FILES_EOF
$EXTENSION_FILES
EXTENSION_FILES_EOF

while IFS= read -r source_file; do
    [ -n "$source_file" ] || continue
    if ! safe_release_path "$source_file"; then
        log "ОШИБКА: недопустимый путь platform-файла: $source_file"
        exit 1
    fi
    target_name=$(basename "$source_file")
    [ "$target_name" = "updater.sh" ] && target_name="pena_updater.sh"
    if ! download_release_file "$RAW_BASE_URL/$source_file" "$STAGE_DIR/$target_name"; then
        log "ОШИБКА: не удалось скачать $source_file; текущая версия не изменена."
        exit 1
    fi
    chmod +x "$STAGE_DIR/$target_name" 2>/dev/null || true
    log "Загружен release-файл: $source_file"
done << MACOS_FILES_EOF
$MACOS_FILES
MACOS_FILES_EOF

STAGED_MANIFEST=$(cat "$STAGE_DIR/manifest.json" 2>/dev/null)
STAGED_VERSION=$(json_scalar "$STAGED_MANIFEST" version)
if [ "$STAGED_VERSION" != "$REMOTE_VERSION" ]; then
    log "ОШИБКА: версия staging manifest ($STAGED_VERSION) не совпадает с release ($REMOTE_VERSION)."
    exit 1
fi

# The worker is release-specific; never require a filename from a previous tag.
STAGED_WORKER=$(json_scalar "$STAGED_MANIFEST" background.service_worker)
if ! safe_release_path "$STAGED_WORKER" || ! contains_line "$EXTENSION_FILES" "$STAGED_WORKER" || [ ! -s "$STAGE_DIR/$STAGED_WORKER" ]; then
    log "ОШИБКА: отсутствует worker, объявленный в manifest.json."
    exit 1
fi
for stale_worker in "$STAGE_DIR"/worker-v*.js "$STAGE_DIR"/service-worker.js; do
    [ -f "$stale_worker" ] || continue
    [ "$stale_worker" = "$STAGE_DIR/$STAGED_WORKER" ] || rm -f "$stale_worker"
done

while IFS= read -r required_file; do
    if [ ! -s "$STAGE_DIR/$required_file" ]; then
        log "ОШИБКА: в staging-каталоге отсутствует обязательный файл: $required_file"
        exit 1
    fi
done << REQUIRED_FILES_EOF
$REQUIRED_EXTENSION_FILES
REQUIRED_FILES_EOF

for module in native-catalog.js native-interaction-state.js native-time-control.js native-lifecycle.js dialog-repository.js injected.js; do
    if ! grep -Fq "\"$module\"" "$STAGE_DIR/manifest.json"; then
        log "ОШИБКА: manifest.json не публикует runtime-модуль: $module"
        exit 1
    fi
done
if [ ! -s "$STAGE_DIR/pena_updater.sh" ]; then
    log "ОШИБКА: в staging-каталоге отсутствует обновлённый pena_updater.sh"
    exit 1
fi

# До переключения каталогов Bitrix24 не должен читать release с диска.
pkill -f "Bitrix24" 2>/dev/null || true
sleep 1

rm -rf "$BACKUP_DIR"
CURRENT_MOVED=false
if [ -d "$INSTALL_DIR" ]; then
    if ! mv "$INSTALL_DIR" "$BACKUP_DIR"; then
        log "ОШИБКА: не удалось подготовить текущую версию к переключению."
        exit 1
    fi
    CURRENT_MOVED=true
fi

if ! mv "$STAGE_DIR" "$INSTALL_DIR"; then
    if $CURRENT_MOVED && [ ! -d "$INSTALL_DIR" ] && [ -d "$BACKUP_DIR" ]; then
        mv "$BACKUP_DIR" "$INSTALL_DIR" 2>/dev/null || true
    fi
    log "ОШИБКА публикации release; выполнен rollback."
    exit 1
fi

chmod +x "$INSTALL_DIR/pena_updater.sh" 2>/dev/null || true
rm -rf "$BACKUP_DIR"
log "Release атомарно опубликован в: $INSTALL_DIR"
register_native_host || log "Не удалось зарегистрировать помощник обновления."

PENA_LAUNCHER="$HOME/Applications/Bitrix24 + Фильтр чатов.app"
if [ -d "$PENA_LAUNCHER" ]; then
    open "$PENA_LAUNCHER"
else
for p in "$HOME/Applications/Bitrix24.app" "/Applications/Bitrix24.app"; do
    if [ -d "$p" ]; then
        open "$p"
        break
    fi
done
fi

notify "PENA Agency обновлён" "Установлена версия $REMOTE_VERSION. Bitrix24 перезапускается."
log "Обновление до $REMOTE_VERSION завершено успешно."
