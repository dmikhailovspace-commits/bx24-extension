#!/bin/bash
# Двойной клик запускает этот файл в Terminal (macOS)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/install.sh"
