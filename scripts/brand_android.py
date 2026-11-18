from pathlib import Path
import re, shutil, xml.etree.ElementTree as ET
root=Path('android/app/src/main')
res=root/'res'
source=Path('public/android-icons')
if not source.is_dir(): raise SystemExit('Missing committed Volumi3d launcher icon variants')
for folder in ['mipmap-mdpi','mipmap-hdpi','mipmap-xhdpi','mipmap-xxhdpi','mipmap-xxxhdpi']:
    src=source/folder/'ic_launcher.png'
    if not src.is_file(): raise SystemExit(f'Missing launcher icon: {src}')
    dst=res/folder;dst.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst/'ic_launcher.png')
# Use the supplied image as the launcher icon on all Android versions, not the generated Capacitor icon.
for folder in [res/'mipmap-anydpi-v26']:
    for name in ['ic_launcher.xml','ic_launcher_round.xml']:
        p=folder/name
        if p.exists(): p.unlink()
manifest=root/'AndroidManifest.xml'
s=manifest.read_text()
m=re.search(r'<application\b[^>]*>',s,re.S)
if not m: raise SystemExit('Android application element not found')
tag=m.group(0)
for attr,value in [('android:icon','@mipmap/ic_launcher'),('android:roundIcon','@mipmap/ic_launcher'),('android:label','@string/app_name')]:
    if re.search(r'\b'+re.escape(attr)+r'="[^"]*"',tag): tag=re.sub(r'\b'+re.escape(attr)+r'="[^"]*"',f'{attr}="{value}"',tag)
    else: tag=tag[:-1]+f' {attr}="{value}">'
s=s[:m.start()]+tag+s[m.end():];manifest.write_text(s)
values=res/'values';values.mkdir(parents=True,exist_ok=True);strings=values/'strings.xml'
if strings.exists():
    tree=ET.parse(strings);element=tree.getroot().find("string[@name='app_name']")
    if element is None: element=ET.SubElement(tree.getroot(),'string',{'name':'app_name'})
    element.text='Volumi3d';tree.write(strings,encoding='utf-8',xml_declaration=True)
else:
    strings.write_text('<?xml version="1.0" encoding="utf-8"?><resources><string name="app_name">Volumi3d</string></resources>')
print('Launcher artwork installed; Android app label: Volumi3d')
