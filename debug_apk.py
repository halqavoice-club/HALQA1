"""Deep inspect the 0x504b4453 pair - it might be a v3 signing block."""
import struct

MAGIC = b'APK Sig Block 42'
orig = r'C:\Users\hp\AppData\Local\Temp\eas-cli-nodejs\eas-build-run-cache\6d809e46-f158-4552-8996-ef179bfaf59e_6c5231c8-cd69-485b-aeb6-6ab3db249bcb.apk'

with open(orig, 'rb') as f: data = f.read()
eocd_off = data.rfind(b'PK\x05\x06')
cd_off   = struct.unpack_from('<I', data, eocd_off+16)[0]
magic_off= cd_off - 16
sb_size  = struct.unpack_from('<Q', data, magic_off-8)[0]
sb_start = cd_off - 8 - sb_size

off = sb_start + 8
end = magic_off - 8
while off < end:
    pl = struct.unpack_from('<Q', data, off)[0]
    pid= struct.unpack_from('<I', data, off+8)[0]
    val= bytes(data[off+12:off+8+pl])
    if pid == 0x504b4453:
        print(f"0x504b4453 pair: {len(val)} bytes")
        print(f"First 200 bytes hex:")
        for i in range(0, min(200, len(val)), 16):
            chunk = val[i:i+16]
            h = ' '.join(f'{b:02x}' for b in chunk)
            p = ''.join(chr(b) if 32<=b<127 else '.' for b in chunk)
            print(f"  {i:4d}: {h:<48}  {p}")
        
        # Try to parse as a signing structure
        # Check if it starts with a uint32 (signer sequence length)
        if len(val) >= 4:
            possible_len = struct.unpack_from('<I', val, 0)[0]
            print(f"\nFirst uint32 as length: {possible_len} (total val is {len(val)})")
            # If possible_len + 4 == len(val), it's a length-prefixed sequence
            print(f"  possible_len + 4 = {possible_len + 4}")
    off += 8 + pl
