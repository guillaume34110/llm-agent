# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files

a = Analysis(
    ['monkey/main.py'],
    pathex=[],
    binaries=[],
    datas=(
        collect_data_files('fpdf') +
        collect_data_files('reportlab')
    ),
    hiddenimports=[
        'uvicorn.lifespan.on', 'uvicorn.lifespan.off',
        'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets.auto',
        'uvicorn.loops.auto', 'email.mime.text', 'email.mime.multipart',
        'fpdf', 'fpdf.fpdf', 'fpdf.fonts', 'fpdf.util', 'fpdf.enums',
        'fpdf.errors', 'fpdf.output', 'fpdf.page_break', 'fpdf.structure_tree',
        'fpdf.svg', 'fpdf.transitions',
        'reportlab', 'reportlab.platypus', 'reportlab.platypus.doctemplate',
        'reportlab.platypus.flowables', 'reportlab.platypus.paragraph',
        'reportlab.platypus.tables', 'reportlab.lib', 'reportlab.lib.styles',
        'reportlab.lib.units', 'reportlab.lib.colors', 'reportlab.lib.pagesizes',
        'reportlab.lib.enums', 'reportlab.pdfgen', 'reportlab.pdfgen.canvas',
        'reportlab.pdfbase', 'reportlab.pdfbase.pdfmetrics',
        'reportlab.pdfbase._fontdata', 'reportlab.pdfbase.ttfonts',
        'reportlab.graphics',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=2,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='monkey-server-aarch64-apple-darwin',
    debug=False,
    bootloader_ignore_signals=False,
    strip=True,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
