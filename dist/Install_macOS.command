#!/bin/bash
# ==============================================================
# Сортировщик чатов BX24 — Установщик для macOS
# Скачивает последнюю версию с GitHub и устанавливает
# ==============================================================
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
REPO="dmikhailovspace-commits/bx24-extension"
ZIP_URL="https://github.com/$REPO/archive/refs/heads/main.zip"
TMP_DIR=$(mktemp -d)

echo -e "${CYAN}======================================================${NC}"
echo -e "${CYAN}  Сортировщик чатов BX24 — Установщик для macOS${NC}"
echo -e "${CYAN}======================================================${NC}"
echo ""
echo -e "  -> Скачиваю расширение с GitHub..."

if ! curl -L --progress-bar -o "$TMP_DIR/ext.zip" "$ZIP_URL"; then
    echo -e "${RED}  !! Ошибка загрузки. Проверьте интернет-подключение.${NC}"
    rm -rf "$TMP_DIR"; echo -n "  Нажмите Enter..."; read -r; exit 1
fi

echo -e "  -> Распаковываю..."
unzip -q "$TMP_DIR/ext.zip" -d "$TMP_DIR/"
EXT_ARCHIVE=$(ls -d "$TMP_DIR"/bx24-extension-* 2>/dev/null | head -1)

if [ -z "$EXT_ARCHIVE" ] || [ ! -f "$EXT_ARCHIVE/installers/macos/install.command" ]; then
    echo -e "${RED}  !! Не удалось распаковать архив.${NC}"
    rm -rf "$TMP_DIR"; echo -n "  Нажмите Enter..."; read -r; exit 1
fi

echo -e "  ${GREEN}OK  Загружено${NC}"
echo ""

# Запускаем настоящий установщик из архива
bash "$EXT_ARCHIVE/installers/macos/install.command"
EXIT_CODE=$?
rm -rf "$TMP_DIR"
exit $EXIT_CODE
