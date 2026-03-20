"""
build_mac_bundle.py — собирает dist/BX24_Chat_Sorter_Mac.zip

Структура zip:
  BX24 Chat Sorter/
    install.command        <- bundle-установщик (исполняемый)
    extension/             <- файлы расширения Chrome
      manifest.json
      injected.js
      ...
      icons/

Запускать из корня проекта или из installers/build/.
"""
import os, stat, zipfile, sys

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXT_DIR     = os.path.join(BASE, 'extension')
BUNDLE_CMD  = os.path.join(BASE, 'installers', 'macos', 'install_bundle.command')
DIST_DIR    = os.path.join(BASE, 'dist')
OUT_ZIP     = os.path.join(DIST_DIR, 'BX24_Chat_Sorter_Mac.zip')

os.makedirs(DIST_DIR, exist_ok=True)

# Unix-права для исполняемых файлов
EXEC_PERM = (stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH) << 16
FILE_PERM = (stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH) << 16

SKIP_NAMES = {'installers', '.git', '.claude', 'dist', 'gitInf', 'docs',
              '__pycache__', '.DS_Store'}
SKIP_EXT   = {'.ps1', '.sh', '.bat', '.py', '.md', '.gitignore', '.command'}

def add_file(zf, arc_path, disk_path, executable=False):
    info = zipfile.ZipInfo(arc_path)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = EXEC_PERM if executable else FILE_PERM
    with open(disk_path, 'rb') as f:
        zf.writestr(info, f.read())
    print(f'  + {arc_path}')

with zipfile.ZipFile(OUT_ZIP, 'w', zipfile.ZIP_DEFLATED) as zf:

    # 1. Установщик — install.command (исполняемый)
    add_file(zf,
             'BX24 Chat Sorter/install.command',
             BUNDLE_CMD,
             executable=True)

    # 2. Файлы расширения
    for root, dirs, files in os.walk(EXT_DIR):
        dirs[:] = [d for d in dirs if d not in SKIP_NAMES]
        for fname in files:
            if fname in SKIP_NAMES or os.path.splitext(fname)[1] in SKIP_EXT:
                continue
            disk_path = os.path.join(root, fname)
            rel       = os.path.relpath(disk_path, EXT_DIR).replace('\\', '/')
            arc_path  = f'BX24 Chat Sorter/extension/{rel}'
            add_file(zf, arc_path, disk_path, executable=False)

print()
print(f'OK  {OUT_ZIP}')
print(f'    size: {os.path.getsize(OUT_ZIP) // 1024} KB')
print()
print('Инструкция для пользователя macOS:')
print('  1. Разархивировать BX24_Chat_Sorter_Mac.zip')
print('  2. Правый клик на install.command → Открыть  (первый раз)')
print('  3. Следовать инструкциям в терминале')
