<?php

namespace Lightvel\Support\Blade;

use Illuminate\Support\Facades\Blade;
use Lightvel\Support\Assets;

/**
 * Registers custom Lightvel Blade directives that transform
 * light:* shorthand attributes into data-light-* HTML attributes.
 *
 * These data attributes are then processed by the JS runtime (lightvel.js).
 *
 * Directive mapping (Blade → HTML → JS handler):
 *
 *   light:model="x"          → data-light-model="x"          → input/change event listeners
 *   light:model.live="x"     → data-light-model + model-live → triggerLiveModelAction()
 *   light:click="action()"   → data-light-click="action()"   → click event → call() → sendLightAction()
 *   light:submit="action"    → data-light-submit="action"    → submit event → call() → sendLightAction()
 *   light:text="expr"        → data-light-text="expr"        → syncLightTextBindings()
 *   light:html="expr"        → data-light-html="expr"        → innerHTML binding
 *   light:src="expr"         → data-light-src="expr"         → src attribute binding
 *   light:show="expr"        → data-light-show="expr"        → syncLightConditionals() display toggle
 *   light:if="expr"          → data-light-if="expr"          → syncLightConditionals() display toggle
 *   light:class="expr"       → data-light-class="expr"       → syncJsBindings() class toggle
 *   light:for="item in list" → data-light-for="item in list" → renderLightForTemplates() loop rendering
 *   light:state="..."        → data-light-state="..."        → initJsState() initial state setup
 *   light:const="..."        → data-light-const="..."        → initJsState() read-only constants
 *   light:function="..."     → data-light-function="..."     → invokeCustomFunction() or inline assignments
 *   light:array="name"       → data-light-array="name"       → ensure reactive array state exists
 *   light:array.add="..."    → data-light-array-add="..."    → toggle/push value in named array
 *   light:array.check="..."  → data-light-array-check="..."  → bind checked state from named array
 *   light:array.all="..."    → data-light-array-all="..."    → fill named array from list source
 *   light:json.add="..."     → data-light-json-add="..."     → append JSON object/value into array path
 *   light:json.remove="..."  → data-light-json-remove="..."  → remove item/index from JSON array path
 *   light:json.check="..."   → data-light-json-check="..."   → check dot-path exists and print/apply state
 *   light:image="..."        → data-light-image="..."        → image upload preview + click-to-select
 *   light:bind="key"         → data-light-bind="key"         → syncJsBindings() text binding
 *   light:rules="..."        → data-light-rules="..."        → validateElement() client-side validation
 *   light:debounce="300"     → data-light-debounce="300"     → getElementDebounceMs() delay
 *   light:error="field"      → data-light-error="field"      → renderErrors() error display
 *   light:navigate            → data-light-navigate="true"    → navigateTo() SPA navigation
 *   light:loading              → data-light-loading="true"     → shown while AJAX is pending
 *   light:loading.delay="500"  → data-light-loading-delay      → show after delay ms
 *   light:loading.min="1000"   → data-light-loading-min        → show for at least min ms
 *   light:paginate="key"       → data-light-paginate="key"     → auto pagination controls
 *
 * @lightScripts directive outputs the full JS runtime inline via Assets::scripts()
 *
 * @see resources/js/lightvel.js — all JS functions referenced above
 * @see \Lightvel\Support\Assets::scripts() — generates the script tag
 */
