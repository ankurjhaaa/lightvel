<?php

namespace Lightvel\Support\Debug;

class PanelRenderer
{
    public static function inject(string $html, array $payload): string
    {
        if (! config('app.debug')) {
            return $html;
        }

        $panel = static::render($payload);

        if (str_contains(strtolower($html), '</body>')) {
            return preg_replace('~</body>~i', $panel . "\n</body>", $html, 1) ?? ($html . $panel);
        }

        return $html . $panel;
    }

    public static function render(array $payload): string
    {
        $json = htmlspecialchars(json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '{}', ENT_QUOTES, 'UTF-8');

        return <<<HTML
<div id="lightvel-debug-root" data-lightvel-debug-state="mini" data-lightvel-debug-payload="{$json}" style="all: initial;">
    <style>
        #lightvel-debug-root, #lightvel-debug-root * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        #lightvel-debug-root { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
        #lightvel-debug-root .lv-hidden { display: none !important; }
        #lightvel-debug-root .lv-mini {
            width: 48px; height: 48px; border-radius: 999px; background: #111827; color: #fff;
            display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 10px 30px rgba(15, 23, 42, .35);
            border: 1px solid rgba(255,255,255,.15);
        }
        #lightvel-debug-root .lv-panel {
            width: 340px; height: 240px; background: rgba(15, 23, 42, .98); color: #e5e7eb; border: 1px solid rgba(148, 163, 184, .35);
            border-radius: 16px; box-shadow: 0 20px 60px rgba(15, 23, 42, .45); overflow: hidden; backdrop-filter: blur(10px);
        }
        #lightvel-debug-root[data-lightvel-debug-state="full"] {
            inset: 12px; right: 12px; bottom: 12px; left: 12px; top: 12px;
        }
        #lightvel-debug-root[data-lightvel-debug-state="full"] .lv-panel { width: 100%; height: 100%; border-radius: 18px; }
        #lightvel-debug-root .lv-header {
            height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 12px;
            background: linear-gradient(180deg, rgba(30, 41, 59, .95), rgba(15, 23, 42, .96));
            border-bottom: 1px solid rgba(148, 163, 184, .2); cursor: grab; user-select: none;
        }
        #lightvel-debug-root .lv-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; }
        #lightvel-debug-root .lv-dot { width: 9px; height: 9px; border-radius: 999px; background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,.16); }
        #lightvel-debug-root .lv-actions { display: flex; gap: 6px; }
        #lightvel-debug-root .lv-btn {
            appearance: none; border: 0; background: rgba(148, 163, 184, .14); color: #e5e7eb; width: 28px; height: 28px;
            border-radius: 8px; cursor: pointer; font-size: 15px; line-height: 28px; text-align: center;
        }
        #lightvel-debug-root .lv-body { height: calc(100% - 44px); overflow: auto; padding: 12px; }
        #lightvel-debug-root[data-lightvel-debug-state="mini"] .lv-panel,
        #lightvel-debug-root[data-lightvel-debug-state="mini"] .lv-full { display: none; }
        #lightvel-debug-root[data-lightvel-debug-state="compact"] .lv-mini,
        #lightvel-debug-root[data-lightvel-debug-state="compact"] .lv-full { display: none; }
        #lightvel-debug-root[data-lightvel-debug-state="full"] .lv-mini { display: none; }
        #lightvel-debug-root .lv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        #lightvel-debug-root .lv-card {
            background: rgba(15, 23, 42, .6); border: 1px solid rgba(148, 163, 184, .15); border-radius: 12px; padding: 10px;
        }
        #lightvel-debug-root .lv-k { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: .06em; }
        #lightvel-debug-root .lv-v { margin-top: 4px; font-size: 13px; color: #f8fafc; word-break: break-word; }
        #lightvel-debug-root .lv-list { display: flex; flex-direction: column; gap: 8px; }
        #lightvel-debug-root .lv-row { padding: 10px; border-radius: 10px; background: rgba(15, 23, 42, .55); border: 1px solid rgba(148, 163, 184, .12); }
        #lightvel-debug-root .lv-row code { display: block; white-space: pre-wrap; font-size: 12px; color: #e2e8f0; }
        #lightvel-debug-root .lv-badge { display:inline-flex; align-items:center; gap:6px; padding:3px 8px; border-radius:999px; background:rgba(148,163,184,.12); font-size:11px; color:#cbd5e1; }
        #lightvel-debug-root .lv-error { border-color: rgba(248, 113, 113, .35); background: rgba(127, 29, 29, .35); }
        #lightvel-debug-root .lv-empty { color:#94a3b8; font-size:13px; padding:6px 0; }
    </style>

    <div class="lv-mini" data-lv-open title="Lightvel debug">L</div>

    <div class="lv-panel lv-full" data-lv-full>
        <div class="lv-header" data-lv-drag>
            <div class="lv-title"><span class="lv-dot"></span>Lightvel Debug</div>
            <div class="lv-actions">
                <button class="lv-btn" type="button" data-lv-min title="Minimize">–</button>
                <button class="lv-btn" type="button" data-lv-fullbtn title="Expand">⤢</button>
                <button class="lv-btn" type="button" data-lv-close title="Close">×</button>
            </div>
        </div>

        <div class="lv-body">
            <div class="lv-grid">
                <div class="lv-card"><div class="lv-k">Request</div><div class="lv-v" data-lv-request></div></div>
                <div class="lv-card"><div class="lv-k">Timeline</div><div class="lv-v" data-lv-timeline></div></div>
                <div class="lv-card"><div class="lv-k">Route</div><div class="lv-v" data-lv-route></div></div>
                <div class="lv-card"><div class="lv-k">Memory</div><div class="lv-v" data-lv-memory></div></div>
            </div>

            <div style="height:10px"></div>
            <div class="lv-card">
                <div class="lv-k">Messages</div>
                <div class="lv-list" data-lv-messages></div>
            </div>

            <div style="height:10px"></div>
            <div class="lv-card">
                <div class="lv-k">Errors</div>
                <div class="lv-list" data-lv-errors></div>
            </div>

            <div style="height:10px"></div>
            <div class="lv-card">
                <div class="lv-k">Duplicate Queries</div>
                <div class="lv-list" data-lv-duplicates></div>
            </div>

            <div style="height:10px"></div>
            <div class="lv-card">
                <div class="lv-k">Models</div>
                <div class="lv-list" data-lv-models></div>
            </div>

            <div style="height:10px"></div>
            <div class="lv-card">
                <div class="lv-k">Queries</div>
                <div class="lv-list" data-lv-queries></div>
            </div>

            <div style="height:10px"></div>
            <div class="lv-card">
                <div class="lv-k">Views</div>
                <div class="lv-list" data-lv-views></div>
            </div>
        </div>
    </div>

    <script>
    (function () {
        const root = document.getElementById('lightvel-debug-root');
        if (!root) return;

        const KEY = 'lightvel-debug-state';
        let state = localStorage.getItem(KEY) || root.getAttribute('data-lightvel-debug-state') || 'mini';
        let drag = null;

        function getPayload() {
            try {
                return JSON.parse(root.getAttribute('data-lightvel-debug-payload') || '{}');
            } catch (_) {
                return {};
            }
        }

        function setState(next) {
            state = next;
            root.setAttribute('data-lightvel-debug-state', next);
            localStorage.setItem(KEY, next);
            render();
        }

        function esc(v) {
            return String(v ?? '').replace(/[&<>"]/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s]));
        }

        function renderList(el, items, emptyText) {
            if (!el) return;
            if (!items || !items.length) {
                el.innerHTML = '<div class="lv-empty">' + esc(emptyText) + '</div>';
                return;
            }

            el.innerHTML = items.map((item) => item()).join('');
        }

        function render() {
            const payload = getPayload();
            const req = payload.request || {};
            const timeline = payload.timeline || {};

            const reqEl = root.querySelector('[data-lv-request]');
            const timelineEl = root.querySelector('[data-lv-timeline]');
            const routeEl = root.querySelector('[data-lv-route]');
            const memoryEl = root.querySelector('[data-lv-memory]');
            const messagesEl = root.querySelector('[data-lv-messages]');
            const errorsEl = root.querySelector('[data-lv-errors]');
            const duplicatesEl = root.querySelector('[data-lv-duplicates]');
            const modelsEl = root.querySelector('[data-lv-models]');
            const queriesEl = root.querySelector('[data-lv-queries]');
            const viewsEl = root.querySelector('[data-lv-views]');

            if (reqEl) reqEl.innerHTML = '<span class="lv-badge">' + esc(req.method || '') + '</span> ' + esc(req.url || req.path || '') + '<br><span style="color:#94a3b8">#' + esc(req.id || '') + '</span>';
            if (timelineEl) timelineEl.innerHTML = esc((timeline.duration_ms || 0) + ' ms') + '<br><span style="color:#94a3b8">Views: ' + esc(timeline.views_count || 0) + ' · Queries: ' + esc(timeline.queries_count || 0) + '</span>';
            if (routeEl) routeEl.innerHTML = esc((req.route_method || req.method || '') + ' ' + (req.route_uri || req.path || '')) + '<br><span style="color:#94a3b8">' + esc(req.route_name || req.route_view || 'unnamed') + '</span>';
            if (memoryEl) memoryEl.innerHTML = esc((timeline.memory_used_mb || 0) + ' MB') + '<br><span style="color:#94a3b8">Peak ' + esc(timeline.memory_peak_mb || 0) + ' MB</span>';

            renderList(messagesEl, (payload.messages || []).map((m) => () => '<div class="lv-row"><span class="lv-badge">' + esc(m.level || 'info') + '</span> <span style="color:#94a3b8">' + esc(m.time || '') + '</span><div style="margin-top:6px">' + esc(m.message || '') + '</div></div>'), 'No messages');
            renderList(errorsEl, (payload.errors || []).map((e) => () => '<div class="lv-row lv-error"><div><strong>' + esc(e.class || 'Error') + '</strong></div><code>' + esc(e.message || '') + '</code>' + (e.file ? '<div style="margin-top:4px;color:#fca5a5">' + esc(e.file + ':' + (e.line || '')) + '</div>' : '') + '</div>'), 'No errors');
            renderList(duplicatesEl, (payload.duplicate_queries || []).map((q) => () => '<div class="lv-row"><span class="lv-badge">x' + esc(q.count || 0) + '</span><code>' + esc(q.query || '') + '</code></div>'), 'No duplicate queries');
            renderList(modelsEl, (payload.models || []).map((m) => () => '<div class="lv-row"><span class="lv-badge">x' + esc(m.count || 0) + '</span> ' + esc(m.class || '') + '</div>'), 'No models');
            renderList(queriesEl, (payload.queries || []).map((q) => () => '<div class="lv-row"><span class="lv-badge">' + esc(q.time_ms || 0) + ' ms</span><code>' + esc(q.sql || '') + '</code></div>'), 'No queries');
            renderList(viewsEl, (payload.views || []).map((v) => () => '<div class="lv-row"><span class="lv-badge">' + esc(v.time_ms || 0) + ' ms</span> ' + esc(v.name || '') + '</div>'), 'No views');

            if (state === 'mini') {
                root.querySelector('[data-lv-full]').classList.add('lv-hidden');
            } else {
                root.querySelector('[data-lv-full]').classList.remove('lv-hidden');
            }
        }

        function setPayload(payload) {
            root.setAttribute('data-lightvel-debug-payload', JSON.stringify(payload || {}));
            render();
        }

        root.addEventListener('click', function (e) {
            const open = e.target.closest('[data-lv-open]');
            const min = e.target.closest('[data-lv-min]');
            const close = e.target.closest('[data-lv-close]');
            const full = e.target.closest('[data-lv-fullbtn]');

            if (open) return setState('compact');
            if (min) return setState('mini');
            if (close) return setState('mini');
            if (full) return setState(state === 'full' ? 'compact' : 'full');
        });

        const header = root.querySelector('[data-lv-drag]');
        header?.addEventListener('pointerdown', function (e) {
            if (state === 'mini') return;
            if (e.target.closest('button')) return;
            if (state === 'full') return;

            const rect = root.getBoundingClientRect();
            drag = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            header.setPointerCapture?.(e.pointerId);
        });

        window.addEventListener('pointermove', function (e) {
            if (!drag || state !== 'compact') return;
            root.style.left = Math.max(8, e.clientX - drag.x) + 'px';
            root.style.top = Math.max(8, e.clientY - drag.y) + 'px';
            root.style.right = 'auto';
            root.style.bottom = 'auto';
        });

        window.addEventListener('pointerup', function () { drag = null; });

        window.LightvelDebug = window.LightvelDebug || {};
        window.LightvelDebug.update = setPayload;
        window.LightvelDebug.show = function () { setState('full'); };
        window.LightvelDebug.hide = function () { setState('mini'); };

        render();

        if ((getPayload().errors || []).length || (getPayload().status === false)) {
            setState('full');
        }
    })();
    </script>
</div>
HTML;
    }
}
