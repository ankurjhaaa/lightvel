(function () {
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
            .then((r) => r.json())
            .then(update);
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