class Directives
{
    /**
     * Register all custom Lightvel Blade directives.
     */
    public static function register(): void
    {
        // Blade::extend() runs as a post-processor on compiled Blade output.
        // It transforms light:* shorthand into standard data-* HTML attributes.
        Blade::extend(function ($view) {
            // Helper: strip {{ light.xxx }} wrapper from expressions used in attributes
            $normalizeLightExpr = static function (string $expression): string {
                return preg_replace('/\{\{\s*light\.([A-Za-z_][A-Za-z0-9_\.\-\>]*)\s*\}\}/', '$1', $expression);
            };

            // --- Two-way data binding ---
            // light:model.live sends live updates on every input keystroke
            $view = preg_replace_callback('/light:model\.live=("|\')(.*?)\1/', function ($match) {
                return 'data-light-model="' . $match[2] . '" data-light-model-live="' . $match[2] . '"';
            }, $view);
            $view = preg_replace('/light:model="([^"]+)"/', 'data-light-model="$1"', $view);

            // --- Action triggers ---
            // light:click calls a server-side action method via AJAX
            $view = preg_replace_callback('/light:click="([^"]+)"/', function ($match) use ($normalizeLightExpr) {
                return 'data-light-click="' . $normalizeLightExpr($match[1]) . '"';
            }, $view);
            // light:submit calls a server-side action on form submit
            $view = preg_replace_callback('/light:submit="([^"]+)"/', function ($match) use ($normalizeLightExpr) {
                return 'data-light-submit="' . $normalizeLightExpr($match[1]) . '"';
            }, $view);
            // light:change calls a server-side action on change event
            $view = preg_replace_callback('/light:change="([^"]+)"/', function ($match) use ($normalizeLightExpr) {
                return 'data-light-change="' . $normalizeLightExpr($match[1]) . '"';
            }, $view);
            // light:input calls a server-side action on input event
            $view = preg_replace_callback('/light:input="([^"]+)"/', function ($match) use ($normalizeLightExpr) {
                return 'data-light-input="' . $normalizeLightExpr($match[1]) . '"';
            }, $view);

            // --- Text/HTML output binding ---
            $view = preg_replace('/light:bind:checked="([^"]+)"/', 'data-light-bind-checked="$1"', $view);
            $view = preg_replace('/light:bind="([^"]+)"/', 'data-light-bind="$1"', $view);
            $view = preg_replace_callback('/light:text="([^"]+)"/', function ($match) use ($normalizeLightExpr) {
                return 'data-light-text="' . $normalizeLightExpr($match[1]) . '"';
            }, $view);
            $view = preg_replace('/light:html="([^"]+)"/', 'data-light-html="$1"', $view);
            $view = preg_replace('/light:src="([^"]+)"/', 'data-light-src="$1"', $view);

            // --- State management ---
            // light:state initializes client-side reactive state
            $view = preg_replace_callback('/light:state=("|\')(.*?)\1/', function ($match) {
                return 'data-light-state="' . $match[2] . '"';
            }, $view);
            // light:const defines read-only values (cannot be overwritten by set())
            $view = preg_replace('/light:const="([^"]+)"/', 'data-light-const="$1"', $view);

            // --- Client-side function (no server round-trip) ---
            // light:function assigns state values directly on the client
            // e.g. light:function="showModal=true, name=''" → instant UI update
            $view = preg_replace_callback('/light:function="([^"]+)"/', function ($match) use ($normalizeLightExpr) {
                return 'data-light-function="' . $normalizeLightExpr($match[1]) . '"';
            }, $view);

            // --- Array utility directives ---
            // light:array="students" initializes array state key if missing
            $view = preg_replace('/light:array="([^"]+)"/', 'data-light-array="$1"', $view);
            // light:array.add="students, student.id" toggles value in the array
            $view = preg_replace_callback('/light:array\.add="([^"]+)"/', function ($match) use ($normalizeLightExpr) {
                return 'data-light-array-add="' . $normalizeLightExpr($match[1]) . '"';
            }, $view);
            // light:array.check="students, student.id" keeps checkbox checked in sync
            $view = preg_replace_callback('/light:array\.check="([^"]+)"/', function ($match) use ($normalizeLightExpr) {
                return 'data-light-array-check="' . $normalizeLightExpr($match[1]) . '"';
            }, $view);
            // light:array.all="students, users, id" sets full selected array from source
            $view = preg_replace_callback('/light:array\.all="([^"]+)"/', function ($match) use ($normalizeLightExpr) {
                return 'data-light-array-all="' . $normalizeLightExpr($match[1]) . '"';
            }, $view);
            // light:json.add="subjects_json, {name:'', max_marks:100}" appends object/value to JSON array path
            $view = preg_replace_callback('/light:json\.add="([^"]+)"/', function ($match) use ($normalizeLightExpr) {
                return 'data-light-json-add="' . $normalizeLightExpr($match[1]) . '"';
            }, $view);
            // light:json.remove="subjects_json, $index" removes entry from JSON array path
            $view = preg_replace_callback('/light:json\.remove="([^"]+)"/', function ($match) use ($normalizeLightExpr) {
                return 'data-light-json-remove="' . $normalizeLightExpr($match[1]) . '"';
            }, $view);
            // light:json.check="a.b.c, 'YES', 'NO'" checks dot-path presence and prints result
            $view = preg_replace_callback('/light:json\.check="([^"]+)"/', function ($match) use ($normalizeLightExpr) {
                return 'data-light-json-check="' . $normalizeLightExpr($match[1]) . '"';
            }, $view);

            // light:image="preview_key, source_key" wires a hidden file input and live preview.
            $view = preg_replace_callback('/light:image="([^"]+)"/', function ($match) use ($normalizeLightExpr) {
                return 'data-light-image="' . $normalizeLightExpr($match[1]) . '"';
            }, $view);

            // --- Conditional rendering ---
            $view = preg_replace('/light:show="([^"]+)"/', 'data-light-show="$1"', $view);
            $view = preg_replace('/light:if="([^"]+)"/', 'data-light-if="$1"', $view);
            $view = preg_replace('/light:class="([^"]+)"/', 'data-light-class="$1"', $view);

            // --- List rendering ---
            // light:for="user in users" → clones the element for each item
            $view = preg_replace('/light:for="([^"]+)"/', 'data-light-for="$1"', $view);

            // --- Validation ---
            $view = preg_replace('/light:rules="([^"]+)"/', 'data-light-rules="$1"', $view);
            $view = preg_replace('/light:debounce="([^"]+)"/', 'data-light-debounce="$1"', $view);
            $view = preg_replace('/light:error="([^"]+)"/', 'data-light-error="$1"', $view);
            $view = preg_replace('/light:error-message="([^"]+)"/', 'data-light-error-message="$1"', $view);

            // --- SPA navigation ---
            $view = preg_replace('/\s+light:navigate(?:="[^"]*")?/', ' data-light-navigate="true"', $view);

            // --- Loading indicators ---
            // light:loading.delay="500" + light:loading.min="1000" with modifiers
            $view = preg_replace('/light:loading\.delay="([^"]+)"/', 'data-light-loading-delay="$1"', $view);
            $view = preg_replace('/light:loading\.min="([^"]+)"/', 'data-light-loading-min="$1"', $view);
            $view = preg_replace('/light:loading\.target="([^"]+)"/', 'data-light-loading-target="$1"', $view);
            // light:loading.remove — HIDES this element when loading is active (text swap)
            $view = preg_replace('/light:loading\.remove/', 'data-light-loading-remove', $view);
            // light:loading (base) — must come AFTER .delay/.min/.target to avoid partial match
            $view = preg_replace('/light:loading(?:="([^"]*)")?/', 'data-light-loading="${1:-true}"', $view);

            // --- Pagination ---
            $view = preg_replace('/light:paginate="([^"]+)"/', 'data-light-paginate="$1"', $view);
            $view = preg_replace('/light:paginate-action="([^"]+)"/', 'data-light-paginate-action="$1"', $view);
            $view = preg_replace('/light:paginate-link="([^"]+)"/', 'data-light-paginate-link="$1"', $view);
            $view = preg_replace('/light:paginate-custom(?:="([^"]*)")?/', 'data-light-paginate-custom="${1:-true}"', $view);

            // --- Cloak: visible on initial load, hidden after JS init ---
            // Use for "loading..." placeholders shown until data is ready
            $view = preg_replace('/light:cloak/', 'data-light-cloak', $view);

            return $view;
        });

        // @lightScripts directive — outputs the full Lightvel JS runtime inline
        // Renders at RUNTIME (not compile-time) so the compiled view stays small.
        // Assets::scripts() caches the JS content in memory after first call.
        Blade::directive('lightScripts', function () {
            return '<?php echo \\Lightvel\\Support\\Assets::scripts(); ?>';
        });
    }
}
