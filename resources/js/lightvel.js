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
        api.actions = api.actions || {};
        api.errors = api.errors || {};

        api.set = api.set || function (key, value) {
            api.state[key] = value;
            syncJsBindings(key);
        };

        api.get = api.get || function (key) {
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

        document.querySelectorAll(`[data-light-js-model="${key}"]`).forEach((el) => {
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
            el.style.display = isVisible ? '' : 'none';
        });

        document.querySelectorAll(`[data-light-js-class]`).forEach((el) => {
            let expr = el.getAttribute('data-light-js-class');
            applyConditionalClasses(el, expr, api.state);
        });
    }

    function syncAllJsBindings() {
        let api = getJsApi();
        Object.keys(api.state).forEach((key) => syncJsBindings(key));
    }

    function initJsState(scope = document) {
        let api = getJsApi();

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

        syncAllJsBindings();
    }

    function getRootRules() {
        let root = document.querySelector('[data-light-root]');
        if (!root) return {};
        let raw = root.getAttribute('data-light-rules');
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

        scope.querySelectorAll('[data-light-js-model], [data-light-model], [data-light-js-rules]').forEach((el) => {
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
        let values = {};
        let root = document.querySelector('[data-light-root]');

        if (root) {
            let rawState = root.getAttribute('data-light-state');
            if (rawState) {
                try {
                    values = { ...JSON.parse(rawState) };
                } catch (_) {
                    values = {};
                }
            }
        }

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

    function stripQuotes(value) {
        if (typeof value !== 'string') return value;
        let s = value.trim();
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
            return s.slice(1, -1);
        }
        return s;
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

    function runBuiltinJsAction(action, args, api) {
        let name = (action || '').trim();
        let key = stripQuotes(args[0] || '');

        if (!name || !key) return false;

        if (name === 'inc') {
            let step = Number(stripQuotes(args[1] ?? 1)) || 1;
            let current = Number(api.get(key) || 0);
            api.set(key, current + step);
            return true;
        }

        if (name === 'dec') {
            let step = Number(stripQuotes(args[1] ?? 1)) || 1;
            let current = Number(api.get(key) || 0);
            api.set(key, current - step);
            return true;
        }

        if (name === 'toggle') {
            let hasState = Object.prototype.hasOwnProperty.call(api.state, key);
            let current = hasState ? Boolean(api.state[key]) : false;
            api.set(key, !Boolean(current));
            return true;
        }

        return false;
    }

    function call(action, params = {}) {
        fetch(window.location.href, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': document.querySelector('meta[name=csrf-token]').content,
                'X-Light': 'true',
            },
            body: JSON.stringify({ action, params }),
        })
            .then((r) => {
                if (!r.ok) {
                    throw new Error('Request failed with status ' + r.status);
                }

                return r.json();
            })
            .then(update)
            .catch((err) => {
                console.error('Lightvel request failed:', err);

                document.querySelectorAll('[data-light-bind="status"]').forEach((el) => {
                    el.innerText = 'Request failed. Check console/logs.';
                });
            });
    }

    function update(data) {
        if (data.__lightvel_errors !== undefined) {
            setErrors(data.__lightvel_errors || {});
            delete data.__lightvel_errors;
        }

        if (data.__lightvel_dom) {
            let wrap = document.createElement('div');
            wrap.innerHTML = data.__lightvel_dom;
            let nextRoot = wrap.firstElementChild;
            let currentRoot = document.querySelector('[data-light-root]');

            if (nextRoot && currentRoot) {
                currentRoot.replaceWith(nextRoot);
            }

            initJsState(document);
            renderErrors(getJsApi().errors || {});

            return;
        }

        Object.entries(data).forEach(([k, v]) => {
            document.querySelectorAll(`[data-light-model="${k}"]`).forEach((el) => (el.value = v ?? ''));
            document.querySelectorAll(`[data-light-bind="${k}"]`).forEach((el) => (el.innerText = v ?? ''));
            document.querySelectorAll(`[data-light-html="${k}"]`).forEach((el) => (el.innerHTML = v ?? ''));
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

        if (!validateScope(document)) return;

        let parsed = parse(el.dataset.lightClick);
        let state = collect();

        if (parsed.args.length) {
            call(parsed.action, parsed.args);
        } else {
            call(parsed.action, state);
        }
    });

    document.addEventListener('click', (e) => {
        let el = e.target.closest('[data-light-js-click]');
        if (!el) return;

        let parsed = parse(el.dataset.lightJsClick);
        let api = getJsApi();
        let handler = api.actions[parsed.action];

        if (runBuiltinJsAction(parsed.action, parsed.args, api)) {
            return;
        }

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

        call(f.dataset.lightSubmit, data);
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
        let el = e.target.closest('[data-light-js-model]');
        if (!el) return;

        let field = getFieldName(el);
        if (!field) return;

        let api = getJsApi();
        api.state[field] = getElementValue(el);
        syncJsBindings(field);

        let result = validateElement(el, getRootRules());
        if (result) {
            setFieldErrors(result.field, result.errors);
        }
    });

    document.addEventListener('change', (e) => {
        let el = e.target.closest('[data-light-js-model]');
        if (!el) return;

        let field = getFieldName(el);
        if (!field) return;

        let api = getJsApi();
        api.state[field] = getElementValue(el);
        syncJsBindings(field);

        let result = validateElement(el, getRootRules());
        if (result) {
            setFieldErrors(result.field, result.errors);
        }
    });

    initJsState(document);
    renderErrors(getJsApi().errors || {});
})();
