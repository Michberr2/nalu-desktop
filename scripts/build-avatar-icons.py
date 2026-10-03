"""Package the unchanged mobile avatar artwork as macOS and Windows icons.
Run python3 scripts/build-avatar-icons.py on macOS after avatar sync.
"""
from pathlib import Path
import struct, subprocess, tempfile
root = Path(__file__).resolve().parent.parent
source = root / 'build/nalu-avatar.png'
with tempfile.TemporaryDirectory(prefix='nalu-avatar-icons-') as temporary:
    icons = Path(temporary) / 'avatar.iconset'
    icons.mkdir()
    for size in [16, 32, 128, 256, 512]:
        for scale in [1, 2]:
            suffix = '@2x' if scale == 2 else ''
            subprocess.run(['sips', '-z', str(size*scale), str(size*scale), str(source), '--out', str(icons / f'icon_{size}x{size}{suffix}.png')], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['iconutil', '-c', 'icns', str(icons), '-o', str(root / 'build/avatar.icns')], check=True)
    images = [(size, (icons / f'icon_{size}x{size}.png').read_bytes()) for size in [16, 32, 128, 256]]
    header = struct.pack('<HHH', 0, 1, len(images))
    offset = 6 + 16*len(images)
    entries, payload = bytearray(), bytearray()
    for size, data in images:
        entries += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        payload += data
        offset += len(data)
    (root / 'build/avatar.ico').write_bytes(header + entries + payload)
print('Packaged original mobile artwork for macOS, Windows and Linux.')
