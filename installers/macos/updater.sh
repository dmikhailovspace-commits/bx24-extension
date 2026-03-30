#!/bin/bash
# ==============================================================
# PENA Agency — Скрипт автообновления (macOS)
# Версия: 6.1.0
#
# Режимы запуска:
#   --setup  : Первоначальная настройка (запускается установщиком)
#              Регистрирует LaunchAgent для ежедневного обновления.
#   (нет)    : Проверяет обновление и устанавливает, если есть.
#
# LaunchAgent запускает этот скрипт ежедневно автоматически.
# ==============================================================

# ── Конфигурация (замените URL на свой реальный репозиторий) ──
UPDATE_JSON_URL="https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json"
INSTALL_DIR="$HOME/Library/Application Support/PENA Agency/Extension"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_NAME="ru.pena-agency.updater"
PLIST_FILE="$LAUNCH_AGENTS_DIR/$PLIST_NAME.plist"
LOG_FILE="$HOME/Library/Logs/pena_agency_updater.log"
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
# ──────────────────────────────────────────────────────────────

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

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

compare_versions() {
    # Возвращает 0 если $1 > $2, 1 если $1 <= $2
    local a="$1" b="$2"
    if [ "$(printf '%s\n' "$a" "$b" | sort -V | tail -1)" = "$a" ] && [ "$a" != "$b" ]; then
        return 0  # a > b
    fi
    return 1  # a <= b
}

# ==============================================================
# РЕЖИМ НАСТРОЙКИ (--setup)
# ==============================================================
if [ "$1" = "--setup" ]; then
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
    <false/>
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

# Читаем текущую версию
if command -v python3 &>/dev/null; then
    LOCAL_VERSION=$(python3 -c "import json,sys; d=json.load(open('$INSTALL_DIR/manifest.json')); print(d['version'])" 2>/dev/null)
elif command -v python &>/dev/null; then
    LOCAL_VERSION=$(python -c "import json; d=json.load(open('$INSTALL_DIR/manifest.json')); print(d['version'])" 2>/dev/null)
else
    LOCAL_VERSION=$(grep -o '"version": *"[^"]*"' "$INSTALL_DIR/manifest.json" | grep -o '[0-9][0-9.]*' | head -1)
fi

if [ -z "$LOCAL_VERSION" ]; then
    log "Не удалось определить текущую версию."
    exit 1
fi
log "Установлена версия: $LOCAL_VERSION"

# Получаем update.json
UPDATE_JSON=$(curl -fsSL --max-time 15 "$UPDATE_JSON_URL" 2>/dev/null)
if [ -z "$UPDATE_JSON" ]; then
    log "Не удалось получить update.json — пробуем завтра."
    exit 0
fi

# Парсим версию
if command -v python3 &>/dev/null; then
    REMOTE_VERSION=$(echo "$UPDATE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['version'])")
else
    REMOTE_VERSION=$(echo "$UPDATE_JSON" | grep -o '"version": *"[^"]*"' | grep -o '[0-9][0-9.]*' | head -1)
fi

log "Доступна версия: $REMOTE_VERSION"

if ! compare_versions "$REMOTE_VERSION" "$LOCAL_VERSION"; then
    log "Обновление не требуется."
    exit 0
fi

log "Загружаю обновление $REMOTE_VERSION ..."

RAW_BASE="https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/extension"
UPDATE_FILES="background.js content.js injected.js manifest.json"

# Скачиваем файлы расширения напрямую с GitHub в папку установки
for f in $UPDATE_FILES; do
    if ! curl -fsSL --max-time 60 "$RAW_BASE/$f" -o "$INSTALL_DIR/$f"; then
        log "ОШИБКА: Не удалось скачать $f"
        exit 1
    fi
    log "Загружен: $f"
done
log "Файлы обновлены в: $INSTALL_DIR"

# Перезапускаем Bitrix24
pkill -f "Bitrix24" 2>/dev/null || true
sleep 3
for p in "$HOME/Applications/Bitrix24.app" "/Applications/Bitrix24.app"; do
    [ -d "$p" ] && open "$p" && break
done

notify "PENA Agency обновлён" "Установлена версия $REMOTE_VERSION. Bitrix24 перезапускается."
log "Обновление до $REMOTE_VERSION завершено успешно."
