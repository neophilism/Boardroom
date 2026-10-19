/** Component-handler tests with synthetic React hooks, not browser/Next evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const input=readFileSync('app/owner-navigation.tsx','utf8');
const compiled=ts.transpileModule(input,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const links=[{href:'/work-board',label:'Work board',group:'Workspace'},{href:'/audit',label:'Audit trail',group:'Oversight'}];
function fixture(){
  const states=[],reference={current:{focus(){focused++;}}};let cursor=0,focused=0,pathname='/audit';
  const jsx=(type,props)=>({type,props});const module={exports:{}};
  const dependencies={
    'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},
    'react':{useState(initial){const index=cursor++;if(!(index in states))states[index]=initial;return [states[index],value=>{states[index]=value;}];},useRef(){return reference;}},
    'next/link':{default:'a'},'next/navigation':{usePathname:()=>pathname},
    '../src/domain/owner-navigation':{OWNER_NAVIGATION:links,ownerNavigationSection:path=>links.find(link=>path===link.href)||null},
  };
  vm.runInNewContext(compiled,{module,exports:module.exports,require(name){assert.ok(name in dependencies,'unexpected component dependency');return dependencies[name];}});
  function render(){cursor=0;const result=module.exports.default();const all=[];
    function visit(node){if(Array.isArray(node)){node.forEach(visit);return;}if(node&&typeof node==='object'){all.push(node);visit(node.props?.children);}}visit(result);
    return {all,find:selector=>{const item=all.find(selector);assert.ok(item,'component element missing');return item;}};
  }
  return {render,focusCount:()=>focused,path:value=>{pathname=value;}};
}
const menu=tree=>tree.find(el=>el.type==='button'&&el.props.className.includes('boardroom-menu'));
function escape(element,key='Escape'){let prevented=0;element.props.onKeyDown?.({key,preventDefault(){prevented++;}});return prevented;}
for(const location of ['header','aside']){
  test('Escape from '+location+' closes an open disclosure and restores the control focus',()=>{
    const f=fixture();menu(f.render()).props.onClick();const open=f.render();assert.equal(menu(open).props['aria-expanded'],true);
    assert.equal(escape(open.find(el=>el.type===location)),1);assert.equal(menu(f.render()).props['aria-expanded'],false);assert.equal(f.focusCount(),1);
  });
  test('Escape from '+location+' leaves a closed disclosure and focus unchanged',()=>{
    const f=fixture();assert.equal(escape(f.render().find(el=>el.type===location)),0);assert.equal(f.focusCount(),0);
  });
  test('other keys from '+location+' do not close an open disclosure',()=>{
    const f=fixture();menu(f.render()).props.onClick();assert.equal(escape(f.render().find(el=>el.type===location),'Enter'),0);
    assert.equal(menu(f.render()).props['aria-expanded'],true);assert.equal(f.focusCount(),0);
  });
}
test('disclosure toggle preserves the same controlled navigation and accessible label',()=>{
  const f=fixture();assert.equal(menu(f.render()).props.children,'Menu');menu(f.render()).props.onClick();
  assert.equal(menu(f.render()).props.children,'Close menu');assert.equal(menu(f.render()).props['aria-controls'],'boardroom-navigation');
  menu(f.render()).props.onClick();assert.equal(menu(f.render()).props['aria-expanded'],false);
});
test('selecting a destination closes navigation without moving focus back to the old control',()=>{
  const f=fixture();menu(f.render()).props.onClick();f.render().find(el=>el.type==='a'&&el.props.href==='/audit').props.onClick();
  assert.equal(menu(f.render()).props['aria-expanded'],false);assert.equal(f.focusCount(),0);
});
test('changing the current route does not leave an old disclosure open',()=>{
  const f=fixture();menu(f.render()).props.onClick();f.path('/work-board');assert.equal(menu(f.render()).props['aria-expanded'],false);
});
test('no-script rendering retains the server-authorized navigation and hides the inert toggle',()=>{
  const f=fixture(),tree=f.render(),fallback=tree.find(el=>el.type==='noscript');assert.ok(fallback);
  const style=tree.find(el=>el.type==='style').props.children;
  assert.match(style,/\.boardroom-sidebar\s*\{\s*display:block!important/);
  assert.match(style,/\.boardroom-top-actions \.boardroom-menu\s*\{\s*display:none!important/);
  assert.equal(tree.all.filter(el=>el.type==='a'&&el.props.prefetch===false).length,links.length);
  assert.match(input,/NoScript|JavaScript|javascript/i);
});
