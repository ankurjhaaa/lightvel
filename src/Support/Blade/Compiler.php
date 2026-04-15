<?php

namespace Lightvel\Support\Blade;

/**
 * Blade view compiler for Lightvel components.
 *
 * Transforms a Blade file containing an anonymous component class into
 * executable PHP that:
 *   1. Instantiates the component class
 *   2. Calls Component::run() to handle the request
 *   3. Wraps the HTML in a data-light-root container with serialized state
 *   4. Renders everything inside the specified layout
 *
 * Input (Blade file):
 *   @php
 *     new #[Layout('app')] class extends Component {
 *       public function lightvel(): array { ... }
 *       public function someAction(): array { ... }
 *     };
 *   @endphp
 *   <div light:state="...">...</div>
 *
 * Output flow:
 *   - Initial render (GET): Full HTML page with state embedded in data attributes
 *   - AJAX action (POST with X-Light): JSON response with state delta only
 *
 * The compiled PHP is cached by Laravel's Blade compiler and only
 * recompiled when the Blade file changes.
 *
 * @see \Lightvel\Component::run() — handles the component lifecycle
 * @see \Lightvel\Support\Blade\Directives — transforms light:* attributes
 * @see resources/js/lightvel.js — initJsState() reads the serialized state
 */
class Compiler
{
    /**
     * Transform a Lightvel Blade view into executable PHP.
     *
     * Steps:
     *   1. Extract the @php/@endphp block containing the anonymous class
     *   2. Parse the #[Layout('name')] attribute for layout selection
     *   3. Generate boot PHP that instantiates component and calls run()
     *   4. Generate footer PHP that wraps content in data-light-root div
     *      and either outputs JSON (AJAX) or renders the layout (initial)
     */
    public static function transform(string $view): string
    {
        // Extract the PHP block containing the component class definition
        $scriptBlock = null;

        if (preg_match('/@php\s*([\s\S]*?)@endphp/m', $view, $phpBlock)) {
            $scriptBlock = $phpBlock;
        } elseif (preg_match('/<\?php\s*([\s\S]*?)\?>/m', $view, $phpBlock)) {
            $scriptBlock = $phpBlock;
        }

        if (! $scriptBlock) {
            return $view;
        }

        // Match the anonymous class definition with optional Layout attribute
        // Supports both #[Layout('app')] and #layout('app') syntax
        if (! preg_match('/(?:(#\s*layout\s*\(([\s\S]*?)\)\s*)?)new\s+(?:#\[\s*Layout\s*\(([\s\S]*?)\)\s*\]\s*)?class\s+extends\s+(?:Component|LightvelComponent)\s*\{([\s\S]*?)\};/mi', $scriptBlock[1], $componentBlock)) {
            return $view;
        }

        // Extract parts: use statements (prefix), layout args, and class body
        $prefix = str_replace($componentBlock[0], '', $scriptBlock[1]);
        $layoutArgs = ($componentBlock[3] ?? null) ?: ($componentBlock[2] ?? null);
        $classBody = $componentBlock[4] ?? '';

        $defaultLayout = config('lightvel.default_layout', 'app');

        // Layout resolution — ViewName::layout() converts 'app' → 'layouts.app' path
        $layoutBoot = "\$__layoutView = \\Lightvel\\Support\\ViewName::layout('{$defaultLayout}');\n            \$__layoutParams = [];";

        if ($layoutArgs !== null && trim($layoutArgs) !== '') {
            $layoutBoot = "\$__layoutData = [{$layoutArgs}];\n            \$__layoutView = \\Lightvel\\Support\\ViewName::layout(\$__layoutData[0] ?? '{$defaultLayout}');\n            \$__layoutParams = \$__layoutData[1] ?? [];";
        }

        // --- BOOT PHP ---
        // This code runs at the top of the compiled Blade view.
        // It instantiates the anonymous component class, calls run(),
        // and extracts state variables for the Blade template.
        $boot = "<?php
            {$prefix}

            \$__lv = new class extends \\Lightvel\\Component { {$classBody} };

            {$layoutBoot}

            \$__result = \$__lv->run();

            \$__data = get_object_vars(\$__lv);
            extract(\$__data);
            \$errors = \$__lv->getErrorBag();
            ob_start();
            ?>";

        $view = str_replace($scriptBlock[0], $boot, $view);

        // Transform {{ echo.foo }} and {{ light.foo }} into reactive text spans
        // These become <span data-light-text="foo"></span> which the JS runtime
        // binds to state.foo via syncLightTextBindings()
        $view = preg_replace('/\{\{\s*echo\.([A-Za-z_][A-Za-z0-9_\.\-\>]*)\s*\}\}/', '<span data-light-text="$1"></span>', $view);
        $view = preg_replace('/\{\{\s*light\.([A-Za-z_][A-Za-z0-9_\.\-\>]*)\s*\}\}/', '<span data-light-text="$1"></span>', $view);

        // --- FOOTER PHP ---
        // This code runs after the Blade template has been rendered.
        // It wraps the HTML content in a data-light-root container and either:
        //   - Returns JSON (for AJAX actions)
        //   - Renders the full layout with the component as $slot (for initial load)
        $view .= "<?php
            \$__content = ob_get_clean();

            // Resolve the route/view name for fingerprint generation
            \$__route = request()->route();
            \$__routeAction = \$__route ? \$__route->getAction() : [];
            \$__lightvelView = isset(\$__routeAction['view'])
                ? str_replace('.', '::', (string) \$__routeAction['view'])
                : (\$__route?->getName() ?: trim((string) request()->path(), '/'));
            if (\$__lightvelView === '') {
                \$__lightvelView = 'home';
            }

            // Generate a unique fingerprint for this component instance
            // Used by the JS runtime to target the correct endpoint
            \$__lightvelFingerprint = substr(sha1(\$__lightvelView . '|' . request()->path() . '|' . get_class(\$__lv)), 0, 20);
            \$__lightvelEndpoint = '/lightvel-' . \$__lightvelFingerprint . '/update';

            // Serialize validation rules for client-side validation
            // JS: getRootRules() reads this → validateValue() uses them
            \$__rules = \$__lv->rulesForClient();
                \$__rulesAttr = empty(\$__rules) ? '' : ' data-light-server-rules=\"' . htmlspecialchars(json_encode(\$__rules), ENT_QUOTES, 'UTF-8') . '\"';

            // Serialize state for client-side initialization
            // JS: initJsState() reads data-light-server-state into api.state
            \$__state = \$__lv->stateForClient();
            \$__stateAttr = empty(\$__state) ? '' : ' data-light-server-state=\"' . htmlspecialchars(json_encode(\$__state), ENT_QUOTES, 'UTF-8') . '\"';

            // Build the data-light-root wrapper with all metadata attributes
            \$__metaAttr =
                ' data-light-endpoint=\"' . htmlspecialchars(\$__lightvelEndpoint, ENT_QUOTES, 'UTF-8') . '\"' .
                ' data-light-component=\"' . htmlspecialchars(\$__lightvelView, ENT_QUOTES, 'UTF-8') . '\"' .
                ' data-light-fingerprint=\"' . htmlspecialchars(\$__lightvelFingerprint, ENT_QUOTES, 'UTF-8') . '\"';

            \$__dom = '<div data-light-root' . \$__metaAttr . \$__rulesAttr . \$__stateAttr . '>' . \$__content . '</div>';

            // --- AJAX response path ---
            // When X-Light header is present, return JSON instead of HTML.
            // Component::run() returns the action result, we merge it with delta state.
            if (request()->header('X-Light')) {
                header('Content-Type: application/json');

                if (\$__result instanceof \\Illuminate\\Http\\JsonResponse) {
                    \$__payload = json_decode((string) \$__result->getContent(), true);
                    if (!is_array(\$__payload)) {
                        \$__payload = [];
                    }

                    \$__deltaState = \$__lv->getDeltaState();
                    \$__response = array_merge(\$__deltaState, \$__payload);
                    echo json_encode(\$__response);
                    return;
                }

                \$__deltaState = \$__lv->getDeltaState();
                echo json_encode(\$__deltaState);
                return;
            }

            // --- Initial render path ---
            // Render the layout view with the component DOM as \$slot
            \$__rendered = view(\$__layoutView, array_merge(\$__layoutParams, [
                'slot' => \$__dom,
            ]))->render();

            echo \$__rendered;

            return;
            ?>";

        return $view;
    }
}
