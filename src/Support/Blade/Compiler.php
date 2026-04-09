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

        $view .= "<?php
            \$__content = ob_get_clean();

            \$__rules = \$__lv->rulesForClient();
            \$__rulesAttr = empty(\$__rules) ? '' : ' data-light-rules=\"' . htmlspecialchars(json_encode(\$__rules), ENT_QUOTES, 'UTF-8') . '\"';

            \$__dom = '<div data-light-root' . \$__rulesAttr . '>' . \$__content . '</div>';

            if (request()->header('X-Light')) {
                \$__payload = is_array(\$__result) ? \$__result : [];
                \$__payload['__lightvel_dom'] = \$__dom;
                header('Content-Type: application/json');
                echo json_encode(\$__payload);
                return;
            }

            echo view(\$__layoutView, array_merge(\$__layoutParams, [
                'slot' => \$__dom,
            ]))->render();

            return;
            ?>";

        return $view;
    }
}
