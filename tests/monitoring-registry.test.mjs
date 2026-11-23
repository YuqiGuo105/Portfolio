import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { createRegistryLoader, parsePublicRegistry, publicJobSelector } from '../src/lib/server/monitoringRegistry.mjs';
import { monitoringServices } from '../src/lib/monitoringSummary.mjs';
import { createServiceMetricsHandler } from '../src/lib/serviceMetrics.mjs';

const entry = { id:'new-service', name:'New Service', monitoring:'health', intervalSeconds:120, endpoint:'https://new.run.app/health', public:true };
const yaml = (services = [entry]) => stringify({version:1,services});
test('new public services appear with no hardcoded ID; private data stays server-side', () => {
  const { catalog } = parsePublicRegistry(yaml([entry,{...entry,id:'private-service',public:false,access:'cloud-run-iam'}]));
  assert.deepEqual(Object.keys(catalog),['new-service']);
  assert.doesNotMatch(JSON.stringify(catalog),/run\.app|"access"|"endpoint"|private-service/);
  const services = monitoringServices({},1000,catalog);
  assert.equal(services.length,1); assert.equal(services[0].status,'unknown');
  assert.equal(services[0].metadata.name,'New Service');
  assert.equal(services[0].metadata.repositoryUrl,null);
  assert.equal(publicJobSelector(catalog),'job=~"new-service"');
  assert.equal(publicJobSelector({}),'job=~"__no_public_services__"');
});
test('reject ambiguous YAML, unknown templates, invalid IDs and oversized responses', () => {
  for(const patch of [{id:undefined},{id:'constructor'},{id:'x"}'},{name:''},{monitoring:'redis'},{intervalSeconds:1},{public:'false'},{repo:'../x'},{stack:['x'.repeat(41)]}]) assert.throws(()=>parsePublicRegistry(yaml([{...entry,...patch}])));
  assert.throws(()=>parsePublicRegistry(yaml([entry,entry])));
  assert.throws(()=>parsePublicRegistry('version: 1\nversion: 1\nservices: []'));
  assert.throws(()=>parsePublicRegistry('x'.repeat(65537)));
});
test('registry refresh is shared, cached, fixed-host and sends no secrets', async () => {
  let calls=0, time=1000;
  const load=createRegistryLoader({now:()=>time,fetchImpl:async(url,options)=>{
    calls++; assert.equal(url,'https://raw.githubusercontent.com/YuqiGuo105/portfolio-admin-service/main/monitoring/services.yaml');
    assert.equal(options.redirect,'error'); assert.deepEqual(options.headers,{Accept:'text/plain'});
    return new Response(yaml());
  }});
  const results=await Promise.all(Array.from({length:10},()=>load()));
  assert.equal(calls,1); assert.equal(results[0],results[9]);
  time+=299999;await load();assert.equal(calls,1);
  time+=2;await load();assert.equal(calls,2);
});
test('bounded last-known fallback, negative cache, and fail closed on cold start', async () => {
  let calls=0,time=1000,fail=false;
  const load=createRegistryLoader({now:()=>time,fetchImpl:async()=>{calls++;if(fail)throw Error('secret');return new Response(yaml());}});
  await load();fail=true;time+=300001;
  assert.ok((await load()).catalog['new-service']);await load();assert.equal(calls,2);
  time+=900001;await assert.rejects(load,/registry unavailable/);
  const cold=createRegistryLoader({fetchImpl:async()=>new Response('not found',{status:404})});
  await assert.rejects(cold,/registry unavailable/);
});
test('timeout and oversized body abort without accepting partial registry', async () => {
  const load=createRegistryLoader({timeoutMs:5,fetchImpl:async(_url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))))});
  await assert.rejects(load,/unavailable/);
  await assert.rejects(createRegistryLoader({fetchImpl:async()=>new Response('x'.repeat(65537))}),/unavailable/);
});
test('detail endpoint uses new catalog and refuses hidden services including cached data', async () => {
  let catalog=parsePublicRegistry(yaml()).catalog,calls=0;
  const handler=createServiceMetricsHandler({getCatalog:async()=>catalog,getToken:()=> 'secret',fetchImpl:async(_url,opts)=>{
    calls++; assert.match(new URLSearchParams(opts.body).get('query'),/job="new-service"/);
    return Response.json({status:'success',data:{result:[]}});
  }});
  const invoke=async()=>{const out={};await handler({method:'GET',query:{job:'new-service'}},{setHeader(){},status(s){out.status=s;return this;},json(b){out.body=b;return this;}});return out;};
  assert.equal((await invoke()).status,200);assert.equal(calls,2);
  catalog={};assert.equal((await invoke()).status,400);assert.equal(calls,2);
});
test('summary queries are all publicly scoped and browser polling count is unchanged', () => {
  const source=readFileSync(new URL('../pages/api/metrics.js',import.meta.url),'utf8');
  const queries=[...source.matchAll(/prom(?:Query|Range)\(\s*`([^`]+)`/g)].map(m=>m[1]);
  assert.equal(queries.length,20);
  for(const query of queries)assert.ok(query.includes('${scope}'),query);
  assert.match(source,/registryRevision: revision/);
  const component=readFileSync(new URL('../src/components/DashboardPanels.js',import.meta.url),'utf8');
  assert.match(component,/30_000|30000/);
  assert.match(component,/service checks every \$\{checkCadence\}/);
  assert.doesNotMatch(component,/service checks every 60/);
});
test('changing a service template invalidates cached metrics immediately', async () => {
  let catalog = parsePublicRegistry(yaml()).catalog;
  let calls = 0;
  const handler = createServiceMetricsHandler({getCatalog: async () => catalog, getToken: () => 'test', fetchImpl: async () => {
    calls++;
    return Response.json({status: 'success', data: {result: []}});
  }});
  const invoke = async () => {
    let body;
    await handler({method: 'GET', query: {job: 'new-service'}}, {setHeader() {}, status() {return this;}, json(value) {body = value;}});
    return body;
  };
  assert.ok(Object.hasOwn(await invoke(), 'probeHistory'));
  await invoke();
  assert.equal(calls, 2);
  catalog = parsePublicRegistry(yaml([{...entry, monitoring: 'jvm'}])).catalog;
  assert.equal(Object.hasOwn(await invoke(), 'probeHistory'), false);
  assert.equal(calls, 4);
});
