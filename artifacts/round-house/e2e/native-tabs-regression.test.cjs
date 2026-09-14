const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../app/(tabs)/_layout.tsx'), 'utf8');
function load() {
  const state = { signedIn: true, loaded: true, status: 'ready', hooks: [] };
  const react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) };
  const nativeTabs = { NativeTabs: Object.assign(() => {}, { Trigger: 'Trigger' }), Icon: 'Icon', Label: 'Label' };
  const modules = {
    react,
    'react-native': { StyleSheet: { absoluteFill: {} }, Platform: { OS: 'ios' }, View: 'View' },
    'expo-router': { Redirect: 'Redirect', useSegments: () => { state.hooks.push('segments'); return ['(tabs)', 'profile']; } },
    'expo-router/unstable-native-tabs': nativeTabs,
    'expo-glass-effect': { isLiquidGlassAvailable: () => true },
    '@/lib/auth': { useAuth: () => { state.hooks.push('auth'); return { isSignedIn: state.signedIn, isLoaded: state.loaded }; } },
    '@/lib/profile': { useProfile: () => { state.hooks.push('profile'); return { status: { kind: state.status } }; } },
  };
  const compiled = ts.transpileModule(source + '\nexport { NativeTabLayout };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const context = { exports: {}, require: name => modules[name] ?? {} };
  vm.runInNewContext(compiled, context);
  return { state, ...context.exports };
}
test('native layout renders every tab icon, including hidden Logs', () => {
  const { NativeTabLayout } = load();
  const tree = NativeTabLayout();
  assert.deepEqual(tree.children.filter(c => !c.props.hidden).map(c => c.props.name), ['index', 'clients', 'my-team', 'profile']);
  for (const trigger of tree.children) {
    const icon = trigger.children.find(c => c.type === 'Icon');
    assert.ok(icon.props.sf.default);
    assert.ok(icon.props.sf.selected);
  }
  const logs = tree.children.find(c => c.props.name === 'logs');
  assert.equal(logs.props.hidden, true);
  assert.equal(logs.children[0].props.sf.default, 'doc.text');
});
test('hook order remains stable through loading, sign-in and onboarding', () => {
  const app = load();
  for (const scenario of [
    { loaded: false, signedIn: false, status: 'loading' },
    { loaded: true, signedIn: false, status: 'loading' },
    { loaded: true, signedIn: true, status: 'needs-intake' },
    { loaded: true, signedIn: true, status: 'ready' },
  ]) {
    Object.assign(app.state, scenario, { hooks: [] });
    app.default();
    assert.deepEqual(app.state.hooks, ['auth', 'profile', 'segments']);
  }
});
