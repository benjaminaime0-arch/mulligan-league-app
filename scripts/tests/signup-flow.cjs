const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../../src/lib/signupFlow.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const loaded = new Module(filename, module);
loaded._compile(compiled, filename);
const {signupRedirectPath,signupDestination,signupConfirmationUrl} = loaded.exports;

test('a new confirmed signup goes to onboarding', () => {
  assert.equal(signupDestination(null), '/welcome');
  const callback = new URL(signupConfirmationUrl('https://app.mulliganclub.co', null));
  assert.equal(callback.origin, 'https://app.mulliganclub.co');
  assert.equal(callback.pathname, '/');
  assert.equal(callback.searchParams.get('signup'), 'confirmed');
});
test('email confirmation preserves an invite and its query parameters', () => {
  const target = '/join/league123?source=friend&mode=join';
  const callback = new URL(signupConfirmationUrl('https://app.mulliganclub.co', target));
  assert.equal(callback.searchParams.get('redirect'), target);
  assert.equal(signupDestination(callback.searchParams.get('redirect')), target);
});
test('external destinations cannot be used in email confirmation or onboarding', () => {
  for (const target of ['https://example.com', '//example.com', '/\\example.com', '/\nexample.com', 'javascript:alert(1)']) {
    assert.equal(signupRedirectPath(target), null);
    assert.equal(signupDestination(target), '/welcome');
    assert.equal(new URL(signupConfirmationUrl('https://app.mulliganclub.co', target)).searchParams.has('redirect'), false);
  }
});
test('confirmation links use the current deployment origin', () => {
  assert.equal(new URL(signupConfirmationUrl('http://localhost:3000', '/rounds')).origin, 'http://localhost:3000');
  assert.equal(new URL(signupConfirmationUrl('https://preview.vercel.app', '/rounds')).origin, 'https://preview.vercel.app');
});

test('league creation survives email verification on the review origin', () => {
  const callback = new URL(signupConfirmationUrl('http://localhost:3400', '/games/create'));
  assert.equal(signupDestination(callback.searchParams.get('redirect')), '/games/create');
});
test('redirect normalization blocks dot-segment escapes to a protocol-relative URL', () => {
  assert.equal(signupRedirectPath('/safe/..//example.com'), null);
});
