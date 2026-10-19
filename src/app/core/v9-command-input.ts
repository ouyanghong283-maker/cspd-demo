import type { JsonValue } from './v9-contracts';

/** 规范化JSON对象键；拒绝不能持久化的值，数组顺序保持业务含义。 */
export function commandInputFingerprint(input: JsonValue): string {
  const normalize = (value: JsonValue): JsonValue => {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(normalize);
    if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, normalize(value[key])]),
      );
    throw new Error('命令输入必须是可持久化JSON；文件字节由文件设施核验');
  };
  return JSON.stringify(normalize(input));
}
