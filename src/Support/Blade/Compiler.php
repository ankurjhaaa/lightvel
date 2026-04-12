<?php

namespace Lightvel\Support\Blade;

class Compiler
{
    /**
     * Transform a Lightvel Blade view into executable PHP that boots the
     * component, loads its state and renders the selected layout.
     */
    public static function transform(string $view): string
    {
        $scriptBlock = null;

        if (preg_match('/@php\s*([\s\S]*?)@endphp/m', $view, $phpBlock)) {
            $scriptBlock = $phpBlock;
        } elseif (preg_match('/<\?php\s*([\s\S]*?)\?>/m', $view, $phpBlock)) {
            $scriptBlock = $phpBlock;
        }

        if (! $scriptBlock) {
            return $view;
        }

        if (! preg_match('/(?:(#\s*layout\s*\(([\s\S]*?)\)\s*)?)new\s+(?:#\[\s*Layout\s*\(([\s\S]*?)\)\s*\]\s*)?class\s+extends\s+(?:Component|LightvelComponent)\s*\{([\s\S]*?)\};/mi', $scriptBlock[1], $componentBlock)) {
            return $view;
        }

        $prefix = str_replace($componentBlock[0], '', $scriptBlock[1]);
        $layoutArgs = ($componentBlock[3] ?? null) ?: ($componentBlock[2] ?? null);
        $classBody = $componentBlock[4] ?? '';

        $defaultLayout = config('lightvel.default_layout', 'app');

        $layoutBoot = "\$__layoutView = \\Lightvel\\Support\\ViewName::layout('{$defaultLayout}');\n            \$__layoutParams = [];";

        if ($layoutArgs !== null && trim($layoutArgs) !== '') {
            $layoutBoot = "\$__layoutData = [{$layoutArgs}];\n            \$__layoutView = \\Lightvel\\Support\\ViewName::layout(\$__layoutData[0] ?? '{$defaultLayout}');\n            \$__layoutParams = \$__layoutData[1] ?? [];";
        }

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

        $view = preg_replace('/\{\{\s*echo\.([A-Za-z_][A-Za-z0-9_\.\->]*)\s*\}\}/', '<span data-light-text="$1"></span>', $view);
        $view = preg_replace('/\{\{\s*light\.([A-Za-z_][A-Za-z0-9_\.\->]*)\s*\}\}/', '<span data-light-text="$1"></span>', $view);

        $view .= "<?php
            \$__content = ob_get_clean();

            \$__route = request()->route();
            \$__routeAction = \$__route ? \$__route->getAction() : [];
            \$__lightvelView = isset(\$__routeAction['view'])
                ? str_replace('.', '::', (string) \$__routeAction['view'])
                : (\$__route?->getName() ?: trim((string) request()->path(), '/'));
            if (\$__lightvelView === '') {
                \$__lightvelView = 'home';
            }

            \$__lightvelFingerprint = substr(sha1(\$__lightvelView . '|' . request()->path() . '|' . get_class(\$__lv)), 0, 20);
            \$__lightvelEndpoint = '/lightvel-' . \$__lightvelFingerprint . '/update';

            \$__rules = \$__lv->rulesForClient();
                \$__rulesAttr = empty(\$__rules) ? '' : ' data-light-server-rules=\"' . htmlspecialchars(json_encode(\$__rules), ENT_QUOTES, 'UTF-8') . '\"';
            \$__state = \$__lv->stateForClient();
            \$__stateAttr = empty(\$__state) ? '' : ' data-light-server-state=\"' . htmlspecialchars(json_encode(\$__state), ENT_QUOTES, 'UTF-8') . '\"';

            \$__metaAttr =
                ' data-light-endpoint=\"' . htmlspecialchars(\$__lightvelEndpoint, ENT_QUOTES, 'UTF-8') . '\"' .
                ' data-light-component=\"' . htmlspecialchars(\$__lightvelView, ENT_QUOTES, 'UTF-8') . '\"' .
                ' data-light-fingerprint=\"' . htmlspecialchars(\$__lightvelFingerprint, ENT_QUOTES, 'UTF-8') . '\"';

            if (\$__debug) {
                \$__debug->recordView(\$__lightvelView, 0.0);
            }

            \$__dom = '<div data-light-root' . \$__metaAttr . \$__rulesAttr . \$__stateAttr . '>' . \$__content . '</div>';

            if (app()->bound('debugbar')) {
                try {
                    app('debugbar')->addMessage('lightvel component ' . \$__lightvelView . ' #' . \$__lightvelFingerprint, 'lightvel');
                } catch (\Throwable \$__e) {
                }
            }

            if (request()->header('X-Light')) {
                header('Content-Type: application/json');

                if (\$__result instanceof \Illuminate\Http\JsonResponse) {
                    \$__payload = json_decode((string) \$__result->getContent(), true);
                    if (!is_array(\$__payload)) {
                        \$__payload = [];
                    }

                    echo json_encode(\$__payload);
                    return;
                }

                \$__payload = is_array(\$__result) ? \$__result : (is_object(\$__result) ? get_object_vars(\$__result) : []);

                echo json_encode(\$__payload);
                return;
            }

            \$__rendered = view(\$__layoutView, array_merge(\$__layoutParams, [
                'slot' => \$__dom,
            ]))->render();

            echo \$__rendered;

            return;
            ?>";

        return $view;
    }
}
