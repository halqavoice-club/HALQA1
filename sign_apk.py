"""
Minimal APK patcher - NO ZIP repacking needed:
1. Patch localhost->127.0.0.1 in-place in raw bytes (same 9-byte length)
2. Replace the v2 signing pair in the existing signing block
3. Keep everything else (ZIP, CD, EOCD, other pairs) exactly as-is

The v2 signing block structure:
  [8: total_size] [pairs...] [8: total_size] [16: magic]

Our replacement pair (v2, ID=0x7109871a) is 1471B in original.
New pair size will be different (our cert is smaller), so we:
- Remove the old v2 pair
- Add new v2 pair  
- Adjust the verity padding pair (ID=0x42726577) to fill the gap
  (verity padding is specifically designed to be resized)
"""
import struct, hashlib, base64, datetime, zlib, io, os

from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives.serialization import pkcs7

APK_ORIG = r'C:\Users\hp\AppData\Local\Temp\eas-cli-nodejs\eas-build-run-cache\6d809e46-f158-4552-8996-ef179bfaf59e_6c5231c8-cd69-485b-aeb6-6ab3db249bcb.apk'
APK_OUT  = r'C:\Users\Public\class management\nurul yaqin class ms\halqa-v107-signed.apk'
MAGIC    = b'APK Sig Block 42'
V2_ID    = 0x7109871a
VERITY_ID= 0x42726577

def lp(x): return struct.pack('<I', len(x)) + x

