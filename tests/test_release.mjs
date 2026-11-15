import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {parse} from 'acorn';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const manifest=JSON.parse(read('data/master-version.json'));
const snapshot=JSON.parse(read('data/cases.json'));

function literal(node) {
  if(node.type==='Literal')return node.value;
  if(node.type==='TemplateLiteral'&&!node.expressions.length)return node.quasis[0].value.cooked;
  if(node.type==='ArrayExpression')return node.elements.map(literal);
  if(node.type==='ObjectExpression')return Object.fromEntries(node.properties.map(p=>[p.key.name??p.key.value,literal(p.value)]));
  if(node.type==='UnaryExpression'&&node.operator==='!')return !literal(node.argument);
  throw new Error('Nonliteral master case field: '+node.type);
}
function casesFromJS(source) {
  const stack=[parse(source,{ecmaVersion:'latest',sourceType:'module'})];
  while(stack.length) {
    const n=stack.pop();
    if(n.type==='VariableDeclarator'&&n.id.name==='ad'&&n.init?.type==='ArrayExpression')return literal(n.init);
    for(const v of Object.values(n)) {
      if(Array.isArray(v)){for(const x of v)if(x?.type)stack.push(x);}
      else if(v?.type)stack.push(v);
    }
  }
  throw new Error('Master case array missing');
}

const original=casesFromJS(read('source/'+manifest.app));
const published=casesFromJS(read('docs/assets/'+manifest.app));
test('all 306 runtime case records exactly match the reviewed master, not only the JSON count',()=>{
  assert.equal(snapshot.length,306);
  assert.equal(new Set(snapshot.map(c=>c.id)).size,306);
  assert.deepEqual(original,snapshot);
  assert.deepEqual(published,snapshot);
});
test('85 countries, placeholders and multi-country cases retain their actual case membership',()=>{
  const countries=new Set(published.flatMap(c=>c.countries).filter(c=>c&&c!=='/'));
  assert.equal(countries.size,85);
  assert.equal(published.filter(c=>c.countries.includes('/')).length,5);
  for(const [country,count] of [['南非',9],['美国',93],['德国',21],['加拿大',27]])
    assert.equal(published.filter(c=>c.countries.includes(country)).length,count,country);
  for(const invalid of ['数字权利','知识产权','南非政府诉格鲁特布姆案','美国(United States)','刚果金'])assert.equal(countries.has(invalid),false);
  assert.equal(published.reduce((n,c)=>n+c.countries.filter(c=>c&&c!=='/').length,0),353);
});
test('all local legal documents remain published under the unchanged repository path',()=>{
  const tracked=new Set(execFileSync('git',['ls-tree','-r','--name-only','HEAD','docs/pdfs'],{cwd:root,encoding:'utf8'}).trim().split('\n'));
  let references=0;
  for(const row of published)for(const r of row.resources||[])if(r.url.startsWith('/pdfs/')){
    assert.ok(tracked.has('docs'+r.url),row.id+' '+r.url);references++;
  }
  assert.equal(references,266);
});
test('static hosting removes only the original platform telemetry initializer from toolkit',()=>{
  const before='window.__FULLSTACK_RUNTIME_INITIALIZED__||(window.__FULLSTACK_RUNTIME_INITIALIZED__=!0,ap(),sp());';
  const after='window.__FULLSTACK_RUNTIME_INITIALIZED__||(window.__FULLSTACK_RUNTIME_INITIALIZED__=!0,ap());';
  const source=read('source/toolkit-CIfASfd3.js');
  const built=read('docs/assets/toolkit-CIfASfd3.js');
  assert.equal(source.split(before).length-1,1);
  assert.equal(built.split(after).length-1,1);
  assert.equal(built.replace(after,before),source);
});
test('direct pages contain bilingual search metadata, static text and canonical URLs before JavaScript runs',()=>{
  for(const route of ['', 'database/', 'research/', 'about/']){
    const html=read('docs/'+route+'index.html');
    assert.match(html,/<title>[^<]*国际战略性诉讼数据库International Strategic Litigation Database<\/title>/);
    assert.ok(html.includes('rel="canonical" href="https://nnvvff.github.io/cquisl/'+route+'"'));
    assert.ok(/<h1\b[^>]*>[\s\S]*?<\/h1>/.test(html),'static heading: '+route);
    const schema=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(schema['@graph'][0].name,'国际战略性诉讼数据库International Strategic Litigation Database');
    assert.ok(html.includes('85'));
    assert.equal(html.includes('src="https://sf3-scmcdn-cn.feishucdn.com'),false);
    assert.equal(html.includes('slardarScript'),false);
    assert.equal(html.includes('@import "https:'),false);
  }
  assert.match(read('docs/404.html'),/noindex,follow/);
  assert.match(read('docs/index.html'),/306[\s\S]*85[\s\S]*6/);
});
