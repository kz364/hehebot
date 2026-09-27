import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const session = read('Sources/HehebotPortal/PortalSession.swift');
const app = read('Sources/HehebotPortal/HehebotPortalApp.swift');

test('document-start capability removal is executable and resistant to ordinary page reassignment', () => {
  const context = vm.createContext({});
  vm.runInContext(`globalThis.navigator = Object.create({geolocation: {getCurrentPosition() {}}, clipboard: {}});
    globalThis.Notification = function() {}; globalThis.showOpenFilePicker = function() {};`, context);
  vm.runInContext(read('Sources/HehebotPortal/Permissions.js'), context);
  for (const expression of ['navigator.geolocation', 'Object.getPrototypeOf(navigator).geolocation',
    'navigator.clipboard', 'navigator.mediaDevices', 'navigator.credentials', 'Notification', 'showOpenFilePicker']) {
    assert.equal(vm.runInContext(expression, context), undefined, expression);
    assert.throws(() => vm.runInContext(`'use strict'; ${expression} = {};`, context));
  }
});

test('WebKit integration wires exact policy, response cancellation and isolated named storage', () => {
  for (const fragment of ['allowsNavigation(action.request.url', 'action.targetFrame != nil',
    'action.shouldPerformDownload', 'allowsResponse(response.response.url', 'response.canShowMIMEType',
    'Content-Disposition', 'decisionHandler(allowed ? .allow : .cancel)',
    'WKWebsiteDataStore(forIdentifier: Self.storeID(configuration.portal))',
    'SHA256.hash(data: Data(origin.value.utf8))', 'http?.statusCode == 401 || http?.statusCode == 403']) {
    assert.ok(session.includes(fragment), fragment);
  }
  assert.ok(!session.includes('WKWebsiteDataStore.default'));
});

test('native opening only exposes configured root; only the one-way notification bridge, no agent or replay loop', () => {
  assert.equal((session.match(/NSWorkspace.shared.open/g) || []).length, 1);
  assert.ok(session.includes('NSWorkspace.shared.open(configuration.portal.url)'));
  assert.ok(app.includes('Button("Open Portal in Default Browser") { session.openPortalInBrowser() }'));
  const files = readdirSync(new URL('Sources/HehebotPortal/', root)).filter(file => file.endsWith('.swift'));
  const sources = files.map(file => read(`Sources/HehebotPortal/${file}`)).join('\n');
  for (const prohibited of [/evaluateJavaScript\(/, /WKScriptMessageHandlerWithReply/, /replyHandler/,
    /Timer\./, /\.reload\(/, /\.goBack\(/, /loadFileURL/, /URLSession\.shared/, /setValue\(/]) {
    assert.doesNotMatch(sources, prohibited);
  }
  // E12: exactly one page-to-native handler (NotificationBridge), registered once,
  // validated by the Foundation policy (origin/main frame/shape) before any effect.
  const bridge = read('Sources/HehebotPortal/NotificationBridge.swift');
  assert.equal((sources.match(/WKScriptMessageHandler/g) || []).length, 1);
  assert.match(bridge, /final class NotificationBridge: NSObject, WKScriptMessageHandler/);
  assert.match(bridge, /NotificationRequest\(body: message.body, isMainFrame: message.frameInfo.isMainFrame/);
  assert.match(bridge, /UserDefaults.standard.bool\(forKey: Self.enabledKey\)/);
  assert.equal((sources.match(/userContentController.add\(/g) || []).length, 1);
  assert.ok(session.includes('userContentController.add(NotificationBridge(portal: configuration.portal)'));
  // The only process launched is /bin/launchctl with fixed vectors (Mac node start/stop/status).
  for (const file of files) {
    if (file !== 'NodeControl.swift') assert.doesNotMatch(read(`Sources/HehebotPortal/${file}`), /Process\(/, file);
  }
  const node = read('Sources/HehebotPortal/NodeControl.swift');
  assert.match(node, /executableURL = URL\(fileURLWithPath: MacNodeAgent.launchctl\)/);
  assert.match(node, /arguments = MacNodeAgent.arguments\(action, uid: getuid\(\), home: NSHomeDirectory\(\)\)/);
  assert.equal((session.match(/view.load\(/g) || []).length, 1);
  assert.ok(session.includes('view.load(URLRequest(url: configuration.portal.url))'));
  assert.ok(app.includes('.id(ObjectIdentifier(webView))'));
  assert.equal((session.match(/guard webView === self.webView else/g) || []).length, 6);
  assert.doesNotMatch(session, /(?:navigationDelegate|uiDelegate) = nil/);
});

test('denial hooks and capability-removal script are wired without private APIs', () => {
  for (const fragment of ['javaScriptCanOpenWindowsAutomatically = false',
    'createWebViewWith configuration:', '-> WKWebView? { nil }', 'runOpenPanelWith parameters:',
    'completionHandler(nil)', 'requestMediaCapturePermissionFor origin:', 'decisionHandler(.deny)',
    'menu.removeAllItems()', 'performDragOperation', '-> Bool { false }',
    'injectionTime: .atDocumentStart, forMainFrameOnly: false', 'Connection refused.',
    '.performDefaultHandling : .cancelAuthenticationChallenge']) assert.ok(session.includes(fragment), fragment);
});

test('package and app manifest agree on macOS 14 and network-only sandbox intent', () => {
  assert.match(read('Package.swift'), /macOS\(\.v14\)/);
  assert.match(read('Support/Info.plist'), /LSMinimumSystemVersion<\/key><string>14.0<\/string>/);
  const entitlements = read('Support/HehebotPortal.entitlements');
  assert.deepEqual([...entitlements.matchAll(/<key>(.*?)<\/key>/g)].map(match => match[1]),
    ['com.apple.security.app-sandbox', 'com.apple.security.network.client']);
  assert.doesNotMatch(read('Support/Info.plist'), /UsageDescription|NSAllowsArbitraryLoads/);
  assert.doesNotMatch(read('scripts/build-app.sh'), /codesign|notarytool/);
});
