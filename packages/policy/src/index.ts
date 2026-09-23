import {
  AppError,
  defaultPolicy,
  type CapabilityGroup,
  type IntentDecision,
  type Mode,
  type Policy,
} from '../../contracts/src/index.ts';
import { defaultRuleConfig, type ActiveRules } from './rule-config.ts';
export {
  defaultRuleConfig,
  validateRuleConfig,
  ruleConfigSchema,
  readActiveRules,
  RULE_GROUPS,
  type RuleConfig,
  type ActiveRules,
} from './rule-config.ts';
export { defaultPolicy };
export const BASE_TOOLS = ['read', 'write', 'edit', 'bash'];
export const GROUPS: Record<
  CapabilityGroup,
  { label: string; entry: string[]; deferred: string[] }
> = {
  search: {
    label: '搜索',
    entry: [
      'mypi_search_files',
      'mypi_search_content',
      'mypi_git_show',
      'mypi_git_diff',
      'mypi_git_log',
    ],
    deferred: [],
  },
  delegate: {
    label: '子代理',
    entry: [
      'mypi_subagent_spawn',
      'mypi_subagent_check',
      'mypi_subagent_list',
      'mypi_subagent_wait',
      'mypi_subagent_send',
      'mypi_subagent_cancel',
    ],
    deferred: [],
  },
  workflow: {
    label: '工作流',
    entry: ['mypi_workflow_run', 'mypi_workflow_status', 'mypi_workflow_cancel'],
    deferred: [],
  },
  background: {
    label: '后台进程',
    entry: ['mypi_bg_start'],
    deferred: ['mypi_bg_status', 'mypi_bg_list', 'mypi_bg_watch', 'mypi_bg_stop'],
  },
  session: {
    label: '工作项与目标',
    entry: ['mypi_tasks_add', 'mypi_goal_create'],
    deferred: ['mypi_tasks_update', 'mypi_tasks_list', 'mypi_goal_get', 'mypi_goal_update'],
  },
};
const patterns: Record<CapabilityGroup, RegExp> = {
  search:
    /(?:使用|调用|启用|用)\s*(?:搜索工具|文件搜索|内容搜索|检索工具|搜索能力|fd\b|rg\b|git\s+(?:diff|show|log)\b)|\buse\s+(?:the\s+)?(?:search(?:\s+tools?)?|file\s+search|fd\b|rg\b|git\s+(?:diff|show|log)\b)/i,
  delegate:
    /(?:使用|调用|启用|用)\s*(?:(?:两个|多个|2个)\s*)?(?:子代理|子智能体|subagents?\b)|\b(?:use|spawn|launch)\s+(?:(?:two|multiple|a|the|2)\s+)?subagents?\b/i,
  workflow:
    /(?:使用|调用|启动|执行|用)\s*(?:工作流|workflows?\b)|\b(?:use|run|start)\s+(?:a\s+|the\s+)?workflows?\b/i,
  background:
    /在后台(?:运行|启动|执行)|(?:使用|调用|启用|用)\s*后台(?:工具|进程|终端)|\b(?:run|start|launch)\b.{0,80}\bin\s+the\s+background\b|\buse\s+(?:the\s+)?background\s+(?:tools?|terminal)\b/i,
  session:
    /(?:使用|调用|启用|用)\s*(?:任务管理(?:工具)?|会话管理(?:工具)?|目标管理(?:工具)?)|(?:创建|建立|记录)\s*(?:待办清单|任务清单|会话目标)|\buse\s+(?:the\s+)?(?:task|goal|session)\s+(?:management\s+)?tools?\b/i,
};
const negative =
  /避免|拒绝|没有必要|没有(?:说|要求|打算)|不再|(?:停止|取消|暂停)\s*(?:使用|调用|启用|执行|启动|在后台|运行)|不要|不用|不需要|不必|无需|禁止|不允许|不使用|不调用|不启用|不运行|不执行|不能|不得|不可|请勿|切勿|勿用|不希望|不愿|别再|别用|别使用|不想|不打算|不是让|\b(?:not|never|don['’]t|mustn['’]t|shouldn['’]t|no|without|do\s+not|avoid|refrain)\b/i;
const conditional =
  /如果|假如|假设|除非|否则|倘若|若|仅当|只有|只在|等到|必要时|需要时|以后|稍后|到时候|将来|可能|\b(?:if|unless|when|whenever|provided|would|could|might|later)\b/i;
const discussion =
  /是什么|有什么|什么是|怎么|如何|解释|介绍|区别|能否|是否|讨论|\b(?:what|how|explain|discuss|can\s+(?:you|we|i)|should)\b/i;
const foldAscii = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
export function matchIntent(
  text: string,
  mode: Mode = 'explicit',
  source = 'human',
  rules: ActiveRules = { version: 'explicit-v1', config: defaultRuleConfig() },
): IntentDecision {
  const result: IntentDecision = {
    groups: [],
    evidence: [],
    reasons: [],
    reasonCode: 'NO_GRANT',
    ruleVersion: rules.version,
  };
  const reject = (code: string, reason: string) => ({
    ...result,
    reasonCode: code,
    reasons: [reason],
  });
  if (source !== 'human') return reject('UNTRUSTED_SOURCE', '仅真实用户输入可以授权');
  if (mode === 'native') return reject('NATIVE_MODE', '原生模式固定四个基础工具');
  if (mode !== 'explicit') return reject('INVALID_MODE', '未知模式');
  if (new TextEncoder().encode(text).length > 16384)
    return reject('INPUT_LIMIT', '输入超过 16 KiB');
  let normalized = '';
  const starts: number[] = [],
    ends: number[] = [];
  // Retain original UTF-16 spans, including compatibility characters and zero-width removal.
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const n = ch.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '');
    for (let j = 0; j < n.length; j++) {
      starts.push(i);
      ends.push(i + ch.length);
    }
    normalized += n;
    i += ch.length;
  }
  const chars = normalized.split('');
  const mask = (a: number, b: number) => {
    for (let i = a; i < b; i++) chars[i] = ' ';
  };
  let quoted = false;
  for (let i = 0; i < normalized.length; ) {
    if (normalized.startsWith('```', i) || normalized.startsWith('~~~', i)) {
      const mark = normalized.slice(i, i + 3),
        end = normalized.indexOf(mark, i + 3);
      if (end < 0) {
        quoted = true;
        break;
      }
      mask(i, end + 3);
      i = end + 3;
      continue;
    }
    const pairs: Record<string, string> = {
      '“': '”',
      '‘': '’',
      '«': '»',
      '‹': '›',
      '「': '」',
      '『': '』',
      '"': '"',
      '`': '`',
      "'": "'",
    };
    const close = pairs[normalized[i]];
    if (
      close &&
      !(
        normalized[i] === "'" &&
        /\w/.test(normalized[i - 1] ?? '') &&
        /\w/.test(normalized[i + 1] ?? '')
      )
    ) {
      const end = normalized.indexOf(close, i + 1);
      if (end < 0) {
        quoted = true;
        break;
      }
      mask(i, end + 1);
      i = end + 1;
      continue;
    }
    i++;
  }
  if (quoted) return reject('UNCLOSED_QUOTE', '引用未闭合，保守拒绝');
  const masked = chars.join('').replace(/^\s*>[^\n]*/gm, (m) => ' '.repeat(m.length));
  for (const clauseMatch of masked.matchAll(/[^。！？!?；;\n]+[。！？!?；;]?/g)) {
    const clause = clauseMatch[0];
    let reason = '';
    if (negative.test(clause)) reason = '否定或冲突表达：该句不授权';
    else if (conditional.test(clause)) reason = '条件或未来表达：该句不授权';
    else if (/[？?]$/.test(clause) || discussion.test(clause))
      reason = '疑问或能力讨论：该句不授权';
    if (reason) {
      result.reasons.push(reason);
      continue;
    }
    for (const group of Object.keys(GROUPS) as CapabilityGroup[]) {
      const config = rules.config.groups[group];
      if (!config.enabled) continue;
      const canonical = patterns[group].exec(clause);
      let hit = canonical
        ? { index: canonical.index, text: canonical[0], kind: 'canonical' }
        : undefined;
      for (const phrase of config.phrases) {
        const index = foldAscii(clause).indexOf(foldAscii(phrase));
        if (index >= 0 && (!hit || index < hit.index))
          hit = { index, text: clause.slice(index, index + phrase.length), kind: 'literal' };
      }
      if (!hit) continue;
      const pos = clauseMatch.index! + hit.index;
      const start = starts[pos],
        end = ends[pos + hit.text.length - 1];
      if (!result.groups.includes(group)) result.groups.push(group);
      result.evidence.push({
        group,
        start,
        end,
        text: text.slice(start, end),
        ruleId: `${rules.version}.${group}.${hit.kind}`,
      });
    }
  }
  result.groups = (Object.keys(GROUPS) as CapabilityGroup[]).filter((g) =>
    result.groups.includes(g),
  );
  result.reasons = [...new Set(result.reasons)];
  if (result.groups.length) {
    result.reasonCode = 'EXPLICIT_MATCH';
    result.reasons.unshift('明确请求：' + result.groups.map((g) => GROUPS[g].label).join('、'));
  } else if (!result.reasons.length) result.reasons.push('未发现明确执行短语，保持 0 个扩展工具');
  return result;
}
export function activeTools(
  groups: CapabilityGroup[],
  resources: Partial<Record<CapabilityGroup, boolean>> = {},
) {
  return [
    ...BASE_TOOLS,
    ...(Object.keys(GROUPS) as CapabilityGroup[])
      .filter((g) => groups.includes(g))
      .flatMap((g) => [...GROUPS[g].entry, ...(resources[g] ? GROUPS[g].deferred : [])]),
  ];
}
export function validatePolicy(value: Partial<Policy>): Policy {
  const p = { ...defaultPolicy, ...value };
  for (const k of [
    'dailyRootRuns',
    'dailyTokens',
    'maxModelCalls',
    'runTimeoutMs',
    'maxConcurrentModels',
    'maxUserConcurrentModels',
    'maxChildren',
    'processTtlSeconds',
  ] as const)
    if (!Number.isSafeInteger(p[k]) || p[k] < 1)
      throw new AppError('INVALID_POLICY', `${k} 必须为正整数`);
  if (
    p.maxChildren > 2 ||
    p.maxModelCalls > 100 ||
    p.processTtlSeconds > 600 ||
    p.runTimeoutMs > 240000
  )
    throw new AppError('INVALID_POLICY', '策略超过部署硬上限');
  return p;
}
