# Инструкции для работы с проектом

- Перед нетривиальным изменением прочитайте `PROJECT_CONTEXT.md`.
- Не добавляйте параллельные установщики и не храните старые сборки в `dist/`.
- После изменения версии, состава runtime, структуры, загрузки, хранилища или релизной схемы обновите ручной контекст и выполните `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/update-project-context.ps1`.
- Перед выдачей релиза выполните `pnpm test` и `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/update-project-context.ps1 -Check`.
- Не заявляйте о живой проверке macOS без запуска на реальном Mac.
