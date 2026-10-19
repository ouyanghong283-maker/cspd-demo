/** 合同真实原件的格式与容量校验；纯函数便于单测。 */
export const CONTRACT_ORIGINAL_MAX_BYTES = 20 * 1024 * 1024;
export interface ContractOriginalTypeRule {
  extensions: string[];
  mimeTypes: string[];
  label: string;
}
export const CONTRACT_ORIGINAL_TYPES: ContractOriginalTypeRule[] = [
  { extensions: ['.pdf'], mimeTypes: ['application/pdf'], label: 'PDF' },
  {
    extensions: ['.doc'],
    mimeTypes: ['application/msword'],
    label: 'DOC',
  },
  {
    extensions: ['.docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    label: 'DOCX',
  },
  { extensions: ['.png'], mimeTypes: ['image/png'], label: 'PNG' },
  { extensions: ['.jpg', '.jpeg'], mimeTypes: ['image/jpeg'], label: 'JPG/JPEG' },
  { extensions: ['.xls'], mimeTypes: ['application/vnd.ms-excel'], label: 'XLS' },
  {
    extensions: ['.xlsx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    label: 'XLSX',
  },
];
export const CONTRACT_ORIGINAL_ACCEPT = CONTRACT_ORIGINAL_TYPES.flatMap(
  (rule) => rule.extensions,
).join(',');
function ruleFor(fileName: string, mimeType: string): ContractOriginalTypeRule | undefined {
  const lower = fileName.toLowerCase();
  return CONTRACT_ORIGINAL_TYPES.find(
    (rule) =>
      rule.extensions.some((extension) => lower.endsWith(extension)) ||
      (!!mimeType && rule.mimeTypes.includes(mimeType)),
  );
}
/** 返回拒绝原因；null 表示可接受。不读取文件内容、不执行任何脚本。 */
export function contractOriginalError(file: {
  name: string;
  size: number;
  type: string;
}): string | null {
  if (!Number.isFinite(file.size) || file.size <= 0) return '文件为空，不能作为合同原件登记';
  if (file.size > CONTRACT_ORIGINAL_MAX_BYTES)
    return `文件超过 20MiB 上限（当前 ${(file.size / 1024 / 1024).toFixed(1)}MiB），请压缩后上传`;
  if (!ruleFor(file.name, file.type))
    return '仅接受已配置的 PDF、DOC/DOCX、PNG/JPG/JPEG、XLS/XLSX 格式';
  return null;
}
/** 登记时采用归一化 MIME；浏览器未提供时按扩展名推断，绝不猜测为可执行类型。 */
export function contractOriginalMimeType(fileName: string, mimeType: string): string {
  const rule = ruleFor(fileName, mimeType);
  if (!rule) return 'application/octet-stream';
  return rule.mimeTypes.includes(mimeType) ? mimeType : rule.mimeTypes[0];
}
/** 受限预览分类：PDF 用 iframe、图片用 img；Office 及其他一律只允许下载。 */
export function contractOriginalPreviewKind(mimeType: string): 'pdf' | 'image' | 'download' {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png' || mimeType === 'image/jpeg') return 'image';
  return 'download';
}
