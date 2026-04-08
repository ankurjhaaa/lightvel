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

    function collect(scope = document) {
        let values = {};
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
        if (data.__lightvel_dom) {
            let wrap = document.createElement('div');
            wrap.innerHTML = data.__lightvel_dom;
            let nextRoot = wrap.firstElementChild;
            let currentRoot = document.querySelector('[data-light-root]');

            if (nextRoot && currentRoot) {
                currentRoot.replaceWith(nextRoot);
            }

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

        let parsed = parse(el.dataset.lightClick);
        let state = collect();

        if (parsed.args.length) {
            call(parsed.action, parsed.args);
        } else {
            call(parsed.action, state);
        }
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

        let data = {
            ...collect(f),
            ...Object.fromEntries(new FormData(f).entries()),
        };

        call(f.dataset.lightSubmit, data);
    });
})();
