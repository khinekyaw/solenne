# =========================================================================
# GLB touch-ups after Blender's export. Blender writes one glTF animation per
# action, so the ramp and its foot came out as two clips; viewers (and a game
# that plays one clip) then close the ramp without folding the foot, which
# pokes out through the hull. Merge them into one named clip.
#
#   python3 art/wren/gltf_post.py art/wren/out/wren.glb
# =========================================================================
import json
import struct
import sys


def merge_animations(path, name='DoorClose'):
    b = open(path, 'rb').read()
    magic, version, _ = struct.unpack_from('<III', b, 0)
    n, kind = struct.unpack_from('<II', b, 12)
    assert magic == 0x46546C67 and kind == 0x4E4F534A, 'not a GLB'
    g = json.loads(b[20:20 + n])
    rest = b[20 + n:]   # the binary chunk, untouched
    anims = g.get('animations', [])
    if len(anims) > 1 or (anims and anims[0].get('name') != name):
        merged = {'name': name, 'channels': [], 'samplers': []}
        for a in anims:
            off = len(merged['samplers'])
            merged['samplers'] += a['samplers']
            merged['channels'] += [dict(c, sampler=c['sampler'] + off) for c in a['channels']]
        g['animations'] = [merged]
    js = json.dumps(g, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    out = struct.pack('<III', magic, version, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4E4F534A) + js + rest
    open(path, 'wb').write(out)
    return [(a['name'], len(a['channels'])) for a in g.get('animations', [])]


if __name__ == '__main__':
    print(merge_animations(sys.argv[1]))
