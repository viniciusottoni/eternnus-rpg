import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editableValues, ownActions, pdfFieldBox, downloadName, sheetPdfPath} from '../apps/Eternnus.Web/wwwroot/js/character-policy.js';
import {clampZoom, pageBox, keyboardChange, applyKeyboard, numberProblem} from '../apps/Eternnus.Web/wwwroot/js/pdf-sheet.js';
test('sheet writes exclude computed and prototype values while preserving false and zero',()=>{
 const inherited=Object.create({hp:'999'}); inherited.zero=0; inherited.flag=false;
 const actual=editableValues([{name:'hp',type:'number',default:'10'},{name:'zero',type:'number'},{name:'flag',type:'checkbox'},{name:'calc',type:'computed'}],inherited);
 assert.deepEqual({...actual},{hp:'10',zero:'0',flag:'false'}); assert.equal(Object.getPrototypeOf(actual),null);
});
test('template actions stay immutable and outside personal action submissions',()=>{
 assert.deepEqual(ownActions({actions:[{id:'t:hit',source:'template'},{id:'personal'},{id:'t:legacy'}]}),[{id:'personal'}]);
});
test('PDF fields use normalized page coordinates and download names cannot contain paths',()=>{
 assert.deepEqual(pdfFieldBox({x:.1,y:.2,w:.3,h:.4},1000,2000),{x:100,y:400,w:300,h:800});
 assert.equal(downloadName('../Hero\\Name:*?'), '..HeroName.pdf'); assert.equal(downloadName(''), 'Ficha.pdf');
});
test('PDF page and zoom remain bounded and keyboard edits stay on the page',()=>{
 assert.equal(clampZoom(100),3); assert.equal(clampZoom(.1),.5);
 const box=pageBox({width:600,height:800},600,1); assert.equal(box.height,800);
 const change=keyboardChange('ArrowRight',{shift:true}); assert.equal(change.kind,'resize');
 const moved=applyKeyboard({x:.8,y:.8,w:.2,h:.2},keyboardChange('ArrowRight'));
 assert.ok(moved.x+moved.w<=1.00001);
 assert.ok(numberProblem({min:1,max:20},'21')); assert.equal(numberProblem({min:1,max:20},'10'),'');
});

test('PDF loads accept only the authenticated template route and a bounded revision query',()=>{
 const path='/api/sheet-templates/00000000-0000-4000-8000-000000000101/versions/00000000-0000-4000-8000-000000000102/pdf';
 assert.equal(sheetPdfPath(path),path.slice(4)); assert.equal(sheetPdfPath(path+'?r=3'),path.slice(4)+'?r=3');
 for(const value of ['https://evil.example'+path,path+'?token=secret',path+'/../../other','javascript:alert(1)']) assert.throws(()=>sheetPdfPath(value));
});

import {diffVersions,compactDoc} from '../apps/Eternnus.Web/wwwroot/js/sheet-editor-policy.js';
test('publishing compares omitted appearance defaults without reporting untouched fields as moved',()=>{
 const before={pages:[{width:595,height:842}],fields:[{name:'hp',label:'Vida',type:'number',x:.1,y:.2,w:.3,h:.04,page:0,fontSize:10,align:'left'}],actions:[]};
 const after=compactDoc(before); assert.deepEqual(diffVersions(before,after).moved,[]);
 after.fields[0].y=.25; assert.deepEqual(diffVersions(before,after).moved,['hp']);
});
