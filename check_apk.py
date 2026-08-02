import zipfile, json

f = r'C:\Users\Public\halqa111.apk'
with zipfile.ZipFile(f) as z:
    cfg = json.loads(z.read('assets/app.config'))
    bundle = z.read('assets/index.android.bundle')
    manifest = z.read('AndroidManifest.xml')
    entries = len(z.namelist())

ver = cfg['version']
vc  = cfg['android']['versionCode']
has_wifi = b'192.168.100.147' in bundle
has_clear = 'usesCleartextTraffic'.encode('utf-16-le') in manifest
has_net   = 'networkSecurityConfig'.encode('utf-16-le') in manifest

print(f"Version:             {ver}")
print(f"versionCode:         {vc}")
print(f"Entries:             {entries}")
print(f"Has WiFi IP:         {has_wifi}")
print(f"usesCleartextTraffic in manifest: {has_clear}")
print(f"networkSecurityConfig in manifest: {has_net}")
print()
if ver == '1.0.11' and vc == 11 and has_wifi and has_clear:
    print("PASS - v1.0.11 is correct")
else:
    print("FAIL - check above values")
