"""Structural OpenAPI/JSON Schema and SQLite constraint checks, not a backend test.
Dependencies: PyYAML, jsonschema. No network access required.
"""
from pathlib import Path
import json, re, sqlite3
import yaml
from jsonschema import Draft202012Validator, FormatChecker, ValidationError
ROOT=Path(__file__).resolve().parents[1]
api=yaml.safe_load((ROOT/'contracts/openapi.yaml').read_text(encoding='utf-8'))
checks=[]
def passed(name):checks.append(name)
refs=[]
def walk(value):
    if isinstance(value,dict):
        if '$ref' in value:
            ref=value['$ref'];assert ref.startswith('#/'),ref
            target=api
            for component in ref[2:].split('/'):
                target=target[component.replace('~1','/').replace('~0','~')]
            refs.append(ref)
        for v in value.values():walk(v)
    elif isinstance(value,list):
        for v in value:walk(v)
walk(api);passed('All internal OpenAPI references resolve')
operations=[]
for path,methods in api['paths'].items():
    for method,op in methods.items():
        if method not in ['get','post','put','patch','delete']:continue
        operations.append(op['operationId'])
        declared={p['name'] for p in op.get('parameters',[]) if p.get('in')=='path'}
        assert set(re.findall(r'{([^}]+)}',path))<=declared,(path,declared)
        assert op.get('responses')
assert len(operations)==len(set(operations));passed('Operation IDs unique; all path variables declared')
for name,schema in api['components']['schemas'].items():Draft202012Validator.check_schema(schema)
passed('All component schemas satisfy JSON Schema 2020-12 syntax')
schema={'$ref':'#/components/schemas/RunCreate','components':api['components']}
v=Draft202012Validator(schema,format_checker=FormatChecker())
good={'text':'请使用搜索工具查找代码。','mode':'explicit','modelId':'00000000-0000-4000-8000-000000000003'}
v.validate(good);passed('RunCreate accepts a valid typed request')
for bad in [dict(good,source='human'),dict(good,role='system'),dict(good,grants=['search']),dict(good,tools=['bash']),dict(good,mode='adaptive')]:
    try:v.validate(bad)
    except ValidationError:continue
    raise AssertionError(f'Privileged input unexpectedly accepted: {bad}')
passed('RunCreate rejects role/source/grants/tools and unsupported adaptive mode')
conn=sqlite3.connect(':memory:');conn.executescript((ROOT/'contracts/schema.sql').read_text(encoding='utf-8'))
assert conn.execute('pragma foreign_keys').fetchone()[0]==1
assert conn.execute('pragma integrity_check').fetchone()[0]=='ok'
passed('SQLite schema creates and integrity check passes')
now='2026-09-22T09:00:00Z'
for id,kind in [('admin','admin'),('a','guest'),('b','guest')]:conn.execute('insert into principal(id,kind,display_id,created_at,last_seen_at) values(?,?,?,?,?)',(id,kind,id,now,now))
conn.execute('insert into policy_version values(?,?,?, ?,?)',(1,'{}','admin',now,'test fixture'))
for owner in ['a','b']:
 conn.execute('insert into workspace(id,principal_id,storage_key,revision,template_id,status,expires_at,created_at) values(?,?,?,?,?,?,?,?)',(f'w{owner}',owner,f'store/{owner}','r1','ts-demo','ready',now,now))
 conn.execute('insert into conversation(id,principal_id,workspace_id,title,mode,created_at,updated_at) values(?,?,?,?,?,?,?)',(f'c{owner}',owner,f'w{owner}','test','explicit',now,now))
 conn.execute('insert into run(id,conversation_id,principal_id,input_id,source,original_text,idempotency_key,request_hash,mode_snapshot,rule_version,policy_version,status,deadline,created_at,budget_root_run_id) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(f'r{owner}',f'c{owner}',owner,f'i{owner}','human','test',f'k{owner}','hash','explicit','v1',1,'running',now,now,f'r{owner}'))
 conn.execute('insert into agent_task(id,principal_id,origin_run_id,title,role,status,grant_json,deadline,created_at) values(?,?,?,?,?,?,?,?,?)',(f't{owner}',owner,f'r{owner}','test','reviewer','running','{}',now,now))
passed('Two independent owner fixtures and self-rooted Runs can be inserted')
def rejected(sql,args):
 conn.execute('savepoint neg')
 try:
  conn.execute(sql,args)
 except sqlite3.IntegrityError:
  conn.execute('rollback to neg');conn.execute('release neg');return
 conn.execute('rollback to neg');conn.execute('release neg')
 raise AssertionError('Expected SQLite constraint rejection')
rejected('insert into conversation(id,principal_id,workspace_id,title,mode,created_at,updated_at) values(?,?,?,?,?,?,?)',('cross','a','wb','x','explicit',now,now))
passed('Conversation cannot refer to another owner workspace')
rejected('update run set budget_root_run_id=? where id=?',('rb','ra'))
passed('A Run cannot attach to another owner budget root')
rejected('update agent_task set parent_task_id=? where id=?',('tb','ta'))
passed('Task parent must have the same owner')
rejected('insert into background_process(id,root_run_id,principal_id,conversation_id,sandbox_lease_id,status,process_ref,deadline,created_at) values(?,?,?,?,?,?,?,?,?)',('proc','rb','a','ca','lease','running','p',now,now))
passed('Background resource cannot be bound to another owner root Run')
rejected('update run set source=? where id=?',('task_result','ra'))
passed('Internal result Run requires an origin reference')
assert conn.execute('pragma foreign_key_check').fetchall()==[]
passed('Foreign-key check remains clean after fixtures and negative cases')
report={'scope':'Structural checks only; not full OpenAPI spec validator or implemented API behavior.','checksPassed':len(checks),'checks':checks,'paths':len(api['paths']),'operations':len(operations),'schemas':len(api['components']['schemas']),'resolvedReferenceOccurrences':len(refs),'sqliteTables':conn.execute("select count(*) from sqlite_master where type='table'").fetchone()[0],'sqliteVersion':sqlite3.sqlite_version}
(ROOT/'evidence/contracts-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
