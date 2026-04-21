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
    // Singleton guard: ensure script only boots once per window lifecycle,
    // avoiding duplicate document event listeners during SPA navigation.
    window.Lightvel = window.Lightvel || {};
    if (window.Lightvel._jsBooted) return;
    window.Lightvel._jsBooted = true;

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
    let __currentActionId = null; // Full action call e.g. "deleteUser(5)" for per-instance loading
    let __navigateCache = new Map(); // url -> { type, payload, cachedAt }
    let __navigateInFlight = new Map(); // url -> Promise<{ type, payload }>
    let __NAVIGATE_CACHE_TTL = 30000;

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

            // Support nested paths like "user.profile.name"
            if (key.includes('.') || key.includes('[')) {
                setValueByPath(api.state, key, value);
            } else {
                api.state[key] = value;
            }

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

    function tokenizePath(path) {
        if (!path || typeof path !== 'string') return [];

        let normalized = path
            .replace(/\[(\d+)\]/g, '.$1')
            .replace(/\["([^"]+)"\]/g, '.$1')
            .replace(/\['([^']+)'\]/g, '.$1');

        return normalized
            .split('.')
            .map((part) => part.trim())
            .filter(Boolean);
    }

    function getValueByPath(state, path, fallback = undefined) {
        let tokens = tokenizePath(path);
        if (!tokens.length) return fallback;

        let cursor = state;
        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i];
            if (cursor == null || !Object.prototype.hasOwnProperty.call(cursor, token)) {
                return fallback;
            }
            cursor = cursor[token];
        }

        return cursor;
    }

    function hasValueAtPath(state, path) {
        let tokens = tokenizePath(path);
        if (!tokens.length) return false;

        let cursor = state;
        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i];
            if (cursor == null || !Object.prototype.hasOwnProperty.call(cursor, token)) {
                return false;
            }
            cursor = cursor[token];
        }

        return true;
    }

    function setValueByPath(state, path, value) {
        let tokens = tokenizePath(path);
        if (!tokens.length) return;

        let cursor = state;

        for (let i = 0; i < tokens.length - 1; i++) {
            let key = tokens[i];
            let nextKey = tokens[i + 1];

            if (cursor[key] == null || typeof cursor[key] !== 'object') {
                cursor[key] = /^\d+$/.test(nextKey) ? [] : {};
            }

            cursor = cursor[key];
        }

        cursor[tokens[tokens.length - 1]] = value;
    }

    function syncJsBindings(key) {
        let api = getJsApi();
        if (!key) return;

        document.querySelectorAll(`[data-light-model="${key}"]`).forEach((el) => {
            let nextValue = getValueByPath(api.state, key, api.state[key] ?? '');

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

            let nextValue = getValueByPath(api.state, key, api.state[key] ?? '');
            if (el.value !== nextValue) {
                el.value = nextValue ?? '';
            }
        });

        document.querySelectorAll(`[data-light-js-bind="${key}"]`).forEach((el) => {
            let nextValue = getValueByPath(api.state, key, api.state[key] ?? '');
            el.innerText = nextValue ?? '';
        });

        document.querySelectorAll(`[data-light-js-html="${key}"]`).forEach((el) => {
            let nextValue = getValueByPath(api.state, key, api.state[key] ?? '');
            el.innerHTML = nextValue ?? '';
        });

        document.querySelectorAll(`[data-light-src="${key}"]`).forEach((el) => {
            let nextValue = getValueByPath(api.state, key, api.state[key] ?? '');
            if (nextValue != null && nextValue !== '') {
                el.setAttribute('src', String(nextValue));
            } else {
                el.removeAttribute('src');
            }
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

        document.querySelectorAll('[data-light-src]:not([data-light-scoped="1"])').forEach((el) => {
            let expr = el.getAttribute('data-light-src');
            if (!expr) return;

            let nextValue = evaluateLightExpression(expr, api.state);
            if (nextValue != null && nextValue !== '') {
                el.setAttribute('src', String(nextValue));
            } else {
                el.removeAttribute('src');
            }
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

        document.querySelectorAll('[data-light-bind-checked]:not([data-light-scoped="1"])').forEach((el) => {
            let expr = el.getAttribute('data-light-bind-checked');
            if (!expr) return;

            let checked = !!evaluateLightExpression(expr, api.state);
            if (el.checked !== checked) {
                el.checked = checked;
            }
        });

        document.querySelectorAll('[data-light-array-check]:not([data-light-scoped="1"])').forEach((el) => {
            let expr = el.getAttribute('data-light-array-check');
            if (!expr) return;
            applyArrayCheckBinding(el, expr, api.state);
        });

        document.querySelectorAll('[data-light-json-check]:not([data-light-scoped="1"])').forEach((el) => {
            let expr = el.getAttribute('data-light-json-check');
            if (!expr) return;
            applyJsonCheckBinding(el, expr, api.state);
        });
    }

    function initJsState(scope = document) {
        let api = getJsApi();
        let deferredServerStates = [];

        scope.querySelectorAll('[data-light-cloak-repeat]').forEach((el) => {
            if (el.getAttribute('data-light-cloak-repeat-processed') === '1') {
                return;
            }

            let count = parseInt(el.getAttribute('data-light-cloak-repeat') || '1', 10);
            if (isNaN(count) || count < 1) {
                count = 1;
            }

            el.setAttribute('data-light-cloak-repeat-processed', '1');

            for (let i = 1; i < count; i++) {
                let clone = el.cloneNode(true);
                clone.setAttribute('data-light-cloak-repeat-processed', '1');
                el.parentNode?.insertBefore(clone, el.nextSibling);
            }
        });

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
                    deferredServerStates.push(serverState);
                }
            } catch (_) {
                // ignore invalid server state
            }
        });

        ensureDeclaredArrayStates(scope);

        api.array = api.array || {
            has: (arrayKey, value) => arrayContainsValue(arrayKey, value, api),
            add: (arrayKey, value) => {
                let next = toggleArrayValue(arrayKey, value, api);
                queueSyncBindings(arrayKey);
                return next;
            },
            all: (arrayKey, values) => {
                let next = setArrayValues(arrayKey, values, api);
                queueSyncBindings(arrayKey);
                return next;
            },
            clear: (arrayKey) => {
                let next = setArrayValues(arrayKey, [], api);
                queueSyncBindings(arrayKey);
                return next;
            },
        };

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
                setValueByPath(api.state, key, getElementValue(el));
                return;
            }

            if (!hasValueAtPath(api.state, key)) {
                setValueByPath(api.state, key, getElementValue(el));
            }
        });

        scope.querySelectorAll('[data-light-model]').forEach((el) => {
            let key = el.dataset.lightModel;
            if (!key) return;

            if (!hasValueAtPath(api.state, key)) {
                setValueByPath(api.state, key, getElementValue(el));
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

        let finalizeBoot = () => {
            document.documentElement.removeAttribute('data-light-booting');
            renderErrors(getJsApi().errors || {});
        };

        if (deferredServerStates.length) {
            requestAnimationFrame(() => {
                deferredServerStates.forEach((serverState) => {
                    Object.entries(serverState).forEach(([key, value]) => {
                        api.state[key] = value;
                    });
                });

                syncBindings();
                finalizeBoot();
            });
            return;
        }

        finalizeBoot();
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
        function fieldVariants(field) {
            let raw = String(field || '').trim();
            if (!raw) return [];

            let bracketToDot = raw.replace(/\[(\d+)\]/g, '.$1');
            let dotToBracket = raw.replace(/\.(\d+)(?=\.|$)/g, '[$1]');

            return Array.from(new Set([raw, bracketToDot, dotToBracket]));
        }

        function firstErrorMessage(field) {
            let keys = fieldVariants(field);

            for (let i = 0; i < keys.length; i++) {
                let key = keys[i];
                if (errors && errors[key] && errors[key][0]) {
                    return errors[key][0];
                }
            }

            return '';
        }

        document.querySelectorAll('[data-light-error]').forEach((el) => {
            let field = el.dataset.lightError;
            let message = firstErrorMessage(field);

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
        let state = getJsApi().state;
        let values = JSON.parse(JSON.stringify(state || {}));

        // Always include actual form input values (light:model bindings)
        scope.querySelectorAll('[data-light-model]').forEach((el) => {
            setValueByPath(values, el.dataset.lightModel, getElementValue(el));
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

        splitTopLevelArgs(raw).map((part) => part.trim()).filter(Boolean).forEach((part) => {
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

    function splitTopLevelArgs(rawArgs) {
        if (!rawArgs || typeof rawArgs !== 'string') {
            return [];
        }

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

    function parseLightImageDirective(rawExpr) {
        let parts = splitTopLevelArgs(rawExpr || '');

        return {
            previewKey: stripWrappingQuotes(parts[0] || ''),
            sourceKey: stripWrappingQuotes(parts[1] || ''),
            parts,
        };
    }

    function stripWrappingQuotes(value) {
        if (value == null) return '';

        let raw = String(value).trim();
        if (!raw) return '';

        let first = raw[0];
        let last = raw[raw.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return raw.slice(1, -1);
        }

        return raw;
    }

    function normalizeSelectableValue(value) {
        if (typeof value === 'string') {
            let trimmed = value.trim();
            if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
                let asNumber = Number(trimmed);
                if (!Number.isNaN(asNumber)) {
                    return asNumber;
                }
            }
            return trimmed;
        }

        return value;
    }

    function isSameArrayValue(a, b) {
        let left = normalizeSelectableValue(a);
        let right = normalizeSelectableValue(b);

        if (left === right) {
            return true;
        }

        if (typeof left === 'object' || typeof right === 'object') {
            try {
                return JSON.stringify(left) === JSON.stringify(right);
            } catch (_) {
                return false;
            }
        }

        return String(left) === String(right);
    }

    function ensureArrayState(arrayKey, api = null) {
        let safeKey = stripWrappingQuotes(arrayKey);
        if (!safeKey) return [];

        let targetApi = api || getJsApi();
        let existing = getValueByPath(targetApi.state, safeKey, undefined);

        if (Array.isArray(existing)) {
            return existing;
        }

        setValueByPath(targetApi.state, safeKey, []);
        return getValueByPath(targetApi.state, safeKey, []);
    }

    function parseArrayDirectiveArgs(rawExpr) {
        let parts = splitTopLevelArgs(rawExpr || '');
        let arrayKey = stripWrappingQuotes(parts[0] || '');
        let valueExpr = parts[1] || '';
        let sourceExpr = parts[1] || '';
        let selectorExpr = parts[2] || 'id';

        return {
            arrayKey,
            valueExpr,
            sourceExpr,
            selectorExpr,
            parts,
        };
    }

    function arrayContainsValue(arrayKey, value, api = null) {
        let targetApi = api || getJsApi();
        let list = ensureArrayState(arrayKey, targetApi);
        return list.some((entry) => isSameArrayValue(entry, value));
    }

    function toggleArrayValue(arrayKey, value, api = null) {
        let targetApi = api || getJsApi();
        let list = ensureArrayState(arrayKey, targetApi);

        if (arrayContainsValue(arrayKey, value, targetApi)) {
            let next = list.filter((entry) => !isSameArrayValue(entry, value));
            setValueByPath(targetApi.state, arrayKey, next);
            return next;
        }

        let next = [...list, normalizeSelectableValue(value)];
        setValueByPath(targetApi.state, arrayKey, next);
        return next;
    }

    function setArrayValues(arrayKey, values, api = null) {
        let targetApi = api || getJsApi();
        let sanitized = Array.isArray(values) ? values.map((v) => normalizeSelectableValue(v)) : [];
        setValueByPath(targetApi.state, arrayKey, sanitized);
        return sanitized;
    }

    function cloneJsonValue(value) {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    function appendJsonValue(path, value, api = null) {
        let targetApi = api || getJsApi();
        let key = stripWrappingQuotes(path || '');
        if (!key) return [];

        let list = getValueByPath(targetApi.state, key, []);
        if (!Array.isArray(list)) {
            list = [];
        }

        let next = [...list, cloneJsonValue(value)];
        setValueByPath(targetApi.state, key, next);
        return next;
    }

    function parseJsonDirectiveArgs(rawExpr) {
        let parts = splitTopLevelArgs(rawExpr || '');
        return {
            pathExpr: parts[0] || '',
            arg1Expr: parts[1] || '',
            arg2Expr: parts[2] || '',
            arg3Expr: parts[3] || '',
            arg4Expr: parts[4] || '',
            parts,
        };
    }

    function resolveJsonPath(pathExpr, scopeState = null) {
        let api = getJsApi();
        let raw = String(pathExpr || '').trim();
        if (!raw) return '';

        let first = raw[0];
        let last = raw[raw.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return stripWrappingQuotes(raw);
        }

        let evaluated = evaluateLightExpression(raw, scopeState || api.state);
        if (typeof evaluated === 'string' && evaluated.trim() !== '') {
            return evaluated.trim();
        }

        return raw;
    }

    function resolveJsonOutput(outputExpr, scopeState = null) {
        if (!outputExpr) return '';

        let raw = String(outputExpr).trim();
        if (!raw) return '';

        let first = raw[0];
        let last = raw[raw.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return stripWrappingQuotes(raw);
        }

        let evaluated = evaluateLightExpression(raw, scopeState || getJsApi().state);
        if (evaluated === undefined || evaluated === null) {
            return raw;
        }

        return evaluated;
    }

    function removeJsonPath(path, api = null) {
        let targetApi = api || getJsApi();
        let key = stripWrappingQuotes(path || '');
        if (!key) return false;

        let tokens = tokenizePath(key);
        if (!tokens.length) return false;

        let parentTokens = tokens.slice(0, -1);
        let lastToken = tokens[tokens.length - 1];
        let parent = parentTokens.length ? getValueByPath(targetApi.state, parentTokens.join('.')) : targetApi.state;

        if (parent == null || typeof parent !== 'object') {
            return false;
        }

        if (Array.isArray(parent) && /^\d+$/.test(lastToken)) {
            let idx = Number(lastToken);
            if (idx >= 0 && idx < parent.length) {
                parent.splice(idx, 1);
                return true;
            }
            return false;
        }

        if (Object.prototype.hasOwnProperty.call(parent, lastToken)) {
            delete parent[lastToken];
            return true;
        }

        return false;
    }

    function removeJsonValue(path, target, mode = 'auto', api = null) {
        let targetApi = api || getJsApi();
        let key = stripWrappingQuotes(path || '');
        if (!key) return [];

        let list = getValueByPath(targetApi.state, key, []);
        if (!Array.isArray(list)) {
            return list;
        }

        let resolvedMode = mode || 'auto';
        if (resolvedMode === 'auto') {
            resolvedMode = Number.isInteger(Number(target)) ? 'index' : 'value';
        }

        let next = list;
        if (resolvedMode === 'index') {
            let idx = Number(target);
            if (!Number.isNaN(idx) && idx >= 0 && idx < list.length) {
                next = list.filter((_, i) => i !== idx);
            }
        } else {
            next = list.filter((entry) => !isSameArrayValue(entry, target));
        }

        setValueByPath(targetApi.state, key, next);
        return next;
    }

    function applyJsonCheckBinding(el, rawExpr, scopeState = null) {
        if (!el || !rawExpr) return;

        let api = getJsApi();
        let parsed = parseJsonDirectiveArgs(rawExpr);
        let path = resolveJsonPath(parsed.pathExpr, scopeState || api.state);
        if (!path) return;

        let exists = hasValueAtPath(api.state, path);
        let value = exists ? getValueByPath(api.state, path) : undefined;

        if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = !!exists;
        }

        if (parsed.arg1Expr || parsed.arg2Expr) {
            let out = exists
                ? resolveJsonOutput(parsed.arg1Expr, scopeState || api.state)
                : resolveJsonOutput(parsed.arg2Expr, scopeState || api.state);

            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
                el.value = out == null ? '' : String(out);
            } else {
                el.innerText = out == null ? '' : String(out);
            }
        } else if (el.hasAttribute('data-light-json-value')) {
            let out = exists ? value : '';
            el.innerText = out == null ? '' : String(out);
        }

        if (parsed.arg3Expr || parsed.arg4Expr) {
            let trueClasses = stripWrappingQuotes(parsed.arg3Expr || '');
            let falseClasses = stripWrappingQuotes(parsed.arg4Expr || '');

            trueClasses.split(/\s+/).filter(Boolean).forEach((className) => {
                if (exists) {
                    el.classList.add(className);
                } else {
                    el.classList.remove(className);
                }
            });

            falseClasses.split(/\s+/).filter(Boolean).forEach((className) => {
                if (exists) {
                    el.classList.remove(className);
                } else {
                    el.classList.add(className);
                }
            });
        }

        el.setAttribute('data-light-json-exists', exists ? '1' : '0');
    }

    function extractListItemValue(item, selectorExpr, state, index) {
        let selector = stripWrappingQuotes(selectorExpr || 'id');
        if (!selector) return item;

        if (/^[A-Za-z_$][\w$]*$/.test(selector)) {
            return getValueByPath(item, selector, item?.[selector]);
        }

        return evaluateLightExpression(selectorExpr, state, {
            item,
            index,
            $index: index,
        });
    }

    function ensureDeclaredArrayStates(scope = document) {
        let api = getJsApi();

        scope.querySelectorAll('[data-light-array]').forEach((el) => {
            let raw = el.getAttribute('data-light-array') || '';
            splitTopLevelArgs(raw).forEach((name) => {
                let key = stripWrappingQuotes(name);
                if (!key) return;
                ensureArrayState(key, api);
            });
        });
    }

    function applyArrayCheckBinding(el, rawExpr, scopeState = null) {
        if (!el || !rawExpr) return;

        let api = getJsApi();
        let parsed = parseArrayDirectiveArgs(rawExpr);
        if (!parsed.arrayKey || !parsed.valueExpr) return;

        let checkValue = evaluateLightExpression(parsed.valueExpr, scopeState || api.state);
        let checked = arrayContainsValue(parsed.arrayKey, checkValue, api);

        if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = !!checked;
        }

        if (parsed.parts.length >= 3) {
            let trueClasses = stripWrappingQuotes(parsed.parts[2] || '');
            let falseClasses = stripWrappingQuotes(parsed.parts[3] || '');

            trueClasses.split(/\s+/).filter(Boolean).forEach((className) => {
                if (checked) {
                    el.classList.add(className);
                } else {
                    el.classList.remove(className);
                }
            });

            falseClasses.split(/\s+/).filter(Boolean).forEach((className) => {
                if (checked) {
                    el.classList.remove(className);
                } else {
                    el.classList.add(className);
                }
            });
        }

        el.setAttribute('data-light-array-checked', checked ? '1' : '0');
    }

    function applyArrayAllDirective(rawExpr, scopeState = null) {
        let api = getJsApi();
        let parsed = parseArrayDirectiveArgs(rawExpr);
        if (!parsed.arrayKey || !parsed.sourceExpr) return;

        let source = evaluateLightExpression(parsed.sourceExpr, scopeState || api.state);

        if (source && typeof source === 'object' && !Array.isArray(source) && Array.isArray(source.data)) {
            source = source.data;
        } else if (source && typeof source === 'object' && !Array.isArray(source)) {
            source = Object.values(source);
        }

        if (!Array.isArray(source)) {
            source = [];
        }

        let values = source.map((item, index) => extractListItemValue(item, parsed.selectorExpr, api.state, index));
        setArrayValues(parsed.arrayKey, values, api);
    }

    function applyLightImageSelection(wrapper, fileInput, api = null) {
        if (!wrapper || !fileInput) return;

        let targetApi = api || getJsApi();
        let parsed = parseLightImageDirective(wrapper.getAttribute('data-light-image') || '');
        if (!parsed.previewKey) return;

        let file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
        let fallbackValue = parsed.sourceKey ? getValueByPath(targetApi.state, parsed.sourceKey, '') : '';

        if (wrapper.__lightImageTempUrl) {
            try {
                URL.revokeObjectURL(wrapper.__lightImageTempUrl);
            } catch (_) {}
            wrapper.__lightImageTempUrl = '';
        }

        if (file) {
            let tempUrl = URL.createObjectURL(file);
            wrapper.__lightImageTempUrl = tempUrl;
            targetApi.set(parsed.previewKey, tempUrl);
            return;
        }

        targetApi.set(parsed.previewKey, fallbackValue || '');
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
        syncLightTextExpressionBindings(key);
        syncLightAttributeBindings(key);

        if (full) {
            syncGlobalJsBindings();
            syncLightConditionals();
            renderLightForTemplates();
            syncLightPaginate();
            syncAllCheckboxBindings();
        }
    }

    // Sync ALL checkboxes (including scoped) after state changes
    function syncAllCheckboxBindings() {
        let api = getJsApi();
        document.querySelectorAll('[data-light-bind-checked]').forEach((el) => {
            let expr = el.getAttribute('data-light-bind-checked');
            if (!expr) return;
            try {
                let checked = !!evaluateLightExpression(expr, api.state);
                if (el.checked !== checked) {
                    el.checked = checked;
                }
            } catch (e) {
                // silently fail for complex expressions in scoped context
            }
        });
    }

    let __pendingSyncFrame = null;
    let __pendingSyncKeys = new Set();
    let __needsFullSync = false;

    function queueSyncBindings(key = null) {
        if (!key) {
            // If no key specified, always do full sync (for loops, conditionals, etc.)
            __needsFullSync = true;
        } else {
            __pendingSyncKeys.add(key);
        }

        if (__pendingSyncFrame) {
            return;
        }

        __pendingSyncFrame = requestAnimationFrame(() => {
            __pendingSyncFrame = null;

            let keys = Array.from(__pendingSyncKeys);
            __pendingSyncKeys.clear();
            let fullSync = __needsFullSync;
            __needsFullSync = false;

            if (!keys.length || fullSync) {
                syncBindings(null, true);  // Always full sync
                return;
            }

            // Partial sync for specific keys, but always mark for full if it looks like array/object changes
            let needsFull = keys.some(k => {
                let val = getJsApi().state[k];
                return Array.isArray(val) || (val && typeof val === 'object' && !(val instanceof Date));
            });

            if (needsFull) {
                syncBindings(null, true);
            } else {
                keys.forEach((stateKey) => syncBindings(stateKey, false));
            }
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

            // Optimization: when syncing a specific key, skip text bindings
            // that don't reference this key (avoids re-evaluating 100s of
            // user.name/user.email expressions when typing in search input)
            if (key && !expr.includes(key)) return;

            let value = evaluateLightExpression(expr, api.state);
            let text = value == null ? '' : String(value);
            if (el.innerText !== text) {
                el.innerText = text;
            }
        });
    }

    function syncLightTextExpressionBindings(key) {
        let api = getJsApi();

        document.querySelectorAll('[data-light-text-expr]:not([data-light-scoped="1"])').forEach((el) => {
            let expr = el.getAttribute('data-light-text-expr');
            if (!expr) return;

            if (key && !expr.includes(key)) return;

            let value = evaluateLightExpression(expr, api.state);
            let text = value == null ? '' : String(value);
            if (el.innerText !== text) {
                el.innerText = text;
            }
        });
    }

    function isBooleanHtmlAttribute(name) {
        return [
            'disabled',
            'hidden',
            'readonly',
            'required',
            'checked',
            'selected',
            'multiple',
            'autofocus',
            'open',
        ].includes(name);
    }

    function normalizeClassBindingValue(value) {
        if (value == null || value === false) {
            return '';
        }

        if (typeof value === 'string' || typeof value === 'number') {
            return String(value).trim();
        }

        if (Array.isArray(value)) {
            return value.map((item) => String(item || '').trim()).filter(Boolean).join(' ');
        }

        if (typeof value === 'object') {
            return Object.entries(value)
                .filter(([, enabled]) => !!enabled)
                .map(([className]) => className)
                .join(' ');
        }

        return '';
    }

    function getLightAttrBindings(el) {
        let bindings = [];
        if (!el || !el.attributes) return bindings;

        Array.from(el.attributes).forEach((attr) => {
            if (!attr || !attr.name || !attr.name.startsWith('data-light-attr-')) {
                return;
            }

            let name = attr.name.replace('data-light-attr-', '').trim().toLowerCase();
            if (!name) return;

            bindings.push({ name, expr: attr.value || '' });
        });

        return bindings;
    }

    function applyLightAttrBinding(el, attrName, expr, state) {
        if (!expr) return;

        let value = evaluateLightExpression(expr, state);

        if (attrName === 'class') {
            if (!Object.prototype.hasOwnProperty.call(el.dataset, 'lightAttrBaseClass')) {
                el.dataset.lightAttrBaseClass = el.getAttribute('class') || '';
            }

            let baseClass = el.dataset.lightAttrBaseClass || '';
            let dynamicClass = normalizeClassBindingValue(value);
            let nextClass = `${baseClass} ${dynamicClass}`.trim().replace(/\s+/g, ' ');

            if (nextClass) {
                el.setAttribute('class', nextClass);
            } else {
                el.removeAttribute('class');
            }

            return;
        }

        if (isBooleanHtmlAttribute(attrName)) {
            if (!!value) {
                el.setAttribute(attrName, attrName);
            } else {
                el.removeAttribute(attrName);
            }

            return;
        }

        if (value == null || value === false) {
            el.removeAttribute(attrName);
            return;
        }

        el.setAttribute(attrName, String(value));
    }

    function syncLightAttributeBindings(key) {
        let api = getJsApi();

        document.querySelectorAll('*:not([data-light-scoped="1"])').forEach((el) => {
            let bindings = getLightAttrBindings(el);
            if (!bindings.length) return;

            bindings.forEach(({ name, expr }) => {
                if (key && expr && !expr.includes(key)) return;
                applyLightAttrBinding(el, name, expr, api.state);
            });
        });
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

            let args = splitTopLevelArgs(rawArgs).map((argExpr) => evaluateLightExpression(normalizeLightExpression(argExpr), scopeState));
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

            let parts = splitTopLevelArgs(expr);

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

        function resolveScopedModelPath(rawPath) {
            if (!rawPath) return rawPath;

            let path = String(rawPath).trim();
            let index = Number(scopeState.$index ?? scopeState.index ?? 0);
            let itemName = scopeState.__lv_for_itemName;
            let sourceExpr = scopeState.__lv_for_sourceExpr;

            path = path.replace(/\$index/g, String(index));

            if (itemName && sourceExpr) {
                if (path === itemName) {
                    path = `${sourceExpr}[${index}]`;
                } else if (path.startsWith(itemName + '.')) {
                    let suffix = path.slice(itemName.length + 1);
                    path = `${sourceExpr}[${index}].${suffix}`;
                }
            }

            return path;
        }

        function resolveScopedErrorPath(rawPath) {
            if (!rawPath) return rawPath;

            let path = String(rawPath).trim();
            let index = Number(scopeState.$index ?? scopeState.index ?? 0);
            let itemName = scopeState.__lv_for_itemName;
            let sourceExpr = scopeState.__lv_for_sourceExpr;

            path = path.replace(/\$index/g, String(index));

            if (itemName && sourceExpr) {
                if (path === itemName) {
                    path = `${sourceExpr}.${index}`;
                } else if (path.startsWith(itemName + '.')) {
                    let suffix = path.slice(itemName.length + 1);
                    path = `${sourceExpr}.${index}.${suffix}`;
                }
            }

            return path;
        }

        function resolveScopedForExpression(rawExpr) {
            if (!rawExpr) return rawExpr;

            let expr = String(rawExpr).trim();
            let match = expr.match(/^\s*([A-Za-z_$][\w$]*)\s+in\s+(.+)\s*$/);
            if (!match) return rawExpr;

            let itemVar = match[1];
            let sourceExpr = match[2];
            let resolved = evaluateLightExpression(normalizeLightExpression(sourceExpr), scopeState);

            if (resolved && typeof resolved === 'object' && !Array.isArray(resolved) && Array.isArray(resolved.data)) {
                resolved = resolved.data;
            } else if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
                resolved = Object.values(resolved);
            }

            if (!Array.isArray(resolved)) {
                resolved = [];
            }

            return `${itemVar} in ${JSON.stringify(resolved)}`;
        }

        scopedElements('[data-light-text]').forEach((el) => {
            el.setAttribute('data-light-scoped', '1');
            let expr = el.getAttribute('data-light-text');
            if (!expr) return;

            let value = evaluateLightExpression(expr, scopeState);
            el.innerText = value == null ? '' : String(value);
        });

        scopedElements('[data-light-text-expr]').forEach((el) => {
            el.setAttribute('data-light-scoped', '1');
            let expr = el.getAttribute('data-light-text-expr');
            if (!expr) return;

            let value = evaluateLightExpression(expr, scopeState);
            el.innerText = value == null ? '' : String(value);
        });

        scopedElements('*').forEach((el) => {
            let bindings = getLightAttrBindings(el);
            if (!bindings.length) return;

            el.setAttribute('data-light-scoped', '1');
            bindings.forEach(({ name, expr }) => {
                applyLightAttrBinding(el, name, expr, scopeState);
            });
        });

        scopedElements('[data-light-src]').forEach((el) => {
            el.setAttribute('data-light-scoped', '1');
            let expr = el.getAttribute('data-light-src');
            if (!expr) return;

            let value = evaluateLightExpression(expr, scopeState);
            if (value != null && value !== '') {
                el.setAttribute('src', String(value));
            } else {
                el.removeAttribute('src');
            }
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

        scopedElements('[data-light-loading-target]').forEach((el) => {
            let target = el.getAttribute('data-light-loading-target');
            if (!target) return;

            let resolved = resolveScopedAction(target);
            el.setAttribute('data-light-loading-target', resolved);
        });

        scopedElements('[data-light-function]').forEach((el) => {
            let expr = el.getAttribute('data-light-function');
            if (!expr) return;

            el.setAttribute('data-light-function', resolveScopedFunction(expr));
        });

        scopedElements('[data-light-array-add]').forEach((el) => {
            let expr = el.getAttribute('data-light-array-add');
            if (!expr) return;

            let parts = splitTopLevelArgs(expr);
            if (!parts.length) return;

            let arrayKey = stripWrappingQuotes(parts[0]);
            let valueExpr = parts[1] || '';
            if (!arrayKey || !valueExpr) return;

            let value = evaluateLightExpression(normalizeLightExpression(valueExpr), scopeState);
            el.setAttribute('data-light-array-add', `${arrayKey},${JSON.stringify(value)}`);
        });

        scopedElements('[data-light-array-all]').forEach((el) => {
            let expr = el.getAttribute('data-light-array-all');
            if (!expr) return;

            let parts = splitTopLevelArgs(expr);
            if (!parts.length) return;

            let arrayKey = stripWrappingQuotes(parts[0]);
            let sourceExpr = parts[1] || '';
            let selectorExpr = parts[2] || 'id';
            if (!arrayKey || !sourceExpr) return;

            let sourceValue = evaluateLightExpression(normalizeLightExpression(sourceExpr), scopeState);
            let serializedSource = JSON.stringify(sourceValue);
            let resolved = `${arrayKey},${serializedSource}`;

            if (selectorExpr) {
                resolved += `,${selectorExpr}`;
            }

            el.setAttribute('data-light-array-all', resolved);
        });

        scopedElements('[data-light-json-add]').forEach((el) => {
            let expr = el.getAttribute('data-light-json-add');
            if (!expr) return;

            let parts = splitTopLevelArgs(expr);
            if (!parts.length) return;

            let path = stripWrappingQuotes(parts[0]);
            let valueExpr = parts[1] || '';
            if (!path || !valueExpr) return;

            let value = evaluateLightExpression(normalizeLightExpression(valueExpr), scopeState);
            el.setAttribute('data-light-json-add', `${path},${JSON.stringify(value)}`);
        });

        scopedElements('[data-light-json-remove]').forEach((el) => {
            let expr = el.getAttribute('data-light-json-remove');
            if (!expr) return;

            let parsed = parseJsonDirectiveArgs(expr);
            let path = resolveJsonPath(parsed.pathExpr, scopeState);
            let target = parsed.arg1Expr
                ? evaluateLightExpression(normalizeLightExpression(parsed.arg1Expr), scopeState)
                : null;
            let mode = parsed.arg2Expr ? stripWrappingQuotes(parsed.arg2Expr) : 'auto';

            let encodedTarget = target === undefined ? 'null' : JSON.stringify(target);
            el.setAttribute('data-light-json-remove', `${path},${encodedTarget},${mode}`);
        });

        scopedElements('[data-light-json-check]').forEach((el) => {
            el.setAttribute('data-light-scoped', '1');
            let expr = el.getAttribute('data-light-json-check');
            if (!expr) return;

            let parsed = parseJsonDirectiveArgs(expr);
            let path = resolveJsonPath(parsed.pathExpr, scopeState);
            let rebuilt = [path]
                .concat(parsed.parts.slice(1))
                .filter((part) => part !== undefined && part !== null && String(part).trim() !== '')
                .join(',');

            el.setAttribute('data-light-json-check', rebuilt);
            applyJsonCheckBinding(el, rebuilt, scopeState);
        });

        scopedElements('[data-light-for]').forEach((el) => {
            let loopExpr = el.getAttribute('data-light-for');
            if (!loopExpr) return;

            el.setAttribute('data-light-for', resolveScopedForExpression(loopExpr));
        });

        scopedElements('[data-light-model]').forEach((el) => {
            let model = el.getAttribute('data-light-model');
            if (!model) return;

            let currentValue = evaluateLightExpression(model, scopeState);
            if (el.type === 'checkbox') {
                el.checked = String(currentValue ?? '') === String(el.value || '1');
            } else if (el.type === 'radio') {
                el.checked = String(currentValue ?? '') === String(el.value || '1');
            } else if (el.tagName === 'SELECT' && el.multiple && Array.isArray(currentValue)) {
                Array.from(el.options).forEach((option) => {
                    option.selected = currentValue.includes(option.value);
                });
            } else if ((el.value ?? '') !== String(currentValue ?? '')) {
                el.value = currentValue ?? '';
            }

            el.setAttribute('data-light-model', resolveScopedModelPath(model));
        });

        scopedElements('[data-light-js-model]').forEach((el) => {
            let model = el.getAttribute('data-light-js-model');
            if (!model) return;

            el.setAttribute('data-light-js-model', resolveScopedModelPath(model));
        });

        scopedElements('[data-light-error]').forEach((el) => {
            let field = el.getAttribute('data-light-error');
            if (!field) return;

            el.setAttribute('data-light-error', resolveScopedErrorPath(field));
        });

        scopedElements('[data-light-bind-checked]').forEach((el) => {
            el.setAttribute('data-light-scoped', '1');
            let expr = el.getAttribute('data-light-bind-checked');
            if (!expr) return;

            let checked = !!evaluateLightExpression(expr, scopeState);
            if (el.checked !== checked) {
                el.checked = checked;
            }
        });

        scopedElements('[data-light-array-check]').forEach((el) => {
            el.setAttribute('data-light-scoped', '1');
            let expr = el.getAttribute('data-light-array-check');
            if (!expr) return;
            applyArrayCheckBinding(el, expr, scopeState);
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

            // Always re-render loop nodes so scoped class/check bindings react
            // to external state changes (like selection arrays for row highlight).
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
                    __lv_for_itemName: itemName,
                    __lv_for_sourceExpr: sourceExpr,
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

                    if (actionName) {
                        // AJAX call: fetch new page data without reload
                        call(actionName, { page: pageNum });
                    } else {
                        // SPA fallback: navigate without full page reload
                        let url = new URL(window.location.href);
                        url.searchParams.set('page', pageNum);
                        navigateTo(url.toString());
                    }
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

    function isBinaryValue(value) {
        if (value === null || value === undefined) return false;

        if (typeof File !== 'undefined' && value instanceof File) return true;
        if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
        if (typeof FileList !== 'undefined' && value instanceof FileList) return value.length > 0;

        return false;
    }

    function containsBinaryValue(value, seen = new WeakSet()) {
        if (isBinaryValue(value)) return true;

        if (!value || typeof value !== 'object') return false;
        if (seen.has(value)) return false;
        seen.add(value);

        if (Array.isArray(value)) {
            return value.some((item) => containsBinaryValue(item, seen));
        }

        return Object.values(value).some((item) => containsBinaryValue(item, seen));
    }

    function stripBinaryValues(value, seen = new WeakSet()) {
        if (isBinaryValue(value)) {
            return undefined;
        }

        if (!value || typeof value !== 'object') {
            return value;
        }

        if (seen.has(value)) {
            return undefined;
        }

        seen.add(value);

        if (Array.isArray(value)) {
            return value
                .map((item) => stripBinaryValues(item, seen))
                .filter((item) => item !== undefined);
        }

        let cleaned = {};
        Object.entries(value).forEach(([key, item]) => {
            let next = stripBinaryValues(item, seen);
            if (next !== undefined) {
                cleaned[key] = next;
            }
        });

        return cleaned;
    }

    function appendBinaryValues(formData, value, prefix = '', seen = new WeakSet()) {
        if (isBinaryValue(value)) {
            if (prefix) {
                formData.append(prefix, value);
            }
            return;
        }

        if (!value || typeof value !== 'object') {
            return;
        }

        if (seen.has(value)) {
            return;
        }

        seen.add(value);

        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                let nextPrefix = prefix ? `${prefix}[${index}]` : String(index);
                appendBinaryValues(formData, item, nextPrefix, seen);
            });
            return;
        }

        Object.entries(value).forEach(([key, item]) => {
            let nextPrefix = prefix ? `${prefix}[${key}]` : key;
            appendBinaryValues(formData, item, nextPrefix, seen);
        });
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

        let liveTarget = String(modelEl.getAttribute('data-light-model-live') || '').trim();
        let modelKey = String(getFieldName(modelEl) || modelEl.getAttribute('data-light-model') || '').trim();
        let explicitAction = '';

        if (liveTarget && liveTarget !== 'true' && liveTarget !== modelKey) {
            explicitAction = liveTarget;
        }

        // New behavior:
        // - light:model.live only triggers when value is an explicit action name.
        // - It never auto-submits nearest form action.
        // - If no explicit action is provided, it behaves like plain light:model.
        if (!explicitAction) {
            return;
        }

        let form = modelEl.closest('form[data-light-submit]');

        if (explicitAction && !form && parseBoolean(getConfig().allowLiveActionWithoutForm, true) === false) {
            return;
        }

        let action = explicitAction;
        if (!action) {
            return;
        }

        let data = form
            ? {
                ...collect(form),
                ...Object.fromEntries(new FormData(form).entries()),
            }
            : collect(document.querySelector('[data-light-root]') || document);

        call(action, data, {
            debounceMs: getElementDebounceMs(modelEl),
            debounceKey: `model-live:${action}:${modelKey}`,
            cancelKey: `model-live:${action}`,
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
        let hydrateStateOnAction = parseBoolean(getConfig().hydrateStateOnAction, true);
        let stateSnapshot = hydrateStateOnAction
            ? (options.state || collect(root || document))
            : null;

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

        // Build full action identifier for per-instance loading
        // e.g. "deleteUser" with params {0:5} → "deleteUser(5)"
        let actionId = action;
        if (params && typeof params === 'object') {
            let vals = Object.values(params);
            if (vals.length) actionId = action + '(' + vals.join(',') + ')';
        }

        // --- Loading: show indicators ---
        __lightLoadingCount++;
        __loadingStartTime = Date.now();
        __currentActionId = actionId;
        syncLoadingElements(true, action, actionId);

        let useFormData = containsBinaryValue(params);
        let requestHeaders = {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-TOKEN': csrfToken,
            'X-Light': 'true',
            'X-Light-Component': component,
            'X-Light-Fingerprint': fingerprint,
        };

        let requestBody;

        if (useFormData) {
            let formData = new FormData();
            formData.append('url', window.location.href);
            formData.append('action', action);
            formData.append('component', component);
            formData.append('fingerprint', fingerprint);
            formData.append('params', JSON.stringify(stripBinaryValues(params)));
            if (stateSnapshot && typeof stateSnapshot === 'object') {
                formData.append('state', JSON.stringify(stateSnapshot));
            }
            appendBinaryValues(formData, params);
            requestBody = formData;
        } else {
            requestHeaders['Content-Type'] = 'application/json';
            requestBody = JSON.stringify({
                url: window.location.href,
                action,
                params,
                state: stateSnapshot,
                component,
                fingerprint,
            });
        }

        return fetch(endpoint, {
            method: 'POST',
            headers: requestHeaders,
            signal: controller ? controller.signal : undefined,
            body: requestBody,
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
                    syncLoadingElements(false, action, actionId);
                    __currentActionId = null;
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

    /**
     * Navigate to a specific page for a paginated resource.
     * For custom pagination: Lightvel.goToPage('users', 3)
     * Automatically finds the paginate-action from the matching light:paginate element.
     */
    window.Lightvel.goToPage = function (resource, page) {
        let pageNum = parseInt(page, 10);
        if (isNaN(pageNum) || pageNum < 1) return;

        // Find the paginate element for this resource to get the action name
        let paginateEl = document.querySelector('[data-light-paginate="' + resource + '"]');
        let actionName = paginateEl
            ? (paginateEl.getAttribute('data-light-paginate-action') || '')
            : '';

        if (actionName) {
            call(actionName, { page: pageNum });
        } else {
            let url = new URL(window.location.href);
            url.searchParams.set('page', pageNum);
            navigateTo(url.toString());
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
        if (!patchData || typeof patchData !== 'object') return false;

        let anyDirty = false;

        Object.entries(patchData).forEach(([resource, actions]) => {
            if (!actions || typeof actions !== 'object') return;

            let resourceDirty = false;

            let targetArray = api.state[resource];
            let isPaginator = false;
            let paginatorState = null;
            let insertCount = 0;
            let deleteCount = 0;

            if (targetArray && typeof targetArray === 'object' && !Array.isArray(targetArray) && 'data' in targetArray && 'current_page' in targetArray) {
                paginatorState = targetArray;
                targetArray = targetArray.data;
                isPaginator = true;
            }

            if (targetArray && typeof targetArray === 'object' && !Array.isArray(targetArray)) {
                targetArray = Object.values(targetArray);
            }

            if (!Array.isArray(targetArray)) {
                return;
            }

            // --- DELETE (bare IDs) ---
            if (Array.isArray(actions.delete) && actions.delete.length) {
                let deleteIds = new Set(actions.delete.map(id => String(id)));
                deleteCount = deleteIds.size;
                targetArray = targetArray.filter(item => {
                    let id = findPatchItemId(item);
                    if (id === undefined || id === null) return true;
                    return !deleteIds.has(String(id));
                });
                resourceDirty = true;
            }

            // --- UPDATE (objects with id + changed fields) ---
            if (Array.isArray(actions.update) && actions.update.length) {
                let updatesById = new Map();
                actions.update.forEach(item => {
                    if (item && typeof item === 'object') {
                        let id = findPatchItemId(item);
                        if (id !== undefined && id !== null) {
                            updatesById.set(String(id), item);
                        }
                    }
                });

                if (updatesById.size) {
                    targetArray = targetArray.map(item => {
                        let id = findPatchItemId(item);
                        if (id === undefined || id === null) return item;
                        let updated = updatesById.get(String(id));
                        if (!updated) return item;
                        return { ...item, ...updated };
                    });
                    resourceDirty = true;
                }
            }

            // --- INSERT (objects with id + fields) ---
            if (Array.isArray(actions.insert) && actions.insert.length) {
                let insertItems = actions.insert.filter(item => item && typeof item === 'object');
                if (insertItems.length) {
                    insertCount = insertItems.length;
                    let insertIds = new Set(
                        insertItems
                            .map(item => findPatchItemId(item))
                            .filter(id => id !== undefined && id !== null)
                            .map(id => String(id))
                    );

                    let rest = targetArray.filter(item => {
                        let id = findPatchItemId(item);
                        if (id === undefined || id === null) return true;
                        return !insertIds.has(String(id));
                    });

                    targetArray = [...insertItems, ...rest];

                    if (isPaginator && paginatorState) {
                        let perPage = Number(paginatorState.per_page || targetArray.length || 10);
                        targetArray = targetArray.slice(0, Math.max(1, perPage));
                    }

                    resourceDirty = true;
                }
            }

            // --- FILL (optional helper items for paginator delete) ---
            // Server can include actions.fill to keep page length stable after delete
            // without making a second AJAX request.
            if (isPaginator && Array.isArray(actions.fill) && actions.fill.length) {
                let perPage = Number(paginatorState?.per_page || targetArray.length || 10);
                if (targetArray.length < perPage) {
                    let existingIds = new Set(
                        targetArray
                            .map(item => findPatchItemId(item))
                            .filter(id => id !== undefined && id !== null)
                            .map(id => String(id))
                    );

                    actions.fill.forEach((item) => {
                        if (!item || typeof item !== 'object') return;
                        if (targetArray.length >= perPage) return;

                        let id = findPatchItemId(item);
                        if (id !== undefined && id !== null && existingIds.has(String(id))) {
                            return;
                        }

                        targetArray.push(item);
                        if (id !== undefined && id !== null) {
                            existingIds.add(String(id));
                        }
                    });

                    resourceDirty = true;
                }
            }

            // Write back
            if (resourceDirty) {
                if (isPaginator) {
                    api.state[resource] = { ...api.state[resource], data: targetArray };

                    if (paginatorState && (insertCount > 0 || deleteCount > 0)) {
                        let perPage = Number(paginatorState.per_page || targetArray.length || 10);
                        let currentPage = Number(paginatorState.current_page || 1);
                        let totalBefore = Number(paginatorState.total || 0);
                        let totalAfter = Math.max(0, totalBefore + insertCount - deleteCount);
                        let lastPageAfter = Math.max(1, Math.ceil(totalAfter / Math.max(1, perPage)));
                        let safePage = Math.min(Math.max(1, currentPage), lastPageAfter);

                        api.state[resource] = {
                            ...api.state[resource],
                            total: totalAfter,
                            last_page: lastPageAfter,
                            current_page: safePage,
                        };
                    }
                } else {
                    api.state[resource] = targetArray;
                }

                // Force-invalidate light:for cache
                document.querySelectorAll('[data-light-for]').forEach(node => {
                    node._lightForLastRef = null;
                    node._lightForLastLen = -1;
                });

                anyDirty = true;
            }
        });

        return anyDirty;
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

        // Collect resource names targeted by __patch BEFORE processing,
        // so we can skip them during state merge (they'd contain stale data
        // from getDeltaState that would overwrite the patched array).
        let patchedResources = new Set();
        if (payload.__patch && typeof payload.__patch === 'object') {
            Object.keys(payload.__patch).forEach(k => patchedResources.add(k));
        }

        if (payload.__patch !== undefined) {
            let patchResult = applyPatchOperations(api, payload.__patch);
            delete payload.__patch;
            hasPatch = !!patchResult;
        }

        Object.entries(payload).forEach(([k, v]) => {
            if (k.startsWith('__')) return;
            // Skip patched resources — their stale data from getDeltaState
            // would overwrite the freshly patched client-side array.
            if (patchedResources.has(k)) {
                let isFreshPaginator = v
                    && typeof v === 'object'
                    && !Array.isArray(v)
                    && Array.isArray(v.data)
                    && Object.prototype.hasOwnProperty.call(v, 'current_page');

                if (!isFreshPaginator) {
                    return;
                }
            }
            api.state[k] = v;
        });

        // Full sync: update ALL bindings including text, conditionals, loops.
        // Cache was already invalidated inside applyPatchOperations(),
        // so flushSyncBindings() → renderLightForTemplates() will rebuild DOM.
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
    function syncLoadingElements(isLoading, actionName, actionId) {
        document.querySelectorAll('[data-light-loading]').forEach((el) => {
            let target = el.getAttribute('data-light-loading-target') || '';
            
            // If this element has a target, only activate it for matching action
            if (target) {
                let matchesAction = !!actionName && target === actionName;
                let matchesActionId = !!actionId && target === actionId;

                if (!matchesAction && !matchesActionId) {
                    return;
                }
            }

            let delayMs = parseInt(el.getAttribute('data-light-loading-delay') || '0', 10) || 0;
            let minMs = parseInt(el.getAttribute('data-light-loading-min') || '0', 10) || 0;

            // Helper: toggle sibling [data-light-loading-remove] elements
            let toggleRemove = (show) => {
                let parent = el.parentElement;
                if (!parent) return;
                let selector = '[data-light-loading-remove]';
                if (el.hasAttribute('data-light-cloak')) {
                    selector += ', [data-light-cloak-remove]';
                }

                parent.querySelectorAll(selector).forEach(rem => {
                    rem.style.display = show ? '' : 'none';
                });
            };

            if (isLoading) {
                if (__loadingDelayTimers.has(el)) {
                    clearTimeout(__loadingDelayTimers.get(el));
                    __loadingDelayTimers.delete(el);
                }

                if (delayMs > 0) {
                    let timer = setTimeout(() => {
                        el.setAttribute('data-light-loading-active', 'true');
                        toggleRemove(false);
                        __loadingDelayTimers.delete(el);
                        if (minMs > 0) {
                            __loadingMinEndTimes.set(el, Date.now() + minMs);
                        }
                    }, delayMs);
                    __loadingDelayTimers.set(el, timer);
                } else {
                    el.setAttribute('data-light-loading-active', 'true');
                    toggleRemove(false);
                    if (minMs > 0) {
                        __loadingMinEndTimes.set(el, Date.now() + minMs);
                    }
                }
            } else {
                if (__loadingDelayTimers.has(el)) {
                    clearTimeout(__loadingDelayTimers.get(el));
                    __loadingDelayTimers.delete(el);
                }

                let minEnd = __loadingMinEndTimes.get(el) || 0;
                let remaining = minEnd - Date.now();

                if (remaining > 0) {
                    let timer = setTimeout(() => {
                        el.removeAttribute('data-light-loading-active');
                        toggleRemove(true);
                        __loadingMinEndTimes.delete(el);
                        __loadingDelayTimers.delete(el);
                    }, remaining);
                    __loadingDelayTimers.set(el, timer);
                } else {
                    el.removeAttribute('data-light-loading-active');
                    toggleRemove(true);
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

    function normalizeNavigateUrl(url) {
        try {
            let parsed = new URL(url, window.location.href);
            return parsed.origin + parsed.pathname + parsed.search;
        } catch (_) {
            return String(url || '').split('#')[0];
        }
    }

    function fetchNavigatePayload(targetUrl) {
        let normalized = normalizeNavigateUrl(targetUrl);
        if (!normalized) {
            return Promise.reject(new Error('Invalid navigate URL'));
        }

        let cached = __navigateCache.get(normalized);
        if (cached && (Date.now() - cached.cachedAt) < __NAVIGATE_CACHE_TTL) {
            return Promise.resolve({ type: cached.type, payload: cached.payload });
        }

        if (__navigateInFlight.has(normalized)) {
            return __navigateInFlight.get(normalized);
        }

        let req = fetch(targetUrl, {
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
                __navigateCache.set(normalized, {
                    type: result.type,
                    payload: result.payload,
                    cachedAt: Date.now(),
                });

                return result;
            })
            .finally(() => {
                __navigateInFlight.delete(normalized);
            });

        __navigateInFlight.set(normalized, req);
        return req;
    }

    function prefetchNavigate(url) {
        if (!url || !isSameOrigin(url)) return;

        fetchNavigatePayload(url).catch(() => {
            // Ignore prefetch errors silently.
        });
    }

    function navigateTo(url, options = {}) {
        let targetUrl = url;
        let currentUrl = window.location.href.split('#')[0];

        if (targetUrl.indexOf('#') !== -1 && targetUrl.split('#')[0] === currentUrl) {
            window.location.hash = targetUrl.split('#')[1];
            return;
        }

        // React-like feel: switch route state first, then hydrate fetched HTML/state.
        if (!options.fromPop) {
            if (options.replace) {
                history.replaceState({}, '', targetUrl);
            } else {
                history.pushState({}, '', targetUrl);
            }
        }
        startProgress();

        fetchNavigatePayload(targetUrl)
            .then((result) => {
                if (result.type === 'json') {
                    update(result.payload);
                    return;
                }

                // Smooth SPA HTML navigation!
                // Set booting only when we are about to swap new HTML,
                // so current page does not go blank during network wait.
                document.documentElement.setAttribute('data-light-booting', 'true');
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
                document.body.className = doc.body.className || '';

                // 4. Re-create progress bar element (innerHTML destroyed the old one)
                progressEl = null; // Force re-creation on next navigate

                // 5. Re-execute scripts (since innerHTML doesn't execute newly injected <script> tags)
                document.body.querySelectorAll('script').forEach((oldScript) => {
                    if (
                        oldScript.getAttribute('data-light-runtime') === 'true'
                        || oldScript.getAttribute('data-light-boot-config') === 'true'
                    ) {
                        oldScript.remove();
                        return;
                    }

                    let newScript = document.createElement('script');
                    Array.from(oldScript.attributes).forEach((attr) => newScript.setAttribute(attr.name, attr.value));
                    newScript.appendChild(document.createTextNode(oldScript.innerHTML));
                    oldScript.parentNode.replaceChild(newScript, oldScript);
                });

                // 6. Reset scroll
                if (!options.fromPop) {
                    window.scrollTo(0, 0);
                }

                // 7. Initialize Component State and DOM bindings for the newly injected HTML
                initJsState(document);
                syncBindings();
            })
            .catch((err) => {
                console.error('[Lightvel] SPA Navigate Error:', err);
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
        let imageRoot = e.target.closest('[data-light-image]');
        if (imageRoot) {
            let fileInput = imageRoot.querySelector('input[type="file"]');
            if (fileInput && !e.target.closest('input,textarea,select,button,a,label')) {
                e.preventDefault();
                fileInput.click();
                return;
            }
        }

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

    document.addEventListener('click', (e) => {
        let el = e.target.closest('[data-light-array-add]');
        if (!el) return;

        if (el.tagName === 'BUTTON' || el.tagName === 'A') {
            e.preventDefault();
        }

        let api = getJsApi();
        let parsed = parseArrayDirectiveArgs(el.dataset.lightArrayAdd || '');
        if (!parsed.arrayKey || !parsed.valueExpr) return;

        let value = evaluateLightExpression(parsed.valueExpr, api.state);
        toggleArrayValue(parsed.arrayKey, value, api);
        queueSyncBindings(parsed.arrayKey);
    });

    document.addEventListener('click', (e) => {
        let el = e.target.closest('[data-light-array-all]');
        if (!el) return;

        if (el.tagName === 'BUTTON' || el.tagName === 'A') {
            e.preventDefault();
        }

        applyArrayAllDirective(el.dataset.lightArrayAll || '');

        let parsed = parseArrayDirectiveArgs(el.dataset.lightArrayAll || '');
        if (parsed.arrayKey) {
            queueSyncBindings(parsed.arrayKey);
        } else {
            queueSyncBindings();
        }
    });

    document.addEventListener('click', (e) => {
        let el = e.target.closest('[data-light-json-add]');
        if (!el) return;

        if (el.tagName === 'BUTTON' || el.tagName === 'A') {
            e.preventDefault();
        }

        let api = getJsApi();
        let parts = splitTopLevelArgs(el.dataset.lightJsonAdd || '');
        let path = stripWrappingQuotes(parts[0] || '');
        let valueExpr = parts[1] || '';
        if (!path || !valueExpr) return;

        let value = evaluateLightExpression(valueExpr, api.state);
        appendJsonValue(path, value, api);
        queueSyncBindings(path);
    });

    document.addEventListener('click', (e) => {
        let el = e.target.closest('[data-light-json-remove]');
        if (!el) return;

        if (el.tagName === 'BUTTON' || el.tagName === 'A') {
            e.preventDefault();
        }

        let api = getJsApi();
        let parsed = parseJsonDirectiveArgs(el.dataset.lightJsonRemove || '');
        let path = resolveJsonPath(parsed.pathExpr, api.state);
        if (!path) return;

        if (!parsed.arg1Expr) {
            removeJsonPath(path, api);
            queueSyncBindings(path);
            return;
        }

        let target = evaluateLightExpression(parsed.arg1Expr, api.state);
        let mode = parsed.arg2Expr ? stripWrappingQuotes(parsed.arg2Expr) : 'auto';
        removeJsonValue(path, target, mode, api);
        queueSyncBindings(path);
    });

    // --- light:navigate → SPA-style navigation without full page reload ---
    document.addEventListener('click', (e) => {
        let link = e.target.closest('a[data-light-navigate]');
        if (!link) return;
        if (!shouldHandleNavigate(link, e)) return;

        e.preventDefault();
        navigateTo(link.href);
    });

    // Next.js-like prefetch: warm navigation response on intent (hover/focus/touch).
    document.addEventListener('mouseover', (e) => {
        let link = e.target.closest('a[data-light-navigate]');
        if (!link || !link.href) return;

        let from = e.relatedTarget;
        if (from && from.nodeType === 1 && link.contains(from)) return;
        prefetchNavigate(link.href);
    });

    document.addEventListener('focusin', (e) => {
        let link = e.target.closest('a[data-light-navigate]');
        if (!link || !link.href) return;
        prefetchNavigate(link.href);
    });

    document.addEventListener('touchstart', (e) => {
        let link = e.target.closest('a[data-light-navigate]');
        if (!link || !link.href) return;
        prefetchNavigate(link.href);
    }, { passive: true });

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
        let actionEl = e.target.closest('[data-light-input]');
        if (actionEl) {
            let parsed = parse(actionEl.dataset.lightInput);
            let state = collect();
            let debounceMs = getElementDebounceMs(actionEl);

            if (parsed.args.length) {
                call(parsed.action, parsed.args, {
                    debounceMs,
                    debounceKey: `input:${parsed.action}`,
                });
            } else {
                call(parsed.action, state, {
                    debounceMs,
                    debounceKey: `input:${parsed.action}`,
                });
            }
        }

        let modelEl = e.target.closest('[data-light-model]');
        if (modelEl) {
            let field = getFieldName(modelEl);
            if (!field) return;

            let api = getJsApi();
            setValueByPath(api.state, field, getElementValue(modelEl));
            queueSyncBindings(field);

            // Real-time field validation as user types
            let result = validateElement(modelEl, getRootRules());
            if (result) {
                setFieldErrors(result.field, result.errors);
            }

            // If light:model.live has explicit action name, trigger it.
            // Otherwise behave as plain light:model (no auto form submit).
            triggerLiveModelAction(modelEl);

            return;
        }

        // JS-only model binding (no server sync)
        let el = e.target.closest('[data-light-js-model]');
        if (!el) return;

        let field = getFieldName(el);
        if (!field) return;

        let api = getJsApi();
        setValueByPath(api.state, field, getElementValue(el));
        queueSyncBindings(field);

        let result = validateElement(el, getRootRules());
        if (result) {
            setFieldErrors(result.field, result.errors);
        }
    });

    // --- change event — for selects, checkboxes, radios ---
    document.addEventListener('change', (e) => {
        let imageRoot = e.target.closest('[data-light-image]');
        if (imageRoot && e.target.matches('input[type="file"]')) {
            applyLightImageSelection(imageRoot, e.target, getJsApi());
        }

        let actionEl = e.target.closest('[data-light-change]');
        if (actionEl) {
            let parsed = parse(actionEl.dataset.lightChange);
            let state = collect();
            let debounceMs = getElementDebounceMs(actionEl);

            if (parsed.args.length) {
                call(parsed.action, parsed.args, {
                    debounceMs,
                    debounceKey: `change:${parsed.action}`,
                });
            } else {
                call(parsed.action, state, {
                    debounceMs,
                    debounceKey: `change:${parsed.action}`,
                });
            }
        }

        let modelEl = e.target.closest('[data-light-model]');
        if (modelEl) {
            let field = getFieldName(modelEl);
            if (!field) return;

            let api = getJsApi();
            setValueByPath(api.state, field, getElementValue(modelEl));
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
        setValueByPath(api.state, field, getElementValue(el));
        queueSyncBindings(field);

        let result = validateElement(el, getRootRules());
        if (result) {
            setFieldErrors(result.field, result.errors);
        }
    });

    // =======================================================================
    // INITIALIZATION — runs immediately (script is placed before </body>)
    // 1. Read all data-light-server-state and data-light-state into api.state
    // 2. Boot finalization happens inside initJsState() after deferred state hydration
    // 3. Render any existing validation errors
    // =======================================================================
    initJsState(document);
})();
