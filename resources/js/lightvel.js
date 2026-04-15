/**
 * Lightvel JS Runtime — Client-side reactive engine.
 *
 * Architecture overview:
 *   1. INIT: On DOMContentLoaded, initJsState() reads data-light-server-state
 *      and data-light-state attributes to build the reactive state object.
 *   2. BINDING: syncBindings() updates DOM elements bound via light:text,
 *      light:show, light:if, light:class, light:for etc.
 *   3. ACTIONS: Click/submit events trigger sendLightAction() AJAX POST to
 *      the proxy endpoint. Server returns JSON delta state.
 *   4. UPDATE: update() merges delta state, applies __patch operations,
 *      and calls syncBindings() to refresh the DOM.
 *
 * Key performance features:
 *   - Expression cache: compiled Function objects are cached by expression string
 *   - Batched DOM updates via requestAnimationFrame
 *   - light:function handles client-side state changes without server round-trip
 *   - __patch operations for surgical array mutations (insert/update/delete)
 *
 * @see Component.php — server-side component that processes actions
 * @see Compiler.php — generates the data-light-* attributes read here
 * @see Directives.php — transforms light:* shorthand into data-light-*
 * @see Assets.php — outputs this script with boot styles
 */
(function () {
    // --- Progress bar (top-of-page loading indicator during AJAX) ---
    let progressEl = null;
    let progressTimer = null;
    let progressEndTimer1 = null;
    let progressEndTimer2 = null;

    // --- Expression cache: avoids recreating Function() objects on every eval ---
    // Key: expression string, Value: compiled Function
    let __exprCache = new Map();

    // --- Loading state ---
    // Tracks active AJAX requests. light:loading elements are shown when > 0
    let __lightLoadingCount = 0;
    let __loadingDelayTimers = new Map();  // el → setTimeout id
    let __loadingMinEndTimes = new Map(); // el → timestamp when min expires
    let __loadingStartTime = 0;

    function getConfig() {
        return window.Lightvel || {};
    }

    function ensureProgressBar() {
        if (progressEl) return progressEl;

        progressEl = document.createElement('div');
        progressEl.setAttribute('data-light-progress', 'true');
        progressEl.style.position = 'fixed';
        progressEl.style.top = '0';
        progressEl.style.left = '0';
        progressEl.style.height = '2px';
        progressEl.style.width = '0%';
        progressEl.style.opacity = '0';
        progressEl.style.zIndex = '2147483647';
        progressEl.style.transition = 'width 250ms ease, opacity 250ms ease';
        progressEl.style.backgroundColor = getConfig().progressBarColor || '#111827';

        document.body.appendChild(progressEl);
        return progressEl;
    }

    function startProgress() {
        let el = ensureProgressBar();
        
        clearTimeout(progressTimer);
        clearTimeout(progressEndTimer1);
        clearTimeout(progressEndTimer2);

        el.style.backgroundColor = getConfig().progressBarColor || '#111827';
        el.style.transition = 'none';
        el.style.width = '0%';
        el.style.opacity = '1';

        // Force reflow
        void el.offsetWidth;

        requestAnimationFrame(() => {
            el.style.transition = 'width 300ms ease, opacity 250ms ease';
            el.style.width = '70%';
        });

        progressTimer = setTimeout(() => {
            el.style.width = '90%';
        }, 350);
    }

    function endProgress() {
        if (!progressEl) return;

        clearTimeout(progressTimer);
        clearTimeout(progressEndTimer1);
        clearTimeout(progressEndTimer2);

        progressEl.style.transition = 'width 250ms ease, opacity 250ms ease';
        progressEl.style.width = '100%';

        progressEndTimer1 = setTimeout(() => {
            if (!progressEl) return;
            progressEl.style.transition = 'opacity 250ms ease'; // Only fade opacity, don't slide width back
            progressEl.style.opacity = '0';
            
            progressEndTimer2 = setTimeout(() => {
                if (!progressEl) return;
                progressEl.style.transition = 'none';
                progressEl.style.width = '0%';
            }, 250);
        }, 200);
    }

    let jsApi = null;

    function getJsApi() {
        if (jsApi) return jsApi;

        window.Lightvel = window.Lightvel || {};
        let api = window.Lightvel.js || {};

        api.state = api.state || {};
        api.consts = api.consts || {};
        api.actions = api.actions || {};
        api.errors = api.errors || {};
        api._syncDepth = api._syncDepth || 0;

        api.set = api.set || function (key, value) {
            if (Object.prototype.hasOwnProperty.call(api.consts, key)) {
                return;
            }

            api.state[key] = value;

            if (api._syncDepth === 0) {
                syncBindings(key);
            }
        };

        api.batch = api.batch || function (callback) {
            api._syncDepth++;

            try {
                return callback();
            } finally {
                api._syncDepth--;

                if (api._syncDepth === 0) {
                    syncBindings();
                }
            }
        };

        api.get = api.get || function (key) {
            if (Object.prototype.hasOwnProperty.call(api.consts, key)) {
                return api.consts[key];
            }

            return api.state[key];
        };

        api.register = api.register || function (name, fn) {
            api.actions[name] = fn;
        };

        window.Lightvel.js = api;
        jsApi = api;

        return api;
    }

    function getFieldName(el) {
        return el.dataset.lightJsModel || el.dataset.lightModel || el.getAttribute('name') || '';
    }

    function getElementValue(el) {
        if (el.type === 'checkbox') {
            return el.checked ? el.value || '1' : '';
        }

        if (el.type === 'radio') {
            return el.checked ? el.value || '1' : '';
        }

        if (el.tagName === 'SELECT' && el.multiple) {
            return Array.from(el.selectedOptions).map((o) => o.value);
        }

        return el.value ?? '';
    }

    function syncJsBindings(key) {
        let api = getJsApi();
        if (!key) return;

        document.querySelectorAll(`[data-light-model="${key}"]`).forEach((el) => {
            let nextValue = api.state[key] ?? '';

            if (el.type === 'checkbox') {
                el.checked = String(nextValue) === String(el.value || '1');
                return;
            }

            if (el.type === 'radio') {
                el.checked = String(nextValue) === String(el.value || '1');
                return;
            }

            if (el.tagName === 'SELECT' && el.multiple && Array.isArray(nextValue)) {
                Array.from(el.options).forEach((option) => {
                    option.selected = nextValue.includes(option.value);
                });
                return;
            }

            if (el.value !== nextValue) {
                el.value = nextValue;
            }
        });

        document.querySelectorAll(`[data-light-js-model="${key}"]`).forEach((el) => {
            if (el.hasAttribute('data-light-model')) {
                return;
            }

            if (el.value !== api.state[key]) {
                el.value = api.state[key] ?? '';
            }
        });

        document.querySelectorAll(`[data-light-js-bind="${key}"]`).forEach((el) => {
            el.innerText = api.state[key] ?? '';
        });

        document.querySelectorAll(`[data-light-js-html="${key}"]`).forEach((el) => {
            el.innerHTML = api.state[key] ?? '';
        });
    }

    // Run global (non-key-scoped) JS bindings — show/class/etc.
    // These are called ONCE per sync cycle, not per-key, for performance.
    function syncGlobalJsBindings() {
        let api = getJsApi();

        document.querySelectorAll('[data-light-js-show]').forEach((el) => {
            let expr = el.getAttribute('data-light-js-show');
            let isVisible = evalJsExpr(expr, api.state);
            if (isVisible) {
                let display =
                    el.getAttribute('data-light-js-display') ||
                    (el.classList.contains('inline-flex') ? 'inline-flex' : '') ||
                    (el.classList.contains('flex') ? 'flex' : '') ||
                    (el.classList.contains('inline-grid') ? 'inline-grid' : '') ||
                    (el.classList.contains('grid') ? 'grid' : '') ||
                    (el.classList.contains('inline-block') ? 'inline-block' : '') ||
                    (el.classList.contains('block') ? 'block' : '') ||
                    'block';
                el.style.display = display;
            } else {
                el.style.display = 'none';
            }
        });

        document.querySelectorAll('[data-light-js-class]').forEach((el) => {
            let expr = el.getAttribute('data-light-js-class');
            applyConditionalClasses(el, expr, api.state);
        });

        document.querySelectorAll('[data-light-class]:not([data-light-scoped="1"])').forEach((el) => {
            let expr = el.getAttribute('data-light-class');
            if (!expr) return;
            let classObj = parseClassExpression(expr);
            let evaluated = {};
            Object.entries(classObj).forEach(([className, condition]) => {
                if (typeof condition === 'string') {
                    evaluated[className] = !!evaluateLightExpression(condition, api.state);
                } else if (typeof condition === 'boolean') {
                    evaluated[className] = condition;
                }
            });
            Object.entries(evaluated).forEach(([className, shouldAdd]) => {
                if (shouldAdd) {
                    el.classList.add(className);
                } else {
                    el.classList.remove(className);
                }
            });
        });
    }

    function initJsState(scope = document) {
        let api = getJsApi();

        scope.querySelectorAll('[data-light-state]').forEach((el) => {
            let rawState = el.getAttribute('data-light-state');
            if (!rawState) return;

            try {
                let parsedJson = JSON.parse(rawState);
                if (typeof parsedJson === 'object' && parsedJson !== null) {
                    Object.entries(parsedJson).forEach(([key, value]) => {
                        api.state[key] = value;
                    });

                    return;
                }
            } catch (_) {
                // fallback to assignment syntax
            }

            let assignmentState = parseLightAssignments(rawState);
            Object.entries(assignmentState).forEach(([key, value]) => {
                api.state[key] = value;
            });

            if (!Object.keys(assignmentState).length) {
                // ignore invalid state syntax
            }
        });

        scope.querySelectorAll('[data-light-server-state]').forEach((el) => {
            let raw = el.getAttribute('data-light-server-state');
            if (!raw) return;

            try {
                let serverState = JSON.parse(raw);
                if (typeof serverState === 'object' && serverState !== null) {
                    Object.entries(serverState).forEach(([key, value]) => {
                        api.state[key] = value;
                    });
                }
            } catch (_) {
                // ignore invalid server state
            }
        });

        scope.querySelectorAll('[data-light-const]').forEach((el) => {
            let raw = el.getAttribute('data-light-const');
            if (!raw) return;

            let vars = parseLightAssignments(raw);
            Object.entries(vars).forEach(([key, value]) => {
                api.consts[key] = value;
            });
        });

        // Initialize from light:js:init directives
        scope.querySelectorAll('[data-light-js-init]').forEach((el) => {
            let raw = el.getAttribute('data-light-js-init');
            if (!raw) return;

            try {
                let initData = Function('"use strict"; return (' + raw + ')')();
                if (typeof initData === 'object' && initData !== null) {
                    Object.entries(initData).forEach(([key, value]) => {
                        if (!Object.prototype.hasOwnProperty.call(api.state, key)) {
                            api.state[key] = value;
                        }
                    });
                }
            } catch (_) {
                console.warn('Failed to parse light:js:init:', raw);
            }
        });

        scope.querySelectorAll('[data-light-js-model]').forEach((el) => {
            let key = el.dataset.lightJsModel;
            if (!key) return;

            if (el.hasAttribute('data-light-model')) {
                api.state[key] = getElementValue(el);
                return;
            }

            if (api.state[key] === undefined) {
                api.state[key] = getElementValue(el);
            }
        });

        scope.querySelectorAll('[data-light-model]').forEach((el) => {
            let key = el.dataset.lightModel;
            if (!key) return;

            if (api.state[key] === undefined) {
                api.state[key] = getElementValue(el);
            }
        });

        scope.querySelectorAll('[data-light-js-bind], [data-light-js-html]').forEach((el) => {
            let key = el.dataset.lightJsBind || el.dataset.lightJsHtml;
            if (!key) return;

            if (!Object.prototype.hasOwnProperty.call(api.state, key)) {
                api.state[key] = false;
            }
        });

        syncBindings();
    }

    function getRootRules() {
        let root = document.querySelector('[data-light-root]');
        if (!root) return {};
        let raw = root.getAttribute('data-light-server-rules');
        if (!raw) return {};

        try {
            return JSON.parse(raw) || {};
        } catch (_) {
            return {};
        }
    }

    function parseRuleList(ruleString) {
        return ruleString
            .split('|')
            .map((r) => r.trim())
            .filter(Boolean)
            .map((r) => {
                let parts = r.split(':');
                return {
                    name: parts[0],
                    params: parts[1] ? parts[1].split(',').map((p) => p.trim()) : [],
                };
            });
    }

    function normalizeRules(ruleDef) {
        if (!ruleDef) return [];

        if (Array.isArray(ruleDef)) {
            return ruleDef.flatMap((r) => normalizeRules(r));
        }

        if (typeof ruleDef === 'string') {
            return parseRuleList(ruleDef);
        }

        return [];
    }

    function getElementRules(el, rootRules) {
        if (el.dataset.lightRules) {
            return normalizeRules(el.dataset.lightRules);
        }

        if (el.dataset.lightJsRules) {
            return normalizeRules(el.dataset.lightJsRules);
        }

        let field = getFieldName(el);
        if (!field) return [];

        if (rootRules[field]) {
            return normalizeRules(rootRules[field]);
        }

        return [];
    }

    function formatFieldName(field) {
        return field.replace(/_/g, ' ');
    }

    function ruleMessage(rule, field, params) {
        let name = formatFieldName(field);

        switch (rule) {
            case 'required':
                return `The ${name} field is required.`;
            case 'email':
                return `The ${name} field must be a valid email address.`;
            case 'min':
                return `The ${name} field must be at least ${params[0]}.`;
            case 'max':
                return `The ${name} field may not be greater than ${params[0]}.`;
            case 'numeric':
                return `The ${name} field must be a number.`;
            default:
                return `The ${name} field is invalid.`;
        }
    }

    function validateValue(value, rule) {
        let name = rule.name;
        let params = rule.params || [];

        if (name === 'required') {
            if (Array.isArray(value)) return value.length > 0;
            return String(value ?? '').trim() !== '';
        }

        if (name === 'email') {
            if (String(value ?? '').trim() === '') return true;
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
        }

        if (name === 'numeric') {
            if (String(value ?? '').trim() === '') return true;
            return !isNaN(value) && value !== '';
        }

        if (name === 'min') {
            let min = Number(params[0] || 0);
            if (Array.isArray(value)) return value.length >= min;
            if (!isNaN(value)) return Number(value) >= min;
            return String(value ?? '').length >= min;
        }

        if (name === 'max') {
            let max = Number(params[0] || 0);
            if (Array.isArray(value)) return value.length <= max;
            if (!isNaN(value)) return Number(value) <= max;
            return String(value ?? '').length <= max;
        }

        return true;
    }

    function validateElement(el, rootRules) {
        let field = getFieldName(el);
        if (!field) return null;

        let rules = getElementRules(el, rootRules);
        if (!rules.length) return null;

        let value = getElementValue(el);
        let errors = [];

        rules.forEach((rule) => {
            if (!validateValue(value, rule)) {
                errors.push(ruleMessage(rule.name, field, rule.params));
            }
        });

        return { field, errors };
    }

    function setErrors(errors) {
        let api = getJsApi();
        api.errors = errors || {};
        renderErrors(api.errors);
    }

    function setFieldErrors(field, messages) {
        let api = getJsApi();
        api.errors = api.errors || {};

        if (messages && messages.length) {
            api.errors[field] = messages;
        } else {
            delete api.errors[field];
        }

        renderErrors(api.errors);
    }

    function clearErrors() {
        setErrors({});
    }

    function renderErrors(errors) {
        document.querySelectorAll('[data-light-error]').forEach((el) => {
            let field = el.dataset.lightError;
            let message = (errors && errors[field] && errors[field][0]) || '';

            if (message && el.dataset.lightErrorMessage) {
                message = el.dataset.lightErrorMessage;
            }

            el.innerText = message || '';
        });
    }

    function validateScope(scope) {
        let rootRules = getRootRules();
        let errors = {};

        scope.querySelectorAll('[data-light-js-model], [data-light-model], [data-light-js-rules], [data-light-rules]').forEach((el) => {
            let result = validateElement(el, rootRules);
            if (!result || !result.errors.length) return;
            errors[result.field] = result.errors;
        });

        if (Object.keys(errors).length) {
            setErrors(errors);
            return false;
        }

        clearErrors();
        return true;
    }

    function collect(scope = document) {
        let values = { ...getJsApi().state };

        scope.querySelectorAll('[data-light-model]').forEach((el) => {
            values[el.dataset.lightModel] = el.value ?? '';
        });
        return values;
    }

    function parse(exp) {
        let m = exp.match(/^(\w+)\((.*)\)$/);
        if (!m) return { action: exp, args: [] };

        let raw = (m[2] || '').trim();
        if (!raw) return { action: m[1], args: [] };

        try {
            return { action: m[1], args: JSON.parse('[' + raw + ']') };
        } catch (_) {
            return { action: m[1], args: raw.split(',').map((s) => s.trim()) };
        }
    }

    /**
     * Evaluate a JS expression with state variable substitution.
     * Used by light:js:show and light:js:class directives.
     * State variables are JSON-serialized inline for safe evaluation.
     */
    function evalJsExpr(expr, state) {
        try {
            let code = expr.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g, function (match) {
                if (match === 'true' || match === 'false' || match === 'null' || match === 'undefined') {
                    return match;
                }
                return Object.prototype.hasOwnProperty.call(state, match) ? JSON.stringify(state[match]) : match;
            });
            // Cache compiled function for this code string
            let fn = __exprCache.get(code);
            if (!fn) {
                fn = Function('"use strict"; return (' + code + ')');
                __exprCache.set(code, fn);
            }
            return fn();
        } catch (_) {
            return false;
        }
    }

    function parseClassExpression(expr) {
        try {
            if (expr.startsWith('{') && expr.endsWith('}')) {
                return Function('"use strict"; return (' + expr + ')')();
            }
            return {};
        } catch (_) {
            return {};
        }
    }

    function applyConditionalClasses(el, expr, state) {
        let classObj = parseClassExpression(expr);
        let evaluated = {};

        Object.entries(classObj).forEach(([className, condition]) => {
            if (typeof condition === 'string') {
                evaluated[className] = evalJsExpr(condition, state);
            } else if (typeof condition === 'boolean') {
                evaluated[className] = condition;
            }
        });

        Object.entries(evaluated).forEach(([className, shouldAdd]) => {
            if (shouldAdd) {
                el.classList.add(className);
            } else {
                el.classList.remove(className);
            }
        });
    }

    function normalizeLightExpression(expr) {
        if (typeof expr !== 'string') {
            return expr;
        }

        let normalized = expr.trim();

        if (normalized.startsWith('{{') && normalized.endsWith('}}')) {
            normalized = normalized.slice(2, -2).trim();
        }

        return normalized.replace(/\blight\./g, '');
    }

    /**
     * Evaluate a light expression (e.g. "showModal", "users.length > 0")
     * against the current state. Uses cached compiled Function objects
     * to avoid recreating closures on every call.
     *
     * Called by: syncLightTextBindings, syncLightConditionals, applyConditionalClasses,
     *            parseLightAssignments, applyScopedBindings
     */
    function evaluateLightExpression(expr, scopeState = null, extraScope = null) {
        let api = getJsApi();
        let state = Object.assign({}, api.consts || {}, scopeState || api.state || {});
        let extras = extraScope || {};
        let normalizedExpr = normalizeLightExpression(expr);

        try {
            // Cache the compiled Function by expression string to avoid GC pressure
            let fn = __exprCache.get(normalizedExpr);
            if (!fn) {
                fn = Function('state', 'scope', 'with(state){ with(scope){ return (' + normalizedExpr + '); } }');
                __exprCache.set(normalizedExpr, fn);
            }
            return fn(state, extras);
        } catch (_) {
            // Fallback: try direct property lookup for simple variable references
            try {
                if (Object.prototype.hasOwnProperty.call(state, normalizedExpr)) {
                    return state[normalizedExpr];
                }

                if (Object.prototype.hasOwnProperty.call(api.consts, normalizedExpr)) {
                    return api.consts[normalizedExpr];
                }
            } catch (_) {
                // ignore
            }

            return undefined;
        }
    }

    function parseLightAssignments(raw) {
        let out = {};

        if (!raw || !raw.trim()) {
            return out;
        }

        raw.split(',').map((part) => part.trim()).filter(Boolean).forEach((part) => {
            let index = part.indexOf('=');

            if (index === -1) {
                out[part] = true;
                return;
            }

            let key = part.slice(0, index).trim();
            let valueExpr = part.slice(index + 1).trim();
            let evaluated = evaluateLightExpression(valueExpr, getJsApi().state, out);
            out[key] = evaluated;
        });

        return out;
    }

    /**
     * Master sync function — updates all DOM bindings for a state key.
     *
     * When 'key' is provided, only elements bound to that key are updated.
     * When 'key' is null, ALL bindings are refreshed (used after batch updates).
     *
     * 'full' controls whether conditionals (light:if/show) and loops (light:for)
     * are also re-evaluated. Set to false for partial syncs during batch operations.
     *
     * Called by: api.set(), api.batch(), update(), flushSyncBindings()
     */
    function syncBindings(key, full = true) {
        if (key) {
            syncJsBindings(key);
        } else {
            let api = getJsApi();
            Object.keys(api.state).forEach((stateKey) => syncJsBindings(stateKey));
        }

        syncLightTextBindings(key);

        if (full) {
            syncGlobalJsBindings();
            syncLightConditionals();
            renderLightForTemplates();
            syncLightPaginate();
        }
    }

    let __pendingSyncFrame = null;
    let __pendingSyncKeys = new Set();

    function queueSyncBindings(key = null) {
        if (key) {
            __pendingSyncKeys.add(key);
        }

        if (__pendingSyncFrame) {
            return;
        }

        __pendingSyncFrame = requestAnimationFrame(() => {
            __pendingSyncFrame = null;

            let keys = Array.from(__pendingSyncKeys);
            __pendingSyncKeys.clear();

            if (!keys.length) {
                syncBindings();
                return;
            }

            keys.forEach((stateKey) => syncBindings(stateKey, false));
        });
    }

    function flushSyncBindings() {
        if (__pendingSyncFrame) {
            cancelAnimationFrame(__pendingSyncFrame);
            __pendingSyncFrame = null;
        }

        __pendingSyncKeys.clear();
        syncBindings();
    }

    function syncLightTextBindings(key) {
        let api = getJsApi();

        document.querySelectorAll('[data-light-text]:not([data-light-scoped="1"])').forEach((el) => {
            let expr = el.getAttribute('data-light-text');
            if (!expr) return;

            let value = evaluateLightExpression(expr, api.state);
            el.innerText = value == null ? '' : String(value);
        });

        if (!key) {
            return;
        }
    }

    function syncLightConditionals() {
        let api = getJsApi();

        document.querySelectorAll('[data-light-show]:not([data-light-scoped="1"]), [data-light-if]:not([data-light-scoped="1"])').forEach((el) => {
            let expr = el.getAttribute('data-light-show') || el.getAttribute('data-light-if');
            if (!expr) return;

            let visible = !!evaluateLightExpression(expr, api.state);
            let display =
                el.getAttribute('data-light-display') ||
                (el.classList.contains('inline-flex') ? 'inline-flex' : '') ||
                (el.classList.contains('flex') ? 'flex' : '') ||
                (el.classList.contains('inline-grid') ? 'inline-grid' : '') ||
                (el.classList.contains('grid') ? 'grid' : '') ||
                (el.classList.contains('inline-block') ? 'inline-block' : '') ||
                (el.classList.contains('block') ? 'block' : '') ||
                'block';

            el.style.display = visible ? display : 'none';
        });
    }

    function applyScopedBindings(root, scopeState) {
        if (!root || !root.querySelectorAll) return;

        function scopedElements(selector) {
            let list = [];

            if (typeof root.matches === 'function' && root.matches(selector)) {
                list.push(root);
            }

            if (typeof root.querySelectorAll === 'function') {
                list.push(...Array.from(root.querySelectorAll(selector)));
            }

            return list;
        }

        function splitCallArgs(rawArgs) {
            let args = [];
            let current = '';
            let depth = 0;
            let quote = null;

            for (let i = 0; i < rawArgs.length; i++) {
                let ch = rawArgs[i];

                if (quote) {
                    current += ch;
                    if (ch === quote && rawArgs[i - 1] !== '\\') {
                        quote = null;
                    }
                    continue;
                }

                if (ch === '"' || ch === "'") {
                    quote = ch;
                    current += ch;
                    continue;
                }

                if (ch === '(' || ch === '[' || ch === '{') {
                    depth++;
                    current += ch;
                    continue;
                }

                if (ch === ')' || ch === ']' || ch === '}') {
                    depth = Math.max(0, depth - 1);
                    current += ch;
                    continue;
                }

                if (ch === ',' && depth === 0) {
                    if (current.trim() !== '') {
                        args.push(current.trim());
                    }
                    current = '';
                    continue;
                }

                current += ch;
            }

            if (current.trim() !== '') {
                args.push(current.trim());
            }

            return args;
        }

        function resolveScopedAction(rawCall) {
            if (!rawCall) return rawCall;

            let match = rawCall.trim().match(/^([A-Za-z_$][\w$]*)\((.*)\)$/);
            if (!match) {
                return rawCall;
            }

            let action = match[1];
            let rawArgs = match[2].trim();

            if (rawArgs === '') {
                return action;
            }

            let args = splitCallArgs(rawArgs).map((argExpr) => evaluateLightExpression(normalizeLightExpression(argExpr), scopeState));
            let serialized = args.map((value) => JSON.stringify(value)).join(',');

            return `${action}(${serialized})`;
        }

        function resolveScopedFunction(rawExpr) {
            if (!rawExpr) return rawExpr;

            let expr = rawExpr.trim();
            let open = expr.indexOf('(');
            let close = expr.lastIndexOf(')');

            if (open !== -1 && close === expr.length - 1) {
                expr = expr.slice(open + 1, close).trim();
            }

            let parts = splitCallArgs(expr);

            let resolved = parts.map((part) => {
                let eq = part.indexOf('=');
                if (eq === -1) {
                    return part;
                }

                let key = part.slice(0, eq).trim();
                let rhs = part.slice(eq + 1).trim();
                let value = evaluateLightExpression(rhs, scopeState);

                return `${key}=${JSON.stringify(value)}`;
            });

            return resolved.join(',');
        }

        scopedElements('[data-light-text]').forEach((el) => {
            el.setAttribute('data-light-scoped', '1');
            let expr = el.getAttribute('data-light-text');
            if (!expr) return;

            let value = evaluateLightExpression(expr, scopeState);
            el.innerText = value == null ? '' : String(value);
        });

        scopedElements('[data-light-show], [data-light-if]').forEach((el) => {
            el.setAttribute('data-light-scoped', '1');
            let expr = el.getAttribute('data-light-show') || el.getAttribute('data-light-if');
            if (!expr) return;

            let visible = !!evaluateLightExpression(expr, scopeState);
            let display =
                el.getAttribute('data-light-display') ||
                (el.classList.contains('inline-flex') ? 'inline-flex' : '') ||
                (el.classList.contains('flex') ? 'flex' : '') ||
                (el.classList.contains('inline-grid') ? 'inline-grid' : '') ||
                (el.classList.contains('grid') ? 'grid' : '') ||
                (el.classList.contains('inline-block') ? 'inline-block' : '') ||
                (el.classList.contains('block') ? 'block' : '') ||
                'block';

            el.style.display = visible ? display : 'none';
        });

        scopedElements('[data-light-class]').forEach((el) => {
            el.setAttribute('data-light-scoped', '1');
            let expr = el.getAttribute('data-light-class');
            if (!expr) return;

            let classObj = parseClassExpression(expr);
            Object.entries(classObj).forEach(([className, condition]) => {
                let shouldAdd = false;

                if (typeof condition === 'string') {
                    shouldAdd = !!evaluateLightExpression(condition, scopeState);
                } else if (typeof condition === 'boolean') {
                    shouldAdd = condition;
                }

                if (shouldAdd) {
                    el.classList.add(className);
                } else {
                    el.classList.remove(className);
                }
            });
        });

        scopedElements('[data-light-click]').forEach((el) => {
            let action = el.getAttribute('data-light-click');
            if (!action) return;

            el.setAttribute('data-light-click', resolveScopedAction(action));
        });

        scopedElements('[data-light-function]').forEach((el) => {
            let expr = el.getAttribute('data-light-function');
            if (!expr) return;

            el.setAttribute('data-light-function', resolveScopedFunction(expr));
        });
    }

    /**
     * Render light:for loop templates.
     *
     * Processes elements with data-light-for="item in list" directive:
     *   1. Evaluates the source expression to get the array
     *   2. Removes previously rendered nodes
     *   3. Clones the template for each item with scoped bindings
     *   4. Inserts rendered nodes after the template element
     *
     * Supports both <template> and regular elements as loop templates.
     * The template element itself is hidden; only cloned children are visible.
     *
     * Scoped bindings (applyScopedBindings) resolve item.property, $index etc.
     * within each cloned instance.
     *
     * @see Patch.php — insert/update/delete operations that modify the list
     * @see applyScopedBindings() — resolves per-item bindings in clones
     */
    function renderLightForTemplates() {
        let api = getJsApi();

        document.querySelectorAll('[data-light-for]').forEach((node) => {
            let expr = node.getAttribute('data-light-for') || '';
            let match = expr.match(/^\s*([A-Za-z_$][\w$]*)\s+in\s+(.+)\s*$/);
            if (!match || !node.parentNode) return;

            let itemName = match[1];
            let sourceExpr = match[2];
            let list = evaluateLightExpression(sourceExpr, api.state);

            // Handle Laravel paginator object (extract .data layer automatically)
            if (list && typeof list === 'object' && !Array.isArray(list) && 'data' in list && 'current_page' in list) {
                list = list.data;
            }

            // Normalize: convert plain objects to arrays (for Object.values support)
            if (list && typeof list === 'object' && !Array.isArray(list)) {
                list = Object.values(list);
            }

            if (!Array.isArray(list)) {
                list = [];
            }

            // Performance: skip full re-render if array reference + length unchanged.
            // This is critical for 5000+ items — light:function (client-side) state
            // changes that don't touch this array won't trigger expensive DOM rebuilds.
            if (node._lightForLastRef === list && node._lightForLastLen === list.length) {
                return; // Array unchanged, skip
            }
            node._lightForLastRef = list;
            node._lightForLastLen = list.length;

            let isTemplate = node.tagName === 'TEMPLATE';

            // Cache the template node/HTML on first render so we can clone from it
            if (!isTemplate) {
                node.style.display = 'none';

                if (!node._lightForTemplateNode) {
                    node._lightForTemplateNode = node.cloneNode(true);
                    node._lightForTemplateNode.removeAttribute('data-light-for');
                }
            } else if (!node._lightForSourceHtml) {
                node._lightForSourceHtml = node.innerHTML;
            }

            // Remove all previously rendered nodes before re-rendering
            if (node._lightRenderedNodes && node._lightRenderedNodes.length) {
                node._lightRenderedNodes.forEach((renderedNode) => renderedNode.remove());
            }

            // Build new DOM nodes from the template for each list item
            let wrapper = document.createDocumentFragment();
            let nodes = [];

            list.forEach((item, index) => {
                // Scope: merge global state + current item + index
                let scope = Object.assign({}, api.consts || {}, api.state || {}, {
                    [itemName]: item,
                    index,
                    $index: index,
                });

                if (isTemplate) {
                    let fragment = document.createRange().createContextualFragment(node._lightForSourceHtml || '');
                    applyScopedBindings(fragment, scope);

                    let childNodes = Array.from(fragment.childNodes);
                    childNodes.forEach((child) => wrapper.appendChild(child));
                    nodes.push(...childNodes);

                    return;
                }

                let clone = node._lightForTemplateNode.cloneNode(true);
                clone.removeAttribute('data-light-for');
                clone.removeAttribute('data-light-scoped');
                clone.style.display = '';

                applyScopedBindings(clone, scope);
                wrapper.appendChild(clone);
                nodes.push(clone);
            });

            // Insert all nodes at once (single DOM write via fragment)
            node.after(wrapper);
            node._lightRenderedNodes = nodes;
        });
    }

    // --- light:paginate → render pagination UI directly from Laravel Paginator JSON ---
    function syncLightPaginate() {
        let api = getJsApi();
        
        document.querySelectorAll('[data-light-paginate]').forEach((node) => {
            let key = node.getAttribute('data-light-paginate');
            if (!key) return;

            let actionName = node.getAttribute('data-light-paginate-action')
                || node.closest('[data-light-submit]')?.getAttribute('data-light-submit')
                || node.closest('[data-light-click]')?.getAttribute('data-light-click');
            let paginator = api.state[key];

            // Defensive: if no paginator or not a valid paginator object, hide gracefully
            if (!paginator || typeof paginator !== 'object' || Array.isArray(paginator)) {
                node.innerHTML = '';
                return;
            }

            // Must have at minimum current_page and data array to be a valid paginator
            if (!('current_page' in paginator) || !('data' in paginator)) {
                node.innerHTML = '';
                return;
            }

            // Let user build their own UI via light:for and light:click 
            if (node.hasAttribute('data-light-paginate-custom')) {
                let val = node.getAttribute('data-light-paginate-custom');
                if (val !== 'false' && val !== '0') return;
            }

            // Don't re-render if it's the exact same paginator reference
            if (node._lightPaginateLastRef === paginator && node._lightPaginateLastPage === paginator.current_page) return;
            node._lightPaginateLastRef = paginator;
            node._lightPaginateLastPage = paginator.current_page;

            // Helper to safely extract page number from a URL string
            function safePageFromUrl(url) {
                if (!url) return null;
                try {
                    return new URL(url, window.location.href).searchParams.get('page');
                } catch (_) {
                    // Fallback: regex extract
                    let m = String(url).match(/[?&]page=(\d+)/);
                    return m ? m[1] : null;
                }
            }

            // Check if links array is available (paginate() provides it, simplePaginate() doesn't)
            let hasLinks = Array.isArray(paginator.links) && paginator.links.length > 0;
            let lastPage = paginator.last_page || 1;
            let currentPage = paginator.current_page || 1;

            // Stop if only 1 page
            if (lastPage <= 1 && !paginator.next_page_url) {
                node.innerHTML = '';
                return;
            }

            let html = `<div class="lv-pagination flex items-center justify-between border-t border-gray-200 px-4 py-3 sm:px-6 mt-4">`;
            
            // Mobile (Prev/Next)
            html += `<div class="flex flex-1 justify-between sm:hidden">`;
            let prevPage = paginator.prev_page_url ? safePageFromUrl(paginator.prev_page_url) : null;
            let nextPage = paginator.next_page_url ? safePageFromUrl(paginator.next_page_url) : null;
            
            if (prevPage) {
                html += `<button type="button" data-lv-page="${prevPage}" class="lv-paginate-btn relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Previous</button>`;
            } else {
                html += `<span class="relative inline-flex items-center rounded-md border border-gray-300 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-400 cursor-not-allowed">Previous</span>`;
            }
            if (nextPage) {
                html += `<button type="button" data-lv-page="${nextPage}" class="lv-paginate-btn relative ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Next</button>`;
            } else {
                html += `<span class="relative ml-3 inline-flex items-center rounded-md border border-gray-300 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-400 cursor-not-allowed">Next</span>`;
            }
            html += `</div>`;

            // Desktop view
            html += `<div class="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                <div>
                    <p class="text-sm text-gray-700">Showing <span class="font-medium">${paginator.from || 0}</span> to <span class="font-medium">${paginator.to || 0}</span> of <span class="font-medium">${paginator.total || '?'}</span> results</p>
                </div>
                <div>
                    <nav class="isolate inline-flex -space-x-px rounded-md shadow-sm bg-white" aria-label="Pagination">`;

            if (hasLinks) {
                paginator.links.forEach((link, idx) => {
                    if (!link || typeof link !== 'object') return;
                    let isFirst = idx === 0;
                    let isLast = idx === paginator.links.length - 1;
                    
                    let roundedClass = isFirst ? 'rounded-l-md' : (isLast ? 'rounded-r-md' : '');
                    let rawLabel = String(link.label || '')
                        .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
                        .replace('Previous', '«').replace('Next', '»');
                    
                    if (!link.url) {
                        html += `<span class="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-400 ring-1 ring-inset ring-gray-300 ${roundedClass}">${rawLabel}</span>`;
                    } else if (link.active) {
                        html += `<span class="relative z-10 inline-flex items-center bg-indigo-600 px-4 py-2 text-sm font-semibold text-white focus:z-20 ${roundedClass}">${rawLabel}</span>`;
                    } else {
                        let pageStr = safePageFromUrl(link.url) || '1';
                        html += `<button type="button" data-lv-page="${pageStr}" class="lv-paginate-btn relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 ${roundedClass}">${rawLabel}</button>`;
                    }
                });
            } else {
                // Fallback for simplePaginate (no links array)
                if (prevPage) {
                    html += `<button type="button" data-lv-page="${prevPage}" class="lv-paginate-btn relative inline-flex items-center rounded-l-md px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">«</button>`;
                }
                html += `<span class="relative z-10 inline-flex items-center bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">${currentPage}</span>`;
                if (nextPage) {
                    html += `<button type="button" data-lv-page="${nextPage}" class="lv-paginate-btn relative inline-flex items-center rounded-r-md px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">»</button>`;
                }
            }

            html += `</nav></div></div></div>`;
            node.innerHTML = html;

            // Attach event listeners
            node.querySelectorAll('.lv-paginate-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    let pageNum = parseInt(btn.getAttribute('data-lv-page'), 10);
                    if (isNaN(pageNum) || pageNum < 1) return;

                    if (!actionName) {
                        // No action specified — try URL-based navigation as fallback
                        let url = new URL(window.location.href);
                        url.searchParams.set('page', pageNum);
                        window.location.href = url.toString();
                        return;
                    }
                    
                    call(actionName, { page: pageNum });
                });
            });
        });
    }

    /**
     * Apply light:function inline assignments — no server round-trip.
     * Parses expressions like "showModal=true, name=''" and updates state directly.
     * This is the "client-side-first" approach: simple state changes happen instantly.
     *
     * @see Directives.php — transforms light:function="..." → data-light-function="..."
     */
    function applyFunctionAssignments(raw, api) {
        if (!raw) return;

        let expr = raw.trim();

        // Strip wrapping parentheses: "name(x=1, y=2)" → "x=1, y=2"
        let open = expr.indexOf('(');
        let close = expr.lastIndexOf(')');
        if (open !== -1 && close === expr.length - 1) {
            expr = expr.slice(open + 1, close).trim();
        }

        let updates = parseLightAssignments(expr);

        Object.entries(updates).forEach(([key, value]) => {
            api.set(key, value);
        });
    }

    function isInlineAssignmentExpression(raw) {
        if (!raw || typeof raw !== 'string') {
            return false;
        }

        let expr = raw.trim();
        if (!expr) return false;

        return expr.includes('=');
    }

    function normalizeStoredPayload(payload, fallbackKey = 'data') {
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            return payload;
        }

        if (Array.isArray(payload)) {
            return { data: payload };
        }

        if (payload === null || payload === undefined) {
            return {};
        }

        return { [fallbackKey || 'value']: payload };
    }

    function applyStoredPayload(payload, fallbackKey = 'data') {
        let api = getJsApi();
        let normalized = normalizeStoredPayload(payload, fallbackKey);

        api.batch(() => {
            Object.entries(normalized).forEach(([k, v]) => {
                if (k.startsWith('__')) {
                    return;
                }

                api.state[k] = v;
            });
        });

        return normalized;
    }

    function invokeCustomFunction(name, args = [], context = {}) {
        let fn = window[name] || window.Lightvel?.functions?.[name];
        let api = getJsApi();

        if (typeof fn !== 'function') {
            if (isInlineAssignmentExpression(name)) {
                applyFunctionAssignments(name, api);
                queueSyncBindings();
                return;
            }

            console.warn('Lightvel function not found:', name);
            return;
        }

        let result = fn(...args, {
            event: context.event || null,
            el: context.el || null,
            state: api.state,
            set: api.set,
            get: api.get,
            batch: api.batch,
            api,
        });

        if (result && typeof result.then === 'function') {
            result.then((resolved) => {
                applyStoredPayload(resolved, name);
            }).catch((err) => {
                console.error('Lightvel function failed:', err);
            });

            return;
        }

        if (result !== undefined) {
            applyStoredPayload(result, name);
            return;
        }

        syncBindings();
    }

    let __actionDebounceTimers = {};
    let __activeControllers = {};
    let __responseCache = {};
    let __defaultDebounceDelay = Number(getConfig().debounceDelay || 0);

    function parseDurationMs(value, fallback = 0) {
        if (value === null || value === undefined || value === '') {
            return fallback;
        }

        if (typeof value === 'number' && !isNaN(value)) {
            return Math.max(0, Math.floor(value));
        }

        let raw = String(value).trim().toLowerCase();
        if (!raw) return fallback;

        if (/^\d+$/.test(raw)) {
            return Math.max(0, parseInt(raw, 10));
        }

        let match = raw.match(/^(\d+(?:\.\d+)?)(ms|s)$/);
        if (!match) {
            return fallback;
        }

        let amount = parseFloat(match[1]);
        if (isNaN(amount)) {
            return fallback;
        }

        if (match[2] === 's') {
            return Math.max(0, Math.round(amount * 1000));
        }

        return Math.max(0, Math.round(amount));
    }

    function parseBoolean(value, fallback = false) {
        if (value === null || value === undefined || value === '') {
            return fallback;
        }

        let raw = String(value).trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
        if (['0', 'false', 'no', 'off'].includes(raw)) return false;

        return fallback;
    }

    function getElementDebounceMs(el) {
        if (!el) return __defaultDebounceDelay;
        return parseDurationMs(el.getAttribute('data-light-debounce'), __defaultDebounceDelay);
    }

    /**
     * Dispatch an action with optional debounce.
     * The debounce prevents rapid-fire calls (e.g. search-on-type).
     * Without debounce, calls sendLightAction immediately.
     *
     * @param {string} action - Server-side method name (e.g. 'saveUser')
     * @param {object} params - Data to send (form values, IDs, etc.)
     * @param {object} options - {debounceMs, debounceKey, cache, cancelKey}
     */
    function call(action, params = {}, options = {}) {
        let debounceMs = parseDurationMs(options.debounceMs, __defaultDebounceDelay);
        let debounceKey = options.debounceKey || action;

        if (debounceMs <= 0) {
            return sendLightAction(action, params, options);
        }

        if (__actionDebounceTimers[debounceKey]) {
            clearTimeout(__actionDebounceTimers[debounceKey]);
        }

        __actionDebounceTimers[debounceKey] = setTimeout(() => {
            delete __actionDebounceTimers[debounceKey];
            sendLightAction(action, params, options);
        }, debounceMs);

        return null;
    }

    function triggerLiveModelAction(modelEl) {
        if (!modelEl || !modelEl.hasAttribute('data-light-model-live')) {
            return;
        }

        let form = modelEl.closest('form[data-light-submit]');
        if (!form) {
            return;
        }

        if (!validateScope(form)) {
            return;
        }

        let action = form.dataset.lightSubmit;
        if (!action) {
            return;
        }

        let data = {
            ...collect(form),
            ...Object.fromEntries(new FormData(form).entries()),
        };

        call(action, data, {
            debounceMs: getElementDebounceMs(modelEl),
            debounceKey: `model-live:${action}`,
        });
    }

    /**
     * Send an AJAX POST to the Lightvel proxy endpoint.
     *
     * Flow:
     *   1. Read endpoint URL from data-light-root (set by Compiler.php)
     *   2. POST {url, action, params, component, fingerprint} as JSON
     *   3. RouteServiceProvider receives this and forwards to the component
     *   4. Component.run() invokes the action method and returns JSON
     *   5. Response is passed to update() which merges state + re-renders
     *
     * Features:
     *   - Response caching (optional, for read-heavy actions)
     *   - Request cancellation via AbortController (prevents stale responses)
     *   - Automatic error handling with state.status and state.message
     *
     * @see RouteServiceProvider.php — receives this POST request
     * @see Component.php::run() — processes the action server-side
     * @see update() — handles the JSON response
     */
    function sendLightAction(action, params = {}, options = {}) {
        let csrfToken = document.querySelector('meta[name=csrf-token]')?.content || '';
        let root = document.querySelector('[data-light-root]');
        let endpoint = root?.dataset.lightEndpoint || getConfig().messageEndpoint || '/lightvel/message';
        let component = root?.dataset.lightComponent || '';
        let fingerprint = root?.dataset.lightFingerprint || '';

        // Optional response caching (e.g. for autocomplete results)
        let cacheEnabled = !!options.cache;
        let cacheTtlMs = parseDurationMs(options.cacheTtlMs, 10000);
        let cacheKey = options.cacheKey || `${action}:${JSON.stringify(params)}`;

        if (cacheEnabled && __responseCache[cacheKey] && __responseCache[cacheKey].expiresAt > Date.now()) {
            update(__responseCache[cacheKey].payload, action);

            if (!options.refreshCache) {
                return Promise.resolve(__responseCache[cacheKey].payload);
            }
        }

        let controller = null;
        let cancelKey = options.cancelKey || null;

        if (cancelKey && typeof AbortController !== 'undefined') {
            if (__activeControllers[cancelKey]) {
                __activeControllers[cancelKey].abort();
            }

            controller = new AbortController();
            __activeControllers[cancelKey] = controller;
        }

        // --- Loading: show indicators ---
        __lightLoadingCount++;
        __loadingStartTime = Date.now();
        syncLoadingElements(true, action);

        return fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRF-TOKEN': csrfToken,
                'X-Light': 'true',
                'X-Light-Component': component,
                'X-Light-Fingerprint': fingerprint,
            },
            signal: controller ? controller.signal : undefined,
            body: JSON.stringify({
                url: window.location.href,
                action,
                params,
                component,
                fingerprint,
            }),
        })
            .then(async (r) => {
                let contentType = r.headers.get('Content-Type') || '';
                let isJson = contentType.includes('application/json');
                let payload = null;

                if (isJson) {
                    try {
                        payload = await r.json();
                    } catch (_) {
                        payload = null;
                    }
                } else {
                    try {
                        let raw = await r.text();
                        let parsed = JSON.parse(raw);
                        if (parsed && typeof parsed === 'object') {
                            payload = parsed;
                        }
                    } catch (_) {
                        payload = null;
                    }
                }

                if (!r.ok) {
                    if (payload && typeof payload === 'object') {
                        update(payload, action);
                        return null;
                    }

                    let body = '';
                    try {
                        body = await r.text();
                    } catch (_) {
                        body = '';
                    }

                    throw new Error('Request failed with status ' + r.status + (body ? ' :: ' + body : ''));
                }

                return payload;
            })
            .then((payload) => {
                if (payload !== null && payload !== undefined) {
                    if (cacheEnabled && payload && typeof payload === 'object') {
                        __responseCache[cacheKey] = {
                            payload,
                            expiresAt: Date.now() + cacheTtlMs,
                        };
                    }

                    update(payload, action);
                }

                return payload;
            })
            .catch((err) => {
                if (err && err.name === 'AbortError') {
                    return null;
                }

                console.error('Lightvel request failed:', err);

                let api = getJsApi();
                api.state.status = false;
                api.state.message = err?.message || 'Lightvel request failed';
                
                try {
                    syncBindings();
                } catch (renderErr) {
                    console.error('Lightvel failed to synchronize error state to the DOM:', renderErr);
                }
                
                setErrors({ __global: [api.state.message] });

                document.querySelectorAll('[data-light-bind="status"]').forEach((el) => {
                    el.innerText = 'Request failed. Check console/logs.';
                });
            })
            .finally(() => {
                if (cancelKey && __activeControllers[cancelKey] === controller) {
                    delete __activeControllers[cancelKey];
                }

                // --- Loading: hide indicators ---
                __lightLoadingCount = Math.max(0, __lightLoadingCount - 1);
                if (__lightLoadingCount === 0) {
                    syncLoadingElements(false, action);
                }
            });
    }

    window.Lightvel = window.Lightvel || {};
    window.Lightvel.debounceDelay = __defaultDebounceDelay;
    window.Lightvel.setDebounceDelay = function (value) {
        __defaultDebounceDelay = parseDurationMs(value, 0);
        window.Lightvel.debounceDelay = __defaultDebounceDelay;
    };
    window.Lightvel.clearCache = function () {
        __responseCache = {};
    };
    window.Lightvel.pageFromUrl = function (url) {
        if (!url) return null;
        try {
            return new URL(url, window.location.href).searchParams.get('page');
        } catch (_) {
            return null;
        }
    };

    function refreshCurrentComponent() {
        let api = getJsApi();
        let root = document.querySelector('[data-light-root]');
        let url = window.location.href.split('#')[0];
        let preservedState = {
            message: api.state?.message,
            status: api.state?.status,
            showModal: api.state?.showModal,
        };

        return fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'X-Requested-With': 'XMLHttpRequest',
            },
        })
            .then(async (r) => {
                if (!r.ok) {
                    throw new Error('Refresh failed with status ' + r.status);
                }

                return r.text();
            })
            .then((html) => {
                let wrap = document.createElement('div');
                wrap.innerHTML = html;
                let nextRoot = wrap.querySelector('[data-light-root]');

                if (nextRoot && root) {
                    root.replaceWith(nextRoot);
                } else {
                    window.location.reload();
                    return;
                }

                initJsState(document);

                let nextApi = getJsApi();
                Object.entries(preservedState).forEach(([key, value]) => {
                    if (value !== undefined) {
                        nextApi.state[key] = value;
                    }
                });

                syncBindings();
                renderErrors(nextApi.errors || {});
            })
            .catch((err) => {
                console.error('Lightvel patch refresh failed:', err);
            });
    }

    /**
     * Match items by their 'id' field for patch operations.
     * Patch operations (insert/update/delete) use this to find which
     * item in the array to modify.
     */
    function findPatchItemId(item) {
        if (!item || typeof item !== 'object') return undefined;
        return item.id;
    }

    /**
     * Apply __patch operations to client-side state arrays.
     * This is the key to avoiding full page refreshes after CRUD operations:
     *   - delete: filter out items matching the given IDs
     *   - update: merge new fields into existing items (matched by id)
     *   - insert: prepend new items, deduplicating by id
     *
     * @see Patch.php — generates the __patch payload on the server
     */
    function applyPatchOperations(api, patchData) {
        if (!patchData || typeof patchData !== 'object') return;

        let dirty = false;

        Object.entries(patchData).forEach(([resource, actions]) => {
            if (!actions || typeof actions !== 'object') return;

            // Handle paginated targets implicitly
            let targetArray = api.state[resource];
            let isPaginator = false;

            if (targetArray && typeof targetArray === 'object' && !Array.isArray(targetArray) && 'data' in targetArray && 'current_page' in targetArray) {
                targetArray = targetArray.data;
                isPaginator = true;
            }

            if (!Array.isArray(targetArray)) {
                if (targetArray && typeof targetArray === 'object') {
                    targetArray = Object.values(targetArray);
                    dirty = true;
                } else {
                    return; // Skip invalid patch targets
                }
            }

            if (Array.isArray(actions.delete) && actions.delete.length) {
                let deleteIds = new Set(actions.delete.map((id) => String(id)));
                targetArray = targetArray.filter((item) => {
                    let id = findPatchItemId(item);
                    if (id === undefined || id === null) return true;
                    return !deleteIds.has(String(id));
                });
                dirty = true;
            }

            if (Array.isArray(actions.update) && actions.update.length) {
                let updatesById = new Map();

                actions.update.forEach((item) => {
                    let id = findPatchItemId(item);
                    if (id === undefined || id === null) return;
                    updatesById.set(String(id), item);
                });

                targetArray = targetArray.map((item) => {
                    let id = findPatchItemId(item);
                    if (id === undefined || id === null) return item;

                    let updated = updatesById.get(String(id));
                    if (!updated || typeof updated !== 'object') {
                        return item;
                    }

                    if (!item || typeof item !== 'object') {
                        return updated;
                    }

                    return { ...item, ...updated };
                });
                dirty = true;
            }

            if (Array.isArray(actions.insert) && actions.insert.length) {
                let insertItems = actions.insert.filter((item) => item && typeof item === 'object');
                if (!insertItems.length) return;

                let insertIds = new Set(
                    insertItems
                        .map((item) => findPatchItemId(item))
                        .filter((id) => id !== undefined && id !== null)
                        .map((id) => String(id))
                );

                let rest = targetArray.filter((item) => {
                    let id = findPatchItemId(item);
                    if (id === undefined || id === null) return true;
                    return !insertIds.has(String(id));
                });

                targetArray = [...insertItems, ...rest];
                dirty = true;
            }

            if (isPaginator) {
                if (dirty) api.state[resource] = { ...api.state[resource], data: [...targetArray] };
            } else if (dirty) {
                api.state[resource] = [...targetArray];
            }
        });

        return dirty;
    }

    /**
     * Process a server response and update client state.
     *
     * Handles the complete response lifecycle:
     *   1. Unwrap envelope ({data: ...}) if present
     *   2. Extract and display __lightvel_errors (validation errors)
     *   3. Update status/message state from response
     *   4. Apply __lightvel_dom (full DOM replacement, rare)
     *   5. Apply __patch operations (surgical array mutations)
     *   6. Merge remaining keys into api.state
     *   7. Flush all DOM bindings to reflect new state
     *
     * After patching: calls refreshCurrentComponent() to re-render light:for
     * templates with the updated data from the server.
     *
     * @see sendLightAction() — calls this with the server response
     * @see applyPatchOperations() — handles __patch for insert/update/delete
     */
    function update(data, fallbackKey = 'data') {
        let api = getJsApi();
        let payload = normalizeStoredPayload(data, fallbackKey);
        let hasFieldErrors = false;
        let hasPatch = false;

        if (
            payload
            && payload.data
            && typeof payload.data === 'object'
            && !Array.isArray(payload.data)
        ) {
            payload = {
                ...payload,
                ...payload.data,
            };

            delete payload.data;
        }


        if (payload.__lightvel_errors !== undefined) {
            setErrors(payload.__lightvel_errors || {});
            hasFieldErrors = !!(payload.__lightvel_errors && Object.keys(payload.__lightvel_errors).length);
            delete payload.__lightvel_errors;
        } else if (payload.errors && typeof payload.errors === 'object') {
            setErrors(payload.errors || {});
            hasFieldErrors = !!Object.keys(payload.errors || {}).length;
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'message')) {
            api.state.message = payload.message ?? '';
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
            api.state.status = payload.status;

            if (payload.status === false && payload.message) {
                if (!hasFieldErrors) {
                    setErrors({ __global: [String(payload.message)] });
                }
            }
        }


        if (payload.__lightvel_dom) {
            let wrap = document.createElement('div');
            wrap.innerHTML = payload.__lightvel_dom;
            let nextRoot = wrap.firstElementChild;
            let currentRoot = document.querySelector('[data-light-root]');

            if (nextRoot && currentRoot) {
                currentRoot.replaceWith(nextRoot);
            }

            initJsState(document);
            renderErrors(getJsApi().errors || {});

            return;
        }

        if (payload.__patch !== undefined) {
            applyPatchOperations(api, payload.__patch);
            delete payload.__patch;
            hasPatch = true;
        }

        Object.entries(payload).forEach(([k, v]) => {
            if (k.startsWith('__')) {
                return;
            }
            api.state[k] = v;
        });

        flushSyncBindings();

        // Re-render errors AFTER flushSyncBindings because DOM rebuild
        // (light:for) creates new elements that need error messages applied.
        if (hasFieldErrors || api.errors) {
            renderErrors(api.errors || {});
        }
    }

    /**
     * Show or hide loading indicator elements.
     *
     * Supports:
     *   - data-light-loading: basic show/hide during ANY AJAX
     *   - data-light-loading-target="actionName": show ONLY when that specific action runs
     *   - data-light-loading-delay="500": show only after delay ms (avoids flash for fast requests)
     *   - data-light-loading-min="1000": show for at least min ms
     *
     * Usage in Blade:
     *   <div light:loading>Loading...</div>                               ← global (all AJAX)
     *   <span light:loading light:loading.target="deleteUser">...</span>  ← only during deleteUser()
     *   <div light:loading light:loading.delay="300" light:loading.min="1000">Please wait...</div>
     *   <div light:loading class="lightvel-spinner"></div>  (uses default spinner CSS)
     */
    function syncLoadingElements(isLoading, actionName) {
        document.querySelectorAll('[data-light-loading]').forEach((el) => {
            let target = el.getAttribute('data-light-loading-target') || '';
            
            // If this element has a target, only activate it for that specific action
            if (target && actionName && target !== actionName) {
                return; // Skip — this element is for a different action
            }
            
            // If this element has a target but no action name provided (e.g. hiding all), still process
            // If no target, it's a global loader — always processes

            let delayMs = parseInt(el.getAttribute('data-light-loading-delay') || '0', 10) || 0;
            let minMs = parseInt(el.getAttribute('data-light-loading-min') || '0', 10) || 0;

            if (isLoading) {
                // Clear any pending hide
                if (__loadingDelayTimers.has(el)) {
                    clearTimeout(__loadingDelayTimers.get(el));
                    __loadingDelayTimers.delete(el);
                }

                if (delayMs > 0) {
                    // Delay: show only if request takes longer than delay
                    let timer = setTimeout(() => {
                        el.setAttribute('data-light-loading-active', 'true');
                        __loadingDelayTimers.delete(el);
                        if (minMs > 0) {
                            __loadingMinEndTimes.set(el, Date.now() + minMs);
                        }
                    }, delayMs);
                    __loadingDelayTimers.set(el, timer);
                } else {
                    el.setAttribute('data-light-loading-active', 'true');
                    if (minMs > 0) {
                        __loadingMinEndTimes.set(el, Date.now() + minMs);
                    }
                }
            } else {
                // Cancel any pending delay-show
                if (__loadingDelayTimers.has(el)) {
                    clearTimeout(__loadingDelayTimers.get(el));
                    __loadingDelayTimers.delete(el);
                }

                let minEnd = __loadingMinEndTimes.get(el) || 0;
                let remaining = minEnd - Date.now();

                if (remaining > 0) {
                    // Min timer not expired yet — keep showing, hide later
                    let timer = setTimeout(() => {
                        el.removeAttribute('data-light-loading-active');
                        __loadingMinEndTimes.delete(el);
                        __loadingDelayTimers.delete(el);
                    }, remaining);
                    __loadingDelayTimers.set(el, timer);
                } else {
                    el.removeAttribute('data-light-loading-active');
                    __loadingMinEndTimes.delete(el);
                }
            }
        });
    }

    function isSameOrigin(url) {
        try {
            return new URL(url, window.location.href).origin === window.location.origin;
        } catch (_) {
            return false;
        }
    }

    function shouldHandleNavigate(link, e) {
        if (e.defaultPrevented) return false;
        if (e.button !== 0) return false;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
        if (link.target && link.target !== '_self') return false;
        if (link.hasAttribute('download')) return false;
        if (!link.href) return false;
        if (!isSameOrigin(link.href)) return false;
        if (link.getAttribute('rel') === 'external') return false;

        return true;
    }

    function navigateTo(url, options = {}) {
        let targetUrl = url;
        let currentUrl = window.location.href.split('#')[0];

        if (targetUrl.indexOf('#') !== -1 && targetUrl.split('#')[0] === currentUrl) {
            window.location.hash = targetUrl.split('#')[1];
            return;
        }

        startProgress();

        fetch(targetUrl, {
            method: 'GET',
            headers: {
                'X-Light-Navigate': 'true',
                'Accept': 'text/html',
            },
        })
            .then(async (r) => {
                if (!r.ok) {
                    throw new Error('Request failed with status ' + r.status);
                }

                let contentType = r.headers.get('Content-Type') || '';
                if (contentType.includes('application/json')) {
                    return { type: 'json', payload: await r.json() };
                }

                return { type: 'html', payload: await r.text() };
            })
            .then((result) => {
                if (result.type === 'json') {
                    update(result.payload);

                    if (!options.fromPop) {
                        if (options.replace) {
                            history.replaceState({}, '', targetUrl);
                        } else {
                            history.pushState({}, '', targetUrl);
                        }
                    }

                    return;
                }

                // Smooth SPA HTML navigation!
                let parser = new DOMParser();
                let doc = parser.parseFromString(result.payload, 'text/html');

                // 1. Update Document Title
                if (doc.title) {
                    document.title = doc.title;
                }

                // 2. Clear any active state caching
                if (window.Lightvel && window.Lightvel.clearCache) {
                    window.Lightvel.clearCache();
                }
                
                // 3. Swap body contents safely without destroying event delegation on document
                document.body.innerHTML = doc.body.innerHTML;

                // Sync body classes if any exist
                if (doc.body.className) {
                    document.body.className = doc.body.className;
                }

                // 4. Re-execute scripts (since innerHTML doesn't execute newly injected <script> tags)
                document.body.querySelectorAll('script').forEach((oldScript) => {
                    let newScript = document.createElement('script');
                    Array.from(oldScript.attributes).forEach((attr) => newScript.setAttribute(attr.name, attr.value));
                    newScript.appendChild(document.createTextNode(oldScript.innerHTML));
                    oldScript.parentNode.replaceChild(newScript, oldScript);
                });

                // 5. Update browser history
                if (!options.fromPop) {
                    if (options.replace) {
                        history.replaceState({}, '', targetUrl);
                    } else {
                        history.pushState({}, '', targetUrl);
                    }
                }

                // 6. Reset scroll
                if (!options.fromPop) {
                    window.scrollTo(0, 0);
                }

                // 7. Initialize Component State and DOM bindings for the newly injected HTML
                initJsState();
                syncBindings();
            })
            .catch((err) => {
                console.error('Lightvel SPA navigation failed:', err);
                window.location.href = targetUrl;
            })
            .finally(() => {
                endProgress();
            });
    }

    // =======================================================================
    // EVENT HANDLERS — Delegated listeners on document for all light:* actions
    // Using event delegation means we don't need to re-bind after DOM updates.
    // =======================================================================

    // --- light:click → server-side action via AJAX ---
    // Sends the action to Component.php::run() which invokes the method
    document.addEventListener('click', (e) => {
        let el = e.target.closest('[data-light-click]');
        if (!el) return;

        if (el.tagName === 'BUTTON' || el.tagName === 'A') {
            e.preventDefault();
        }

        let parsed = parse(el.dataset.lightClick);
        let state = collect();
        let debounceMs = getElementDebounceMs(el);


        if (parsed.args.length) {
            call(parsed.action, parsed.args, {
                debounceMs,
                debounceKey: `click:${parsed.action}`,
            });
        } else {
            call(parsed.action, state, {
                debounceMs,
                debounceKey: `click:${parsed.action}`,
            });
        }
    });

    // --- light:js:click → client-side action (no server round-trip) ---
    // Calls a registered JS handler via api.register()
    document.addEventListener('click', (e) => {
        let el = e.target.closest('[data-light-js-click]');
        if (!el) return;

        if (el.tagName === 'BUTTON' || el.tagName === 'A') {
            e.preventDefault();
        }

        let parsed = parse(el.dataset.lightJsClick);
        let api = getJsApi();
        let handler = api.actions[parsed.action];

        if (typeof handler !== 'function') {
            console.warn('Lightvel js action not found:', parsed.action);
            return;
        }

        handler(...parsed.args, {
            event: e,
            el,
            state: api.state,
            set: api.set,
            get: api.get,
        });
    });

    // --- light:function → inline client-side state assignment (INSTANT) ---
    // e.g. light:function="showModal=true" → no server hit at all
    // This is the "client-side-first" approach for instant UI reactions
    document.addEventListener('click', (e) => {
        let el = e.target.closest('[data-light-function]');
        if (!el) return;

        if (el.tagName === 'BUTTON' || el.tagName === 'A') {
            e.preventDefault();
        }

        let api = getJsApi();
        let rawFunctionExpr = el.dataset.lightFunction || '';

        // Fast path: if it's just assignments (e.g. "showModal=true"),
        // apply directly without any server call
        if (isInlineAssignmentExpression(rawFunctionExpr)) {
            applyFunctionAssignments(rawFunctionExpr, api);
            queueSyncBindings();
            return;
        }

        let parsed = parse(el.dataset.lightFunction);
        let resolvedArgs = (parsed.args || []).map((arg) => evaluateLightExpression(arg, api.state));

        invokeCustomFunction(parsed.action, resolvedArgs, { event: e, el });
    });

    // --- light:navigate → SPA-style navigation without full page reload ---
    document.addEventListener('click', (e) => {
        let link = e.target.closest('a[data-light-navigate]');
        if (!link) return;
        if (!shouldHandleNavigate(link, e)) return;

        e.preventDefault();
        navigateTo(link.href);
    });

    // Handle browser back/forward buttons for SPA navigation
    window.addEventListener('popstate', () => {
        navigateTo(window.location.href, { replace: true, fromPop: true });
    });

    // --- light:submit → form submit triggers server-side action via AJAX ---
    // Collects all form data + light:model values and sends as params
    document.addEventListener('submit', (e) => {
        let f = e.target.closest('[data-light-submit]');
        if (!f) return;

        e.preventDefault();

        // Run client-side validation first (avoid unnecessary server call)
        if (!validateScope(f)) return;

        let data = {
            ...collect(f),
            ...Object.fromEntries(new FormData(f).entries()),
        };

        call(f.dataset.lightSubmit, data, {
            debounceMs: getElementDebounceMs(f),
            debounceKey: `submit:${f.dataset.lightSubmit}`,
        });
    });

    // --- light:js:submit → client-side form handler (no server round-trip) ---
    document.addEventListener('submit', (e) => {
        let f = e.target.closest('[data-light-js-submit]');
        if (!f) return;

        e.preventDefault();

        if (!validateScope(f)) return;

        let api = getJsApi();
        let parsed = parse(f.dataset.lightJsSubmit);
        let handler = api.actions[parsed.action];

        if (typeof handler !== 'function') {
            console.warn('Lightvel js action not found:', parsed.action);
            return;
        }

        let formData = Object.fromEntries(new FormData(f).entries());

        handler(...parsed.args, {
            event: e,
            el: f,
            state: api.state,
            set: api.set,
            get: api.get,
            form: formData,
        });
    });

    // --- light:model input → two-way data binding ---
    // Updates state immediately on keystroke and optionally triggers live model action
    document.addEventListener('input', (e) => {
        let modelEl = e.target.closest('[data-light-model]');
        if (modelEl) {
            let field = getFieldName(modelEl);
            if (!field) return;

            let api = getJsApi();
            api.state[field] = getElementValue(modelEl);
            queueSyncBindings(field);

            // Real-time field validation as user types
            let result = validateElement(modelEl, getRootRules());
            if (result) {
                setFieldErrors(result.field, result.errors);
            }

            // If light:model.live, auto-submit the parent form
            triggerLiveModelAction(modelEl);

            return;
        }

        // JS-only model binding (no server sync)
        let el = e.target.closest('[data-light-js-model]');
        if (!el) return;

        let field = getFieldName(el);
        if (!field) return;

        let api = getJsApi();
        api.state[field] = getElementValue(el);
        queueSyncBindings(field);

        let result = validateElement(el, getRootRules());
        if (result) {
            setFieldErrors(result.field, result.errors);
        }
    });

    // --- change event — for selects, checkboxes, radios ---
    document.addEventListener('change', (e) => {
        let modelEl = e.target.closest('[data-light-model]');
        if (modelEl) {
            let field = getFieldName(modelEl);
            if (!field) return;

            let api = getJsApi();
            api.state[field] = getElementValue(modelEl);
            queueSyncBindings(field);

            let result = validateElement(modelEl, getRootRules());
            if (result) {
                setFieldErrors(result.field, result.errors);
            }

            triggerLiveModelAction(modelEl);

            return;
        }

        let el = e.target.closest('[data-light-js-model]');
        if (!el) return;

        let field = getFieldName(el);
        if (!field) return;

        let api = getJsApi();
        api.state[field] = getElementValue(el);
        queueSyncBindings(field);

        let result = validateElement(el, getRootRules());
        if (result) {
            setFieldErrors(result.field, result.errors);
        }
    });

    // =======================================================================
    // INITIALIZATION — runs immediately (script is placed before </body>)
    // 1. Read all data-light-server-state and data-light-state into api.state
    // 2. Remove data-light-booting to unhide reactive elements (FOUC fix)
    // 3. Render any existing validation errors
    // =======================================================================
    initJsState(document);
    document.documentElement.removeAttribute('data-light-booting');
    renderErrors(getJsApi().errors || {});
})();
