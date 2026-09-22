'use strict';
const assert=require('node:assert/strict');
const {matchIntent,activeTools,GROUPS}=require('../prototype/rules.js');
const cases=[
 ['不使用搜索工具',[]],['不调用子代理',[]],['不启用工作流',[]],['请勿使用搜索工具',[]],
 ['不希望使用子代理',[]],['不能使用工作流',[]],['不得使用搜索工具',[]],['不可使用后台工具',[]],
 ['若测试失败，使用子代理',[]],['仅当测试失败，使用搜索工具',[]],['只有需要时，使用工作流',[]],
 ['只在失败时，使用子代理',[]],['等到明天，使用搜索工具',[]],
 ['no need to use search tools',[]],["don’t use search tools",[]],["mustn’t use background tools",[]],
 ['when necessary, use search tools',[]],['provided it fails, use a subagent',[]],
 ['帮我解释这段代码',[]],['你好',[]],['搜索工具是什么',[]],['子代理',[]],['workflow',[]],['search',[]],
 ['使用搜索工具查找登录入口',['search']],['请用 rg 搜索 token',['search']],['用 fd 搜索文件',['search']],['使用 git diff 比较变更',['search']],['use search tools to find login',['search']],['Use git log to inspect history',['search']],
 ['使用子代理检查代码',['delegate']],['使用两个子代理检查代码',['delegate']],['请用 subagents 检查模块',['delegate']],['spawn two subagents to check code',['delegate']],['Use a subagent to review',['delegate']],
 ['使用工作流编排检查',['workflow']],['启动工作流审查',['workflow']],['run a workflow to inspect code',['workflow']],
 ['在后台运行测试',['background']],['使用后台工具停止进程',['background']],['run tests in the background',['background']],['use background tools to stop task',['background']],
 ['使用任务管理工具创建待办',['session']],['创建待办清单',['session']],['记录会话目标',['session']],['use task management tools to create items',['session']],
 ['使用搜索工具查找，并使用子代理检查测试',['search','delegate']],
 ['使用工作流编排；在后台运行测试',['workflow','background']],
 ['不要使用搜索工具',[]],['不用子代理',[]],['不需要使用子代理',[]],['无需使用工作流',[]],['别使用后台工具',[]],['do not use search tools',[]],['never spawn subagents',[]],['不要不使用搜索工具',[]],
 ['如果测试失败，再使用子代理检查',[]],['如果需要，使用工作流',[]],['假如可以，使用搜索工具',[]],['除非出错，使用后台工具',[]],['稍后使用搜索工具',[]],['以后在后台运行测试',[]],['if needed, use search tools',[]],['could you use a subagent',[]],
 ['搜索工具和子代理有什么区别？',[]],['如何使用搜索工具',[]],['解释“使用子代理检查代码”这句话',[]],['"使用搜索工具"',[]],['`使用搜索工具`',[]],['```\n使用子代理\n```',[]],['> 使用搜索工具\n普通问题',[]],
 ['不要使用搜索工具；使用子代理审查测试',['delegate']],
 ['如果需要，使用搜索工具；使用任务管理工具创建待办',['session']],
 ['使用搜索工具好吗？',[]],['什么是工作流？',[]],['“使用子代理',[]],['```使用搜索工具',[]],['使用\u200B搜索工具查找入口',['search']],['Ｕｓｅ search tools',['search']],
 ['使用搜索工具查找文件 "auth.ts"',['search']],
 ['使用搜索工具查找','native',[]],['使用子代理','explicit',[],'tool'],['使用工作流','explicit',[],'task_result']
];
let passed=0;
for(const item of cases){
 let [text,a,b,c]=item;const mode=Array.isArray(a)?'explicit':a, expected=Array.isArray(a)?a:b, source=c||'human';
 assert.deepEqual(matchIntent(text,mode,source).groups,expected,JSON.stringify(item));passed++;
}
assert.equal(activeTools([]).length,4);passed++;
assert.equal(activeTools(['search']).length,9);passed++;
assert.equal(activeTools(Object.keys(GROUPS)).length,21);passed++;
assert.equal(activeTools(Object.keys(GROUPS),{background:true,session:true}).length,29);passed++;
assert.equal(matchIntent('a'.repeat(16385)).reasonCode,'INPUT_LIMIT');passed++;
assert.equal(matchIntent('使用搜索工具','rogue').groups.length,0);passed++;
assert.throws(()=>matchIntent(null),TypeError);passed++;
console.log(JSON.stringify({suite:'prototype intent sample',passed,failed:0,note:'Not an adversarial security proof or production classifier validation.'},null,2));