# ── 1. Key + cert ─────────────────────────────────────────────────────────────
print("=== 1. Key + Cert ===")
private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "HALQA Debug")])
cert_obj = (
    x509.CertificateBuilder()
    .subject_name(subject).issuer_name(issuer)
    .public_key(private_key.public_key())
    .serial_number(1)
    .not_valid_before(datetime.datetime(2024,1,1))
    .not_valid_after(datetime.datetime(2034,1,1))
    .sign(private_key, hashes.SHA256())
)
cert_der = cert_obj.public_bytes(serialization.Encoding.DER)
spki_der = private_key.public_key().public_bytes(
    serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
print(f"  cert={len(cert_der)}B")

# ── 2. Load APK ───────────────────────────────────────────────────────────────
print("=== 2. Load + patch bundle ===")
with open(APK_ORIG, 'rb') as f:
    raw = bytearray(f.read())

# Patch localhost -> 127.0.0.1 (same 9 bytes, safe)
count = raw.count(b'localhost')
raw = bytearray(bytes(raw).replace(b'localhost', b'127.0.0.1'))
print(f"  Patched {count} occurrence(s) of 'localhost'")
# Also update CRC for bundle (needed for v1 only; since no v1, skip for now)
# The v2 verifier recomputes digest from file bytes, not from ZIP metadata

# ── 3. Find signing block ──────────────────────────────────────────────────────
print("=== 3. Signing block ===")
eocd_off  = bytes(raw).rfind(b'PK\x05\x06')
cd_off    = struct.unpack_from('<I', raw, eocd_off+16)[0]
magic_off = cd_off - 16
assert raw[magic_off:magic_off+16] == MAGIC
sb_size   = struct.unpack_from('<Q', raw, magic_off-8)[0]
sb_start  = cd_off - 8 - sb_size
print(f"  SB=[{sb_start},{cd_off}) size={sb_size}")

# ── 4. Parse all pairs ────────────────────────────────────────────────────────
off = sb_start + 8
end = magic_off - 8
pairs = []
while off < end:
    pl   = struct.unpack_from('<Q', raw, off)[0]
    pid  = struct.unpack_from('<I', raw, off+8)[0]
    val  = bytes(raw[off+12:off+8+pl])
    pairs.append((pid, val))
    off += 8 + pl
print(f"  Pairs: {[(hex(p), len(v)) for p,v in pairs]}")

# ── 5. Compute content digest ─────────────────────────────────────────────────
print("=== 5. Content digest ===")
SIG_ALGO = 0x0103

# sec1 = bytes before signing block
# sec2 = central directory (unchanged)
# sec3 = EOCD with cd_off = sb_start
sec1 = bytes(raw[:sb_start])
sec2 = bytes(raw[cd_off:eocd_off])
sec3_arr = bytearray(raw[eocd_off:])
struct.pack_into('<I', sec3_arr, 16, sb_start)
sec3 = bytes(sec3_arr)

CHUNK = 1 << 20
def dsec(s):
    cks = []
    o = 0
    while o < len(s):
        c = s[o:o+CHUNK]
        cks.append(hashlib.sha256(struct.pack('<BI', 0xa5, len(c)) + c).digest())
        o += CHUNK
    return hashlib.sha256(struct.pack('<BI', 0x5a, len(cks)) + b''.join(cks)).digest()

d1 = dsec(sec1)
d2 = dsec(sec2)
d3 = dsec(sec3)
content_digest = hashlib.sha256(struct.pack('<BI', 0x5a, 3) + d1 + d2 + d3).digest()
print(f"  digest: {content_digest.hex()[:16]}...")

# ── 6. Build new v2 pair ──────────────────────────────────────────────────────
ditem = struct.pack('<I', SIG_ALGO) + lp(content_digest)
dseq  = lp(lp(ditem))
cseq  = lp(lp(cert_der))
aseq  = lp(b'')
sd    = dseq + cseq + aseq
raw_sig_ = private_key.sign(sd, padding.PKCS1v15(), hashes.SHA256())
se    = struct.pack('<I', SIG_ALGO) + lp(raw_sig_)
sinn  = lp(se)
snr   = lp(sd) + lp(sinn) + lp(spki_der)
sbv   = lp(lp(snr))
new_v2_pair_val = sbv

# ── 7. Rebuild signing block ──────────────────────────────────────────────────
print("=== 7. Rebuild signing block ===")

# Original total signing block size must be preserved (same bytes before CD)
# because sec1 is fixed. The signing block occupies [sb_start, cd_off).
# So our new signing block must be exactly (cd_off - sb_start) bytes.
original_sb_total = cd_off - sb_start  # includes the leading 8-byte size field
print(f"  Original total: {original_sb_total}B")

# Build new pairs: replace v2, keep PKDS (0x504b4453) and verity as-is
# But we'll adjust verity padding to maintain total size
def make_pair(pid, val):
    return struct.pack('<QI', 4 + len(val), pid) + val

new_pairs = []
for pid, val in pairs:
    if pid == V2_ID:
        new_pairs.append(make_pair(V2_ID, new_v2_pair_val))
    else:
        new_pairs.append(make_pair(pid, val))  # keep others as-is

new_pairs_bytes = b''.join(new_pairs)
# signing block layout: [8:size] [pairs] [8:size] [16:magic]
# size = len(pairs) + 8 + 16
new_sb_size = len(new_pairs_bytes) + 8 + 16
new_sb_total = 8 + new_sb_size
print(f"  New total: {new_sb_total}B  (diff: {new_sb_total - original_sb_total:+})")

# If sizes differ, adjust the verity padding pair
# Verity padding is just zeros and can be any size >= 8
size_diff = new_sb_total - original_sb_total
if size_diff != 0:
    print(f"  Adjusting verity padding by {-size_diff} bytes")
    # Find verity padding pair and resize it
    adjusted_pairs = []
    for pid, val in pairs:
        if pid == V2_ID:
            adjusted_pairs.append(make_pair(V2_ID, new_v2_pair_val))
        elif pid == VERITY_ID:
            # Reduce/increase verity padding
            current_verity_size = len(val)
            new_verity_size = current_verity_size - size_diff
            if new_verity_size < 0:
                print(f"  WARNING: verity padding too small, setting to 0")
                new_verity_size = 0
            adjusted_pairs.append(make_pair(VERITY_ID, b'\x00' * new_verity_size))
        else:
            adjusted_pairs.append(make_pair(pid, val))
    new_pairs_bytes = b''.join(adjusted_pairs)
    new_sb_size = len(new_pairs_bytes) + 8 + 16
    new_sb_total = 8 + new_sb_size
    print(f"  After adjustment: {new_sb_total}B (target: {original_sb_total}B)")

new_sb = struct.pack('<Q', new_sb_size) + new_pairs_bytes + struct.pack('<Q', new_sb_size) + MAGIC
assert len(new_sb) == original_sb_total, f"SB size: {len(new_sb)} != {original_sb_total}"

# ── 8. Patch signing block in-place ───────────────────────────────────────────
print("=== 8. Write ===")
raw[sb_start:cd_off] = new_sb

with open(APK_OUT, 'wb') as f:
    f.write(raw)
print(f"\n✓  {APK_OUT}")
print(f"   size: {len(raw):,}")
print()
print("ADB commands:")
print("  adb -s R3CW10AGPCE reverse tcp:5000 tcp:5000")
print("  adb -s R3CW10AGPCE install halqa-v107-signed.apk")
