# Сортировщик чатов BX24

Расширение PENA Agency для настольного Bitrix24. Добавляет папки, цветовые маркеры, поиск, фильтрацию и сортировку диалогов, сохраняя нативную ленту чатов.

Текущая версия: **7.5.88**.

## Установка

- Windows: запустите актуальный `PENA_Agency_Windows_v*.exe` из `dist/`.
- macOS Intel / Apple Silicon: откройте актуальный `PENA_Agency_macOS_Universal_v*.dmg` из `dist/`, затем запустите `PENA BX24 Installer.app`. Terminal не открывается.
- Chromium-браузер: включите режим разработчика и загрузите папку `extension/` как распакованное расширение.

Подробная пользовательская инструкция находится в `guide.html`.

## Разработка

```text
.github/workflows/  GitHub Actions для нативной сборки macOS
extension/          runtime расширения
installers/windows/ Windows builder, installer и updater
installers/macos/   macOS DMG builder, installer и updater
tests/              23 регрессионных набора и harness-файлы
tools/              служебные скрипты проекта
dist/               только текущие установочные артефакты
```

Полный технический контекст, архитектурные ограничения и релизный порядок: `PROJECT_CONTEXT.md`.

## Проверка

```powershell
pnpm install
pnpm test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/update-project-context.ps1 -Check
```

Требуется Node.js 20+.

## Сборка

Windows:

```powershell
installers\windows\build.bat
```

Нужен Inno Setup 6. Скрипт ищет `ISCC.exe` в `PATH` и стандартных каталогах установки.

macOS Universal собирается только на GitHub-hosted macOS runner:

```powershell
gh workflow run build-macos.yml --repo dmikhailovspace-commits/bx24-extension --ref main
gh run list --repo dmikhailovspace-commits/bx24-extension --workflow build-macos.yml --limit 1
```

Workflow вызывает `installers/macos/build.sh`, собирает DMG штатным `hdiutil`, проверяет образ, структуру `.app`, права исполнения и срезы Intel/Apple Silicon, после чего публикует DMG и SHA-256 как artifact. Локальная Windows-кросс-сборка не используется. Terminal при установке и запуске Bitrix24 не открывается.

После изменения версии, состава runtime-файлов или структуры проекта обновите контекст:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/update-project-context.ps1
```

## Приватность

Данные диалогов хранятся локально в `chrome.storage.local` и разделяются по порталу и пользователю. Репозиторий каталога проверяет соответствие портала origin страницы.
