from pathlib import Path
import urllib.parse,urllib.request,re
root=Path(__file__).resolve().parents[1]
names={'需求导入表':'Project requirements intake','启动纪要':'Project kickoff minutes','启动文件':'Project kickoff package','备件清单':'Commissioning spare parts','FAT报告':'Factory acceptance test report','SAT报告':'Site acceptance test report','客户签字清单':'Customer acceptance checklist','方案报价样例':'Solution and quotation example','沟通纪要':'Customer communication minutes','技术资料':'Technical reference package'}
for name,title in names.items():
 lines=['CSPD | BUSINESS DEMO',title,'Demo date: 2026-10-10','Project: Qingshan energy storage / DEMO-P001','Capacity: 10 MWh | Currency: CNY','This document is a demonstration sample, not an approval.', 'Customer: Demo Energy | Contact: Customer Chen', 'Scope: equipment, delivery schedule, acceptance and handover.', 'Requirements and results must be reviewed by the responsible role.', 'Uploading a file does not automatically approve the business step.', 'Status: sample prepared for business walkthrough.']
 text='BT /F1 18 Tf 50 790 Td ('+lines[0]+') Tj /F1 13 Tf '
 for line in lines[1:]:text+='0 -38 Td ('+line.replace('(','\\(').replace(')','\\)')+') Tj '
 text+='ET'
 objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',f'<< /Length {len(text.encode())} >>\nstream\n{text}\nendstream'.encode()]
 data=b'%PDF-1.4\n';offsets=[0]
 for i,obj in enumerate(objects,1):offsets.append(len(data));data+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
 start=len(data);data+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
 for offset in offsets[1:]:data+=f'{offset:010} 00000 n \n'.encode()
 data+=f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF'.encode()
 (root/'public/samples'/f'{name}.pdf').write_bytes(data)
print('10 PDF samples created',flush=True)
# Keep complete local fonts rather than recreating a text-only subset.
import runpy
runpy.run_path(str(root/'scripts/generate-fonts.py'), run_name='__main__')
