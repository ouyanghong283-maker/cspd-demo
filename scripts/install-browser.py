from pathlib import Path
import urllib.request,zipfile,json,os
root=Path('.browser');root.mkdir(exist_ok=True)
j=json.load(urllib.request.urlopen('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json'))
u=next(x['url'] for x in j['channels']['Stable']['downloads']['chrome'] if x['platform']=='linux64')
archive=root/'chrome.zip'
print('Downloading Chrome for MCP',flush=True)
urllib.request.urlretrieve(u,archive)
with zipfile.ZipFile(archive) as z:
 z.extractall(root)
 for e in z.infolist():
  mode=e.external_attr>>16
  dest=root/e.filename
  if mode and dest.exists():dest.chmod(mode)
archive.unlink()
(root/'chrome-linux64/chrome').chmod(0o755)
print('Chrome ready:',(root/'chrome-linux64/chrome').resolve(),flush=True)
# Keep missing runtime libraries local; do not change the operating system.
import subprocess,re
if os.name=='posix':
 missing=subprocess.run(['ldd',str(root/'chrome-linux64/chrome')],capture_output=True,text=True).stdout
 if 'not found' in missing:
  packages=[]
  if 'libnspr4' in missing:packages.append('libnspr4')
  if 'libnss3' in missing:packages.append('libnss3')
  if 'libasound' in missing:packages.append('libasound2t64')
  if packages:
   uris=subprocess.check_output(['apt-get','download','--print-uris',*packages],text=True)
   for i,u in enumerate(re.findall(r"'(https?://[^']+)'",uris)):
    p=root/('runtime-'+str(i)+'.deb')
    urllib.request.urlretrieve(u.replace('http://','https://'),p)
    subprocess.run(['dpkg-deb','-x',str(p),str(root/'libs')],check=True)
   print('Local Chrome runtime libraries ready',flush=True)
