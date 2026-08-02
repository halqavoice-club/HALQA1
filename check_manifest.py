"""Verify v1.0.10 APK has cleartext traffic in manifest."""
import zipfile, struct, re

apk = r'C:\Users\Public\halqa110.apk'

with zipfile.ZipFile(apk) as z:
    import json
    cfg      = json.loads(z.read('assets/app.config'))
    manifest = z.read('AndroidManifest.xml')
    files    = z.namelist()

print(f"Version: {cfg['version']}  versionCode: {cfg['android']['versionCode']}")
print(f"app.json usesCleartextTraffic: {cfg['android'].get('usesCleartextTraffic', 'NOT SET')}")
print()

# Check res/xml for network security config
xml_files = [f for f in files if f.startswith('res/xml')]
print(f"res/xml files: {xml_files}")

# Search manifest for cleartext (UTF-16LE encoded)
cleartext_utf16 = 'usesCleartextTraffic'.encode('utf-16-le')
cleartext_found = cleartext_utf16 in manifest

network_utf16 = 'networkSecurityConfig'.encode('utf-16-le')
network_found = network_utf16 in manifest

print(f"\nManifest checks:")
print(f"  usesCleartextTraffic in manifest: {cleartext_found}")
print(f"  networkSecurityConfig in manifest: {network_found}")

if xml_files:
    # Read the network security config XML
    with zipfile.ZipFile(apk) as z:
        for xf in xml_files:
            data = z.read(xf)
            text = data.decode('utf-16-le', errors='replace')
            if 'cleartext' in text.lower() or 'network' in text.lower() or 'security' in text.lower():
                print(f"\n  {xf} content snippet: {text[:200]}")

print()
if cleartext_found or network_found or xml_files:
    print("✅ PASS: Network security config is present in v1.0.10")
else:
    print("❌ FAIL: No cleartext config found — HTTP will still be blocked")
    print("   Possible reasons:")
    print("   - The plugin ran but the manifest attribute is stored differently")
    print("   - EAS may not have used the latest commit")
