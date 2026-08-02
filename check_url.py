"""Compare the installed APK vs the downloaded APK to find differences."""
import zipfile, re, hashlib

phone_apk  = r'C:\Users\Public\phone-installed.apk'
local_apk  = r'C:\Users\Public\halqa109.apk'

def get_info(path):
    with zipfile.ZipFile(path) as z:
        import json
        cfg    = json.loads(z.read('assets/app.config'))
        bundle = z.read('assets/index.android.bundle')
    return {
        'version':     cfg['version'],
        'versionCode': cfg['android']['versionCode'],
        'bundle_hash': hashlib.sha256(bundle).hexdigest()[:16],
        'bundle_size': len(bundle),
        'has_wifi_ip': b'192.168.100.147' in bundle,
        'has_old_eth': b'10.69.164.240'   in bundle,
        'has_lh':      b'localhost:5000/api' in bundle,
        'has_space_ip':b'192.168 '         in bundle,    # space after 192.168
    }

print("=== Phone installed APK ===")
pi = get_info(phone_apk)
for k, v in pi.items():
    print(f"  {k}: {v}")

print()
print("=== Downloaded v1.0.9 APK ===")
di = get_info(local_apk)
for k, v in di.items():
    print(f"  {k}: {v}")

print()
print("=== Comparison ===")
if pi['bundle_hash'] == di['bundle_hash']:
    print("  MATCH: Both APKs have identical JS bundles")
else:
    print(f"  DIFFER: Phone={pi['bundle_hash']} Local={di['bundle_hash']}")
    print("  Phone has DIFFERENT bundle — may be an older version!")

if pi['version'] != di['version']:
    print(f"  Version mismatch: phone={pi['version']} local={di['version']}")
