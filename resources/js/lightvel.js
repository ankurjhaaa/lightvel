(function () {
    let progressEl = null;
    let progressTimer = null;

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
        el.style.backgroundColor = getConfig().progressBarColor || '#111827';
        el.style.transition = 'none';
        el.style.width = '0%';
        el.style.opacity = '1';

        requestAnimationFrame(() => {
            el.style.transition = 'width 300ms ease, opacity 250ms ease';
            el.style.width = '70%';
        });

        clearTimeout(progressTimer);
        progressTimer = setTimeout(() => {
            el.style.width = '90%';
        }, 350);
    }

    function endProgress() {
        if (!progressEl) return;

        clearTimeout(progressTimer);
        progressEl.style.width = '100%';

        setTimeout(() => {
            if (!progressEl) return;
            progressEl.style.opacity = '0';
            progressEl.style.width = '0%';
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

        document.querySelectorAll(`[data-light-js-show]`).forEach((el) => {
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

        document.querySelectorAll(`[data-light-js-class]`).forEach((el) => {
            let expr = el.getAttribute('data-light-js-class');
            applyConditionalClasses(el, expr, api.state);
        });

        document.querySelectorAll('[data-light-class]').forEach((el) => {
            if (el.getAttribute('data-light-scoped') === '1') {
                return;
            }

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

        scope.querySelectorAll('[data-light-server-state]').forEach((el) => {
            let raw = el.getAttribute('data-light-server-state');
            if (!raw) return;

            try {
                let serverState = JSON.parse(raw);
                if (typeof serverState === 'object' && serverState !== null) {
                    Object.entries(serverState).forEach(([key, value]) => {
                        if (api.state[key] === undefined) {
                            api.state[key] = value;
                        }
                    });
                }
            } catch (_) {
                // ignore invalid server state
            }
        });

        scope.querySelectorAll('[data-light-state]').forEach((el) => {
            if (el.hasAttribute('data-light-server-state')) {
                return;
            }

            let rawState = el.getAttribute('data-light-state');
            if (!rawState) return;

            if (rawState.includes('=') || rawState.includes(',')) {
                return;
            }

            try {
                let serverState = JSON.parse(rawState);
                if (typeof serverState === 'object' && serverState !== null) {
                    Object.entries(serverState).forEach(([key, value]) => {
                        if (api.state[key] === undefined) {
                            api.state[key] = value;
                        }
                    });
                }
            } catch (_) {
                // ignore invalid state json
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

    function evalJsExpr(expr, state) {
        try {
            let code = expr.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g, function (match) {
                if (match === 'true' || match === 'false' || match === 'null' || match === 'undefined') {
                    return match;
                }
                return Object.prototype.hasOwnProperty.call(state, match) ? JSON.stringify(state[match]) : match;
            });
            return Function('"use strict"; return (' + code + ')')();
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

    function evaluateLightExpression(expr, scopeState = null, extraScope = null) {
        let api = getJsApi();
        let state = Object.assign({}, api.consts || {}, scopeState || api.state || {});
        let extras = extraScope || {};
        let normalizedExpr = normalizeLightExpression(expr);

        try {
            return Function('state', 'scope', 'with(state){ with(scope){ return (' + normalizedExpr + '); } }')(state, extras);
        } catch (_) {
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

    function syncBindings(key) {
        if (key) {
            syncJsBindings(key);
        } else {
            let api = getJsApi();
            Object.keys(api.state).forEach((stateKey) => syncJsBindings(stateKey));
        }

        syncLightTextBindings(key);
        syncLightConditionals();
        renderLightForTemplates();
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

    function renderLightForTemplates() {
        let api = getJsApi();

        document.querySelectorAll('[data-light-for]').forEach((node) => {
            let expr = node.getAttribute('data-light-for') || '';
            let match = expr.match(/^\s*([A-Za-z_$][\w$]*)\s+in\s+(.+)\s*$/);
            if (!match || !node.parentNode) return;

            let itemName = match[1];
            let sourceExpr = match[2];
            let list = evaluateLightExpression(sourceExpr, api.state);


            if (list && typeof list === 'object' && !Array.isArray(list)) {
                list = Object.values(list);
            }

            if (!Array.isArray(list)) {
                list = [];
            }

            let isTemplate = node.tagName === 'TEMPLATE';

            if (!isTemplate) {
                node.style.display = 'none';

                if (!node._lightForTemplateNode) {
                    node._lightForTemplateNode = node.cloneNode(true);
                    node._lightForTemplateNode.removeAttribute('data-light-for');
                }
            } else if (!node._lightForSourceHtml) {
                node._lightForSourceHtml = node.innerHTML;
            }

            if (node._lightRenderedNodes && node._lightRenderedNodes.length) {
                node._lightRenderedNodes.forEach((renderedNode) => renderedNode.remove());
            }

            let wrapper = document.createDocumentFragment();
            let nodes = [];

            list.forEach((item, index) => {
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

            node.after(wrapper);
            node._lightRenderedNodes = nodes;
        });
    }

    function applyFunctionAssignments(raw, api) {
        if (!raw) return;

        let expr = raw.trim();

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

        if (typeof fn !== 'function') {
            console.warn('Lightvel function not found:', name);
            return;
        }

        let api = getJsApi();
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

    function sendLightAction(action, params = {}, options = {}) {
        let csrfToken = document.querySelector('meta[name=csrf-token]')?.content || '';
        let root = document.querySelector('[data-light-root]');
        let endpoint = root?.dataset.lightEndpoint || getConfig().messageEndpoint || '/lightvel/message';
        let component = root?.dataset.lightComponent || '';
        let fingerprint = root?.dataset.lightFingerprint || '';

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

        return fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
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
                syncBindings();
                setErrors({ __global: [api.state.message] });

                document.querySelectorAll('[data-light-bind="status"]').forEach((el) => {
                    el.innerText = 'Request failed. Check console/logs.';
                });
            })
            .finally(() => {
                if (cancelKey && __activeControllers[cancelKey] === controller) {
                    delete __activeControllers[cancelKey];
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

    function update(data, fallbackKey = 'data') {
        let api = getJsApi();
        let payload = normalizeStoredPayload(data, fallbackKey);


        if (payload.__lightvel_errors !== undefined) {
            setErrors(payload.__lightvel_errors || {});
            delete payload.__lightvel_errors;
        } else if (payload.errors && typeof payload.errors === 'object') {
            setErrors(payload.errors || {});
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'message')) {
            api.state.message = payload.message ?? '';
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
            api.state.status = payload.status;

            if (payload.status === false && payload.message) {
                setErrors({ __global: [String(payload.message)] });
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

        Object.entries(payload).forEach(([k, v]) => {
            if (k.startsWith('__')) {
                return;
            }
            api.state[k] = v;
        });

        syncBindings();
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
                'X-Light': 'true',
                'X-Light-Navigate': 'true',
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

                window.location.href = targetUrl;
            })
            .catch((err) => {
                console.error('Lightvel navigation failed:', err);
                window.location.href = targetUrl;
            })
            .finally(() => {
                endProgress();
            });
    }

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

    document.addEventListener('click', (e) => {
        let el = e.target.closest('[data-light-function]');
        if (!el) return;

        if (el.tagName === 'BUTTON' || el.tagName === 'A') {
            e.preventDefault();
        }

        let api = getJsApi();
        let parsed = parse(el.dataset.lightFunction);
        let resolvedArgs = (parsed.args || []).map((arg) => evaluateLightExpression(arg, api.state));

        invokeCustomFunction(parsed.action, resolvedArgs, { event: e, el });
    });

    document.addEventListener('click', (e) => {
        let link = e.target.closest('a[data-light-navigate]');
        if (!link) return;
        if (!shouldHandleNavigate(link, e)) return;

        e.preventDefault();
        navigateTo(link.href);
    });

    window.addEventListener('popstate', () => {
        navigateTo(window.location.href, { replace: true, fromPop: true });
    });

    document.addEventListener('submit', (e) => {
        let f = e.target.closest('[data-light-submit]');
        if (!f) return;

        e.preventDefault();

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

    document.addEventListener('input', (e) => {
        let modelEl = e.target.closest('[data-light-model]');
        if (modelEl) {
            let field = getFieldName(modelEl);
            if (!field) return;

            let api = getJsApi();
            api.state[field] = getElementValue(modelEl);
            syncBindings(field);

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
        syncBindings(field);

        let result = validateElement(el, getRootRules());
        if (result) {
            setFieldErrors(result.field, result.errors);
        }
    });

    document.addEventListener('change', (e) => {
        let modelEl = e.target.closest('[data-light-model]');
        if (modelEl) {
            let field = getFieldName(modelEl);
            if (!field) return;

            let api = getJsApi();
            api.state[field] = getElementValue(modelEl);
            syncBindings(field);

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
        syncBindings(field);

        let result = validateElement(el, getRootRules());
        if (result) {
            setFieldErrors(result.field, result.errors);
        }
    });

    initJsState(document);
    renderErrors(getJsApi().errors || {});
})();
