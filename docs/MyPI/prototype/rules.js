/* MyPI explicit intent demo. Pure deterministic sample, NOT a security boundary.
 * Production must authenticate input provenance and implement source-span mapping.
 * No model calls, no tool execution, no third-party dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MyPIRules = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const BASE = ['read', 'write', 'edit', 'bash'];
  const GROUPS = {
    search: {label:'搜索', icon:'search', description:'文件、内容与只读 Git', entry:['mypi_search_files','mypi_search_content','mypi_git_show','mypi_git_diff','mypi_git_log'], deferred:[]},
    delegate: {label:'子代理', icon:'branch', description:'独立上下文，事件回传', entry:['mypi_subagent_spawn','mypi_subagent_check','mypi_subagent_list','mypi_subagent_wait','mypi_subagent_send','mypi_subagent_cancel'], deferred:[]},
    workflow: {label:'工作流', icon:'workflow', description:'有界多阶段任务编排', entry:['mypi_workflow_run','mypi_workflow_status','mypi_workflow_cancel'], deferred:[]},
    background: {label:'后台进程', icon:'terminal', description:'长期进程与有界日志', entry:['mypi_bg_start'], deferred:['mypi_bg_status','mypi_bg_list','mypi_bg_watch','mypi_bg_stop']},
    session: {label:'会话任务', icon:'list', description:'工作项与目标记录', entry:['mypi_tasks_add','mypi_goal_create'], deferred:['mypi_tasks_update','mypi_tasks_list','mypi_goal_get','mypi_goal_update']}
  };
  const patterns = {
    search: [/(?:使用|调用|启用|用)\s*(?:搜索工具|文件搜索|内容搜索|检索工具|搜索能力|fd\b|rg\b|git\s+(?:diff|show|log)\b)/i, /\buse\s+(?:the\s+)?(?:search(?:\s+tools?)?|file\s+search|fd\b|rg\b|git\s+(?:diff|show|log)\b)/i],
    delegate: [/(?:使用|调用|启用|用)\s*(?:(?:两个|多个|2个)\s*)?(?:子代理|子智能体|subagents?\b)/i, /\b(?:use|spawn|launch)\s+(?:(?:two|multiple|a|the|2)\s+)?subagents?\b/i],
    workflow: [/(?:使用|调用|启动|执行|用)\s*(?:工作流|workflows?\b)/i, /\b(?:use|run|start)\s+(?:a\s+|the\s+)?workflows?\b/i],
    background: [/(?:在后台(?:运行|启动|执行)|(?:使用|调用|启用|用)\s*后台(?:工具|进程|终端))/, /\b(?:run|start|launch)\b.{0,80}\bin\s+the\s+background\b/i, /\buse\s+(?:the\s+)?background\s+(?:tools?|terminal)\b/i],
    session: [/(?:使用|调用|启用|用)\s*(?:任务管理(?:工具)?|会话管理(?:工具)?|目标管理(?:工具)?)/, /(?:创建|建立|记录)\s*(?:待办清单|任务清单|会话目标)/, /\buse\s+(?:the\s+)?(?:task|goal|session)\s+(?:management\s+)?tools?\b/i]
  };
  const negative = /不要|不用|不需要|不必|无需|禁止|不允许|不使用|不调用|不启用|不运行|不执行|不能|不得|不可|请勿|切勿|勿用|不希望|不愿|别再|别用|别使用|不想|不打算|不是让|\b(?:not|never|don['’]t|mustn['’]t|shouldn['’]t|no|without|do\s+not|avoid|refrain)\b/i;
  const conditional = /如果|假如|假设|除非|否则|倘若|若|仅当|只有|只在|等到|必要时|需要时|以后|稍后|到时候|将来|可能|\b(?:if|unless|when|whenever|provided|would|could|might|later)\b/i;
  const discussion = /是什么|有什么|什么是|怎么|如何|解释|介绍|区别|能否|是否|讨论|\b(?:what|how|explain|discuss|can\s+(?:you|we|i)|should)\b/i;
  const order = Object.keys(GROUPS);
  function matchIntent(text, mode='explicit', source='human') {
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    const empty=(reason,code)=>({groups:[], evidence:[], reasons:[reason], reasonCode:code, ruleVersion:'prototype-explicit-v1'});
    if (source !== 'human') return empty('非真实用户输入不产生工具授权','UNTRUSTED_SOURCE');
    if (!['native','explicit'].includes(mode)) return empty('未知模式，拒绝激活','INVALID_MODE');
    if (mode === 'native') return empty('原生模式固定四个基础工具','NATIVE_MODE');
    if (new TextEncoder().encode(text).length > 16384) return empty('输入超过 16 KiB，拒绝匹配','INPUT_LIMIT');
    if (!text.trim()) return empty('等待输入明确的能力请求','EMPTY_INPUT');
    let normalized=text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'');
    if ((normalized.match(/```/g)||[]).length % 2) return empty('代码引用未闭合，保守拒绝','UNCLOSED_QUOTE');
    normalized=normalized.replace(/```[\s\S]*?```/g,' ').replace(/^\s*>.*$/gm,' ');
    const pairs=[['“','”'],['「','」'],['『','』']];
    for(const [a,b] of pairs) if((normalized.split(a).length-1)!==(normalized.split(b).length-1)) return empty('引用未闭合，保守拒绝','UNCLOSED_QUOTE');
    if ((normalized.match(/"/g)||[]).length%2 || (normalized.match(/`/g)||[]).length%2) return empty('引用未闭合，保守拒绝','UNCLOSED_QUOTE');
    normalized=normalized.replace(/`[^`]*`/g,' ').replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"|'[^'\n]*'/g,' ');
    const clauses=normalized.match(/[^。！？!?；;\n]+[。！？!?；;]?/g)||[];
    const found=new Set(), evidence=[], reasons=[];
    for (const raw of clauses) {
      const clause=raw.trim(); if(!clause) continue;
      if(negative.test(clause)){reasons.push('否定或冲突表达：该句不授权');continue;}
      if(conditional.test(clause)){reasons.push('条件或未来表达：该句不授权');continue;}
      if(/[？?]$/.test(clause)||discussion.test(clause)){reasons.push('疑问或能力讨论：该句不授权');continue;}
      for(const group of order){
        const match=patterns[group].map(p=>clause.match(p)).find(Boolean);
        if(match){found.add(group);evidence.push({group,text:match[0],ruleId:`explicit.${group}.v1`});}
      }
    }
    const groups=order.filter(x=>found.has(x));
    if(groups.length) reasons.unshift('明确执行请求：'+groups.map(x=>GROUPS[x].label).join('、'));
    else if(!reasons.length) reasons.push('未发现明确执行短语，保持 0 个 MyPI 工具');
    return {groups,evidence,reasons:[...new Set(reasons)],reasonCode:groups.length?'EXPLICIT_MATCH':'NO_GRANT',ruleVersion:'prototype-explicit-v1'};
  }
  function activeTools(groups,resources={}) {
    const names=[...BASE];
    for(const group of order) if(groups.includes(group)){
      names.push(...GROUPS[group].entry);
      if(resources[group]) names.push(...GROUPS[group].deferred);
    }
    return [...new Set(names)];
  }
  return {BASE,GROUPS,matchIntent,activeTools};
});
