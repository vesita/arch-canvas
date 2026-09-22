"use strict";
// arch-canvas 的浏览器半边（真插件形态）。
//
// 手写 __ModuleLoader__.load 包装是浏览器半边的加载协议：客户端插件以「一个自带 id 的
// 工厂」注册，require 由加载器注入。全文件不使用 JSX —— React.createElement 的第三个
// 参数起是 children，而自动 jsx runtime 从 props.children 读取，混用会静默渲染出空元素。
//
// 这一层同样刻意做薄：界面本体（lib/ui.js）由 host 从 /arch-canvas/ui.js 现读现发，
// 这里只负责把宿主环境才有的东西递进去 —— React、styles、rpc；另外挂一张设置卡
// （「插件」页里的数据目录），它用的是官方设置表单原语，不碰界面本体。
//
// 由 tools/build.mjs 从 src/package/client.js 拷到 lib/client.js，不要手改 lib/。
window.__ModuleLoader__.load({
    id: 'arch-canvas',
    factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
        const React = require('react');
        /**
         * 官方设置表单原语：保存/放弃/暂存语义全部由它们承担，不自己发明一套。
         * 与 dsh-collab 的同款用法（见 `ui-settings-agent-loop` 的官方页面）。
         */
        const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
        const RPC_PATH = '/arch-canvas/rpc';
        const UI_URL = '/arch-canvas/ui.js';
        /** 本插件在 profile 里的**条目 id**，也就是配置表单的命名空间（与 cordis.patch.yml 的 id 一致）。 */
        const CONFIG_NS = 'arch-canvas';
        /** 插件页里本插件那张配置卡的键：必须是 bundle 的包名。 */
        const BUNDLE_KEY = 'arch-canvas';
        /** 本卡编辑的唯一字段，与 Host 半边 Config 的字段名逐字一致。 */
        const DATA_DIR_FIELD = 'dataDir';
        var uiDispose = null;
        function detach() {
            if (typeof uiDispose === 'function') {
                try {
                    uiDispose();
                }
                catch (e) { }
            }
            uiDispose = null;
        }
        // 界面里的 host.call 在真插件形态下走这个：同源 POST，请求/响应都是 JSON。
        // 约定与服务端一致：HTTP 层 {ok, value|error}，value 里面才是业务返回值。
        function rpc(method, args) {
            return fetch(RPC_PATH, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ method: method, args: args || {} }),
            })
                .then(function (r) { return r.json(); })
                .then(function (r) {
                if (!r || r.ok !== true)
                    throw new Error((r && r.error) || 'RPC 失败');
                return r.value;
            });
        }
        // 界面用 styles.insert(css) 注入样式。动态模式里这是沙箱给的，这里是等价实现。
        function makeStyles() {
            return {
                insert: function (css) {
                    var el = document.createElement('style');
                    el.setAttribute('data-arch-canvas', '');
                    el.textContent = css;
                    document.head.appendChild(el);
                    return function () { try {
                        el.remove();
                    }
                    catch (e) { } };
                },
            };
        }
        function loadUi(ctx) {
            window.__archCanvasDeps = { React: React, styles: makeStyles(), rpc: rpc };
            return new Promise(function (resolve, reject) {
                var el = document.createElement('script');
                el.src = UI_URL;
                el.async = false;
                el.onload = function () { resolve(); };
                el.onerror = function () {
                    try {
                        el.remove();
                    }
                    catch (e) { }
                    reject(new Error('无法加载 ' + UI_URL));
                };
                document.head.appendChild(el);
            })
                .then(function () {
                var mod = window.__archCanvas;
                if (!mod || typeof mod.install !== 'function') {
                    throw new Error('ui.js 没有导出 __archCanvas.install');
                }
                detach(); // 重复加载时先卸旧的，避免槽位重复注册
                uiDispose = mod.install(ctx);
            });
            // 不 catch：界面加载失败就让 Promise 带着原因去吵（浏览器自己会报 uncaught），
            // 这个插件对 console 一字不吐 —— 成功也安静。
        }
        function apply(ctx) {
            ctx.effect(function () { return detach; });
            mountConfigCard(ctx);
            loadUi(ctx);
        }
        /**
         * 侧边栏「插件」页里 arch-canvas 那张卡上的配置区。
         *
         * DSH 0.1.7 起客户端不再有 `settingsScope`：设置页读写的统一入口是
         * `configForms`（当前 Profile 的插件配置在浏览器里的那张表单）。插件页只为
         * **条目上带 config 的包**渲染配置区 —— `ledger.bundles` 收集注册了
         * `plugins.bundle.config` 槽的包名，所以这里 `key` 必须是**包名**。
         *
         * 本卡只编辑一项：数据目录。它只放**平铺标量** —— 官方 `SettingsFormModel`
         * 按单键读写（`value?.[field]` / `path: [field]`），嵌套对象在表单里够不着。
         */
        function mountConfigCard(ctx) {
            // `configForms` 缺席（旧构建 / 没有设置服务的部署）时安静跳过，绝不抛 ——
            // 抛出去会把整个浏览器半边带下去，连画布都开不了。
            var forms = ctx && ctx.configForms;
            if (!forms || typeof forms.get !== 'function')
                return;
            var scope = forms.get(CONFIG_NS);
            if (!scope)
                return;
            var SettingsForm = primitives.SettingsForm;
            var SettingsValueField = primitives.SettingsValueField;
            var SettingsFormModel = primitives.SettingsFormModel;
            var settingsTextField = primitives.settingsTextField;
            var formModel = new SettingsFormModel(scope, [settingsTextField(DATA_DIR_FIELD)]);
            ctx.effect(function () { return function () { formModel.dispose(); }; });
            /**
             * 保存栏文案。官方 `SettingsForm` 的 labels 契约，逐字对齐
             * `ui-settings-agent-loop` 与 dsh-collab。
             */
            var formLabels = {
                unavailable: '本部署没有提供这项配置。',
                readOnly: '本部署的配置为只读，无法在此修改。',
                save: '保存',
                saving: '保存中…',
                saveFailed: '保存失败，改动未生效。',
            };
            var formStore = formModel.bind(function () {
                var projection = { shell: formModel.shell() };
                projection[DATA_DIR_FIELD] = formModel.field(DATA_DIR_FIELD);
                return projection;
            });
            ctx.effect(function () { return function () { formStore.dispose(); }; });
            function ArchConfigCard(props) {
                var state = props.useArchConfig(function (s) { return s; });
                var node = state[DATA_DIR_FIELD];
                return React.createElement(SettingsForm, {
                    labels: formLabels,
                    state: state.shell,
                    onSave: props.save,
                    onDiscard: props.discard,
                }, React.createElement(SettingsValueField, {
                    id: DATA_DIR_FIELD,
                    label: '数据目录',
                    hint: '全局图库与日志的落点。留空则用 $DSH_HOME（否则 ~/.dsh）下的 arch-canvas。' +
                        '它决定图库根目录，所以改完要重启 dsh 才生效。',
                    text: node.text,
                    overridden: node.overridden,
                    invalid: node.invalid,
                    onEdit: function (text) { props.edit(DATA_DIR_FIELD, text); },
                    onReset: function () { props.resetField(DATA_DIR_FIELD); },
                }));
            }
            ctx.slots.inject('plugins.bundle.config', function () {
                return ctx.slots.register({
                    name: 'plugins.bundle.config',
                    key: BUNDLE_KEY,
                    inject: function () {
                        var face = formModel.actions();
                        face.hooks = { archConfig: formStore };
                        return face;
                    },
                }, ArchConfigCard);
            });
        }
        exports.apply = apply;
        // 界面本体依赖 slots（注册主窗口子页）；配置卡依赖 configForms。
        // **不列 timer**：没有它界面靠原生定时器回退（见 runtime.ts 的 ctxTimeout），
        // 而列了又缺席，插件会永远 park 且不报错。
        exports.inject = ['slots', 'configForms'];
        return module.exports;
    },
});
