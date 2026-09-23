import { z } from 'zod';
import { AppError, type CapabilityGroup } from '../../contracts/src/index.ts';

export const RULE_GROUPS: CapabilityGroup[] = [
  'search',
  'delegate',
  'workflow',
  'background',
  'session',
];
export interface RuleConfig {
  groups: Record<CapabilityGroup, { enabled: boolean; phrases: string[] }>;
}
export interface ActiveRules {
  version: string;
  config: RuleConfig;
}
const phrase = z
  .string()
  .min(4)
  .max(80)
  .refine((value) => {
    const normalized = value.normalize('NFKC');
    return (
      value === normalized.trim() &&
      /^[\p{L}\p{N} _-]+$/u.test(value) &&
      /^(?:(?:使用|调用|启用|运行|启动|执行|创建|建立|记录|用)\s*[\p{L}\p{N}][\p{L}\p{N} _-]+|(?:use|run|start|spawn|launch)\s+[\p{L}\p{N}][\p{L}\p{N} _-]+)$/iu.test(
        value,
      )
    );
  }, '短语必须是动作词加词组；只允许文字、数字、空格、下划线和连字符');
const group = z.strictObject({
  enabled: z.boolean(),
  phrases: z
    .array(phrase)
    .max(12)
    .refine(
      (values) => new Set(values.map((value) => value.toLowerCase())).size === values.length,
      '短语不能重复',
    ),
});
export const ruleConfigSchema = z.strictObject({
  groups: z.strictObject({
    search: group,
    delegate: group,
    workflow: group,
    background: group,
    session: group,
  }),
});
export const defaultRuleConfig = (): RuleConfig => ({
  groups: {
    search: { enabled: true, phrases: [] },
    delegate: { enabled: true, phrases: [] },
    workflow: { enabled: true, phrases: [] },
    background: { enabled: true, phrases: [] },
    session: { enabled: true, phrases: [] },
  },
});
export function validateRuleConfig(input: unknown): RuleConfig {
  const result = ruleConfigSchema.safeParse(input);
  if (!result.success)
    throw new AppError(
      'INVALID_RULE_CONFIG',
      '规则仅支持每组开关和最多12条动作字面短语（4–80字符），不接受正则或脚本',
      400,
    );
  return result.data;
}
/** Immutable published versions are shared by Gateway and Core through their store adapters. */
export function readActiveRules(store: {
  get<T>(kind: string, id: string): T | undefined;
}): ActiveRules {
  const active = store.get<{ versionId: string }>('ruleActive', 'current');
  if (!active) return { version: 'explicit-v1', config: defaultRuleConfig() };
  const version = store.get<{ config: RuleConfig }>('ruleVersion', active.versionId);
  if (!version) throw new AppError('RULE_CONFIG_UNAVAILABLE', '当前规则版本不可用', 503);
  return { version: active.versionId, config: validateRuleConfig(version.config) };
}
