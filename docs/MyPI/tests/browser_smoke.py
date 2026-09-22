"""MyPI offline prototype smoke test. Requires playwright and Chromium.

Uses page.set_content to test the actual assembled HTML bytes. The delivery
runtime blocks file:// and localhost navigation; this is not an HTTP/SSE test.
All agent responses and task events exercised here are browser-local mocks.
"""
from pathlib import Path
import json
import os
import shutil
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'evidence'
OUT.mkdir(exist_ok=True)
checks = []

def passed(name):
    checks.append({'name': name, 'status': 'PASS'})

with sync_playwright() as p:
    executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser')
    browser = p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1440,'height':1000}, device_scale_factor=1, accept_downloads=True)
    page.set_default_timeout(6000)
    errors = []
    requests = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: requests.append(r.url))
    page.set_content((ROOT/'prototype/index.html').read_text(encoding='utf-8'), wait_until='load')
    expect(page.locator('#extension-count')).to_have_text('0')
    passed('初始直接进入匿名 Mock 对话，四原生 + 零扩展')
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    box=page.locator('.composer-area').bounding_box()
    assert box['y']+box['height'] <= 1001
    passed('1440×1000 桌面无横向溢出，输入框完整可见')
    page.screenshot(path=str(OUT/'prototype-chat.png'),full_page=True, style='.toast{visibility:hidden!important}')

    def prompt(text):
        page.locator('#prompt').fill(text)
        page.locator('#send-btn').click()
    def settled():
        page.wait_for_function('!MyPIPrototype.snapshot().conversations.find(c=>c.id===MyPIPrototype.snapshot().current).mainRun')
    def admin():
        page.locator('[data-action="admin-gate"]').click()
        expect(page.locator('#modal')).to_contain_text('Mock 管理视图')
        page.locator('[data-action="enter-admin"]').click()
    def nav(name):page.locator(f'[data-action="nav-{name}"]').first.click()

    prompt('请使用搜索工具查找鉴权代码。')
    expect(page.locator('#extension-count')).to_have_text('5')
    passed('明确搜索请求在请求期间激活五个搜索工具')
    settled();expect(page.locator('#extension-count')).to_have_text('0')
    passed('搜索主请求完成后扩展工具卸载归零')
    prompt('不要使用搜索工具，直接解释这段代码。')
    expect(page.locator('#extension-count')).to_have_text('0')
    settled();passed('否定表达不激活 MyPI 工具')

    page.locator('[data-action="mode-native"]').click()
    prompt('请使用两个子代理检查项目。')
    expect(page.locator('#extension-count')).to_have_text('0')
    settled()
    assert len(page.evaluate('MyPIPrototype.snapshot().conversations[0].tasks')) == 0
    passed('原生模式忽略扩展请求，不启动子代理')
    page.locator('[data-action="mode-explicit"]').click()
    prompt('请使用两个子代理，并行检查鉴权和测试。')
    expect(page.locator('#extension-count')).to_have_text('6')
    settled()
    expect(page.locator('#extension-count')).to_have_text('0')
    assert len(page.evaluate('MyPIPrototype.snapshot().conversations[0].tasks.filter(t=>t.status==="running")')) == 2
    passed('主请求结束后扩展归零，两个独立 Mock 子任务继续')
    page.locator('[data-action="tab"][data-tab="tasks"]').click()
    page.screenshot(path=str(OUT/'prototype-parallel.png'),full_page=True, style='.toast{visibility:hidden!important}')
    prompt('继续解释这个项目的目录结构。')
    settled()
    page.wait_for_function('MyPIPrototype.snapshot().conversations[0].tasks.every(t=>t.status==="completed")')
    expect(page.locator('#thread')).to_contain_text('事件结果汇总 · tools = []')
    passed('子任务并行时主会话可接受新请求，结果按来源 Run 汇总')
    page.locator('[data-action="tab"][data-tab="trace"]').click()
    expect(page.locator('#extension-count')).to_have_text('0')
    passed('子结果回传不会重新开启扩展工具')

    prompt('请在后台运行开发服务。')
    settled()
    page.locator('[data-action="tab"][data-tab="tasks"]').click()
    last_task=page.locator('.task-card').last
    last_task.locator('[data-action="cancel-task"]').click()
    expect(last_task).to_contain_text('已取消')
    passed('后台进程演示可在主请求结束后独立取消')
    prompt('请使用任务管理工具创建待办清单。')
    settled()
    expect(page.locator('.work-item')).to_have_count(3)
    page.locator('[data-action="toggle-item"]').first.click()
    assert page.evaluate('MyPIPrototype.snapshot().conversations[0].workItems[0].done') is True
    passed('会话工作项单独创建与勾选，不混同子任务')

    page.locator('[data-action="tab"][data-tab="files"]').click()
    page.locator('.file-row[data-file="src/auth.ts"]').click()
    expect(page.locator('#modal')).to_contain_text('validateLogin')
    with page.expect_download() as d:
        page.locator('[data-action="download-file"]').click()
    assert d.value.suggested_filename == 'auth.ts'
    page.locator('[data-action="close-modal"]').click()
    passed('示例文件预览与 Blob 文件导出')

    admin();page.screenshot(path=str(OUT/'prototype-admin.png'),full_page=True, style='.toast{visibility:hidden!important}')
    passed('后台入口明确展示非真实认证提示')
    nav('models')
    page.locator('[data-action="add-model"]').click()
    page.locator('#model-name').fill('Demo Test')
    page.locator('#model-identifier').fill('demo-test-v1')
    page.locator('button[form="model-form"]').click()
    expect(page.locator('tbody')).to_contain_text('Demo Test')
    passed('添加模型并呈现管理列表')
    model_row=page.locator('tr').filter(has_text='Demo Test')
    model_row.locator('[data-action="test-model"]').click()
    expect(model_row).to_contain_text('模拟通过')
    passed('模型模拟测试完成，明确不调用真实接口')
    model_row.locator('[data-action="toggle-model"]').click()
    expect(model_row).to_contain_text('已停用')
    passed('模型启用状态可修改')

    nav('policies');page.screenshot(path=str(OUT/'prototype-policy.png'),full_page=True, style='.toast{visibility:hidden!important}')
    for name in ['negative','conditional','quote']:
        page.locator(f'[data-action="rule-sample"][data-key="{name}"]').click()
        expect(page.locator('#rule-result')).to_contain_text('不激活扩展工具')
    passed('规则测试台拒绝否定、条件与引用表达')
    page.locator('[data-action="rule-sample"][data-key="positive"]').click()
    expect(page.locator('#rule-result')).to_contain_text('命中 搜索')
    page.locator('#rule-source').select_option('subtask')
    page.locator('[data-action="test-rule"]').click()
    expect(page.locator('#rule-result')).to_contain_text('UNTRUSTED_SOURCE')
    passed('规则测试台隔离子任务来源，不能因文本授权')
    page.locator('input[name="allowed"][value="search"]').uncheck()
    page.locator('form[data-form="policy"] button[type="submit"]').click()
    page.locator('[data-action="chat"]').click()
    page.locator('[data-action="tab"][data-tab="trace"]').click()
    prompt('请使用搜索工具查找文件。')
    expect(page.locator('#extension-count')).to_have_text('0')
    settled();expect(page.locator('#thread')).to_contain_text('该能力被管理员策略禁用')
    passed('管理员能力策略与聊天工具预览联动')

    admin();nav('visitors')
    page.locator('[data-action="toggle-visitor"][data-id="guest_a7f2"]').click()
    page.locator('[data-action="chat"]').click()
    used=page.evaluate('MyPIPrototype.snapshot().guest.used')
    prompt('请解释项目。')
    expect(page.locator('#toast')).to_contain_text('已封禁')
    assert page.evaluate('MyPIPrototype.snapshot().guest.used')==used
    passed('封禁当前游客后拒绝新请求且不扣额度')
    admin();nav('visitors');page.locator('[data-action="toggle-visitor"][data-id="guest_a7f2"]').click()
    nav('overview');page.locator('[data-action="pause"]').click();page.locator('[data-action="confirm-pause"]').click()
    page.locator('[data-action="chat"]').click()
    prompt('请解释项目。')
    expect(page.locator('#toast')).to_contain_text('已暂停')
    passed('暂停公开体验后聊天拒绝请求')
    admin();page.locator('[data-action="pause"]').click()
    nav('audit');expect(page.locator('tbody')).to_contain_text('site.paused')
    expect(page.locator('tbody')).to_contain_text('guest.suspended')
    passed('管理员动作形成可查看的本地审计记录')
    page.locator('[data-action="chat"]').click()

    # XSS is tested as text rendering, not a security certification.
    page.locator('[data-action="new-chat"]').click()
    prompt('<img src=x onerror="window.__xss=true"> 请解释代码。')
    settled();assert page.evaluate('window.__xss === undefined')
    expect(page.locator('#thread')).to_contain_text('<img src=x')
    passed('用户文本以转义文本呈现，没有执行样例 HTML')
    page.locator('[data-action="new-chat"]').click()
    page.set_viewport_size({'width':390,'height':844})
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    box=page.locator('.composer-area').bounding_box()
    assert box['y']+box['height'] <= 845
    page.screenshot(path=str(OUT/'prototype-mobile.png'),full_page=True, style='.toast{visibility:hidden!important}')
    passed('390×844 移动端无横向溢出，输入框完整可见')
    page.locator('[data-action="mobile"][aria-label="打开导航"]').click()
    expect(page.locator('.sidebar.open')).to_be_visible()
    page.locator('[data-action="mobile"][aria-label="关闭导航"]').click()
    passed('移动端抽屉导航可以打开关闭')
    page.locator('[data-action="inspect"][aria-label="打开执行面板"]').click()
    expect(page.locator('.inspector.open')).to_be_visible()
    page.locator('[data-action="inspect"][aria-label="关闭执行面板"]').click()
    passed('移动端执行面板可展开与关闭')
    assert not errors, errors
    assert not requests, requests
    passed('本次场景无未捕获页面异常、无外部网络请求')
    report={'scope':'Offline prototype UI only. NOT backend/SDK/security verification.', 'loadMethod':'page.set_content assembled index.html; runtime blocks file and localhost navigation', 'browser':browser.version,'passed':len(checks),'failed':0,'checks':checks,'pageErrors':errors,'networkRequests':requests}
    (OUT/'browser-smoke.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'passed':len(checks),'failed':0,'browser':browser.version},ensure_ascii=False))
    browser.close()
