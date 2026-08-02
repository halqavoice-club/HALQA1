"""
Patch the HALQA APK:
  - Replace 'localhost' with '127.0.0.1' (same 9 bytes) in the Hermes bundle
  - This allows ADB reverse tunnel: adb reverse tcp:5000 tcp:5000
  - The APK certificate stays valid since we're only changing bundle content
    (the APK is signed with a debug/EAS key; we'll need to re-sign or use
     zipalign+apksign... actually EAS APKs use debug signing for internal builds)
"""
import zipfile
import os
import shutil

apk_in  = r'C:\Users\hp\AppData\Local\Temp\eas-cli-nodejs\eas-build-run-cache\6d809e46-f158-4552-8996-ef179bfaf59e_6c5231c8-cd69-485b-aeb6-6ab3db249bcb.apk'
apk_out = r'C:\Users\Public\class management\nurul yaqin class ms\halqa-v107-adb.apk'

OLD = b'localhost'   # 9 bytes
NEW = b'127.0.0.1'  # 9 bytes  (same length - safe Hermes patch!)

print(f"OLD: {OLD!r} ({len(OLD)} bytes)")
print(f"NEW: {NEW!r} ({len(NEW)} bytes)")
assert len(OLD) == len(NEW), "Lengths must match for safe Hermes patching!"

# Read APK
with zipfile.ZipFile(apk_in, 'r') as z:
    bundle_data = z.read('assets/index.android.bundle')

print(f"Original bundle size: {len(bundle_data)}")

# Count and show occurrences
count = bundle_data.count(OLD)
print(f"Occurrences of {OLD!r}: {count}")

# Show each occurrence context
pos = 0
occurrences = []
while True:
    idx = bundle_data.find(OLD, pos)
    if idx == -1:
        break
    occurrences.append(idx)
    ctx = bundle_data[max(0,idx-30):idx+40]
    printable = ''.join(chr(b) if 32 <= b < 127 else '.' for b in ctx)
    print(f"  [{len(occurrences)}] pos={idx}: {printable!r}")
    pos = idx + 1

# Patch the bundle
patched_bundle = bundle_data.replace(OLD, NEW)
assert len(patched_bundle) == len(bundle_data), "Patched bundle size changed!"
new_count = patched_bundle.count(NEW)
print(f"\nPatched: {count} occurrence(s) of 'localhost' -> '127.0.0.1'")
print(f"Verification - occurrences of NEW in patched: {new_count}")

# Write new APK by copying all entries, replacing the bundle
print(f"\nWriting patched APK to: {apk_out}")
with zipfile.ZipFile(apk_in, 'r') as z_in:
    with zipfile.ZipFile(apk_out, 'w', compression=zipfile.ZIP_DEFLATED) as z_out:
        for item in z_in.infolist():
            if item.filename == 'assets/index.android.bundle':
                print(f"  -> Replacing {item.filename} with patched version")
                z_out.writestr(item, patched_bundle)
            else:
                z_out.writestr(item, z_in.read(item.filename))

print(f"\nDone! Patched APK: {apk_out}")
print(f"APK size: {os.path.getsize(apk_out):,} bytes")
print()
print("NEXT STEPS:")
print("1. adb reverse tcp:5000 tcp:5000   (tunnel phone->PC backend)")
print("2. adb install -r halqa-v107-adb.apk")
print("NOTE: The APK signature will be broken - need to sign with debug key")
print("      OR use: adb install --no-verify (on rooted/debug devices)")
