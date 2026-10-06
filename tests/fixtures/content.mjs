import {contentHash,contentScopes} from '../../domain/content-contract.mjs';

export async function contentFixture(version='v1',{stable=false,minimum='0.5.0',revision=version,characters={hski:'测试角色'}}={}){
  const files={};
  const values={catalog:{characters,idols:{cards:[],skins:[]},supports:{cards:[]}},
    effects:{tables:{ProduceCard:[],ProduceItem:[],ProduceExamEffect:[]}},
    abilities:{tables:{MemoryAbility:[],ProduceSkill:[],ProduceEffect:[]}},
    progression:{progression:{tables:{IdolCard:[],SupportCard:[]}}},
    achievements:{achievements:{Achievement:[],AchievementProgress:[],Mission:[],Item:[]}}};
  for(const scope of contentScopes){
    const business={scope,...values[scope],...(stable?{}:{testVersion:revision})};
    const ownRevision=await contentHash(new TextEncoder().encode(JSON.stringify(business)));
    files[scope+'.json']=JSON.stringify({revision:ownRevision,...business});
  }
  files['assets-index.json']=JSON.stringify({format:'gakumas-assets-set',schema_version:1,version:'assets-v1',files:{'ui-icons/test.png':{bytes:1,sha256:'0'.repeat(64)}},cdn_base_url:'https://cdn.example.invalid/',cdn_objects:[],baseline:{version:'base-v1',packages:[{url:'https://release.example.invalid/base.tar.gz',bytes:1,sha256:'1'.repeat(64),objects:{['0'.repeat(64)+'.png']:{bytes:1,sha256:'0'.repeat(64)}}}]}});
  const manifest={format:'gakumas-content',schema_version:1,version,min_web_version:minimum,master_revision:revision,files:{}};
  for(const [name,text] of Object.entries(files)){
    const raw=new TextEncoder().encode(text);manifest.files[name]={bytes:raw.byteLength,sha256:await contentHash(raw),...(name!=='assets-index.json'?{revision:JSON.parse(text).revision}:{})};
  }
  const raw=JSON.stringify(manifest),hash=await contentHash(new TextEncoder().encode(raw));
  const bundle={format:'gakumas-content-bundle',schema_version:1,manifest:raw,manifest_sha256:hash,files};
  const channel={format:'gakumas-content-channel',schema_version:1,version,manifest:`releases/${version}/manifest.json`,sha256:hash};
  return {manifest,bundle,channel,files,raw};
}
export function contentTransport(fixture,calls=[]){
  return async(url,options)=>{
    calls.push({url,options});const name=new URL(url).pathname.split('/').at(-1);
    const body=name==='channel.json'?JSON.stringify(fixture.channel):name==='manifest.json'?fixture.raw:fixture.files[name];
    return new Response(body??'',{status:body===undefined?404:200});
  };
}
export function memoryContentStore(initial){
  let saved=initial,writes=0;
  return {read:async()=>saved,write:async value=>{saved=structuredClone(value);writes++;},get value(){return saved;},get writes(){return writes;}};
}
