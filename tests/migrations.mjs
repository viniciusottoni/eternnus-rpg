import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const database='eternnus_test_migration_'+randomUUID().replaceAll('-','');
assert.match(database,/^eternnus_test_migration_[a-f0-9]{32}$/);
const container=process.env.ETERNNUS_TEST_CONTAINER||'eternnus-postgres-dev';
const docker=(...args)=>execFileSync('docker',['exec',container,...args],{encoding:'utf8',windowsHide:true});
const sql=text=>docker('psql','-U','eternnus','-d',database,'-v','ON_ERROR_STOP=1','-At','-c',text).trim();
const apply=async path=>execFileSync('docker',['exec','-i',container,'psql','-U','eternnus','-d',database,'-v','ON_ERROR_STOP=1'],{input:await readFile(path),windowsHide:true,stdio:['pipe','ignore','pipe']});
const ids={Campaigns:randomUUID(),Characters:randomUUID(),Sessions:randomUUID(),AspNetUsers:'migration-owner'};
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
function insert(table,overrides){
 const columns=JSON.parse(sql(`SELECT json_agg(row_to_json(c)) FROM (SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_name='${table}' ORDER BY ordinal_position)c`));
 const names=[],values=[];
 for(const c of columns){
  const k=c.column_name; let value;
  if(Object.hasOwn(overrides,k)) value=quote(overrides[k]);
  else if(c.column_default!==null||c.is_nullable==='YES') continue;
  else if(k==='Id') value=quote(ids[table]);
  else if(k==='OwnerId') value=quote(ids.AspNetUsers);
  else if(k==='CampaignId') value=quote(ids.Campaigns);
  else if(c.data_type==='boolean') value='false';
  else if(c.data_type.includes('timestamp')) value='now()';
  else if(c.data_type==='jsonb') value="'[]'::jsonb";
  else if(['integer','bigint','double precision','numeric','real'].includes(c.data_type)) value=['Level','Revision','Number','MaxHp','Hp'].includes(k)?'1':'0';
  else value="''";
  names.push('"'+k+'"'); values.push(value);
 }
 sql(`INSERT INTO "${table}" (${names.join(',')}) VALUES (${values.join(',')})`);
}
let created=false;
try{
 docker('createdb','-U','eternnus',database);created=true;
 await apply('artifacts/postgres-legacy.sql');
 insert('AspNetUsers',{DisplayName:'Legado',AvatarUrl:'/assets/avatar.svg'});
 insert('Campaigns',{Name:'Campanha preservada',System:'Sistema Antigo',Description:'Premissa anterior',InviteCode:'0'.repeat(32)});
 insert('Characters',{Name:'Heroína anterior',Notes:'Anotações preservadas',Archetype:'Guardiã'});
 insert('Sessions',{Title:'Sessão anterior',Objective:'x'.repeat(4500),EndedAt:'2026-11-06T12:00:00Z'});
 const resource=randomUUID();
 sql(`INSERT INTO "Resources" ("Id","CampaignId","Kind","Name","Content","Shared") VALUES ('${resource}','${ids.Campaigns}','nota','Texto legado','Conteúdo preservado',true)`);
 await apply('artifacts/postgres-ondas-ab.sql'); await apply('artifacts/postgres-ondas-ab.sql');
 assert.equal(sql('SELECT count(*) FROM "Characters"'),'1');
 assert.equal(sql(`SELECT "Name" || '|' || "Notes" FROM "Characters" WHERE "Id"='${ids.Characters}'`),'Heroína anterior|Anotações preservadas');
 assert.equal(sql(`SELECT length("Objective") FROM "Sessions" WHERE "Id"='${ids.Sessions}'`),'4500');
 assert.equal(sql(`SELECT count(*) FROM "Campaigns" c JOIN "RpgSystems" s ON s."Id"=c."RpgSystemId" WHERE c."System"='Sistema Antigo' AND s."Name"='Sistema Antigo'`),'1');
 assert.equal(sql('SELECT "Role" FROM "AspNetUsers"'), 'common');
 assert.equal(sql('SELECT count(*) FROM "__EFMigrationsHistory"'),'6');
 assert.equal(sql(`SELECT "Title" || '|' || "Text" || '|' || "Published" FROM "CampaignLibraryEntry" WHERE "Id"='${resource}'`),'Texto legado|Conteúdo preservado|true');
 assert.equal(sql(`SELECT count(*) FROM "Resources" WHERE "Id"='${resource}'`),'1');
 console.log('PASS: legacy database upgraded; users, campaign system, character and 4,500-character session objective preserved; idempotent script reapplied successfully.');
}finally{if(created)docker('dropdb','-U','eternnus',database);}
