<?php

namespace Lightvel\Support\Blade;

use Illuminate\Support\Facades\Blade;
use Lightvel\Support\Assets;

class Directives
{
    /**
     * Register all custom Lightvel Blade directives.
     */
    public static function register(): void
    {
        Blade::extend(function ($view) {
            $view = preg_replace('/light:model="([^"]+)"/', 'name="$1" value="<?php echo $$1 ?? \'\' ?>" data-light-model="$1"', $view);
            $view = preg_replace('/light:click="([^"]+)"/', 'type="button" data-light-click="$1"', $view);
            $view = preg_replace('/light:submit="([^"]+)"/', 'data-light-submit="$1"', $view);
            $view = preg_replace('/light:bind="([^"]+)"/', 'data-light-bind="$1"', $view);
            $view = preg_replace('/light:js:model="([^"]+)"/', 'data-light-js-model="$1"', $view);
            $view = preg_replace('/light:js:click="([^"]+)"/', 'type="button" data-light-js-click="$1"', $view);
            $view = preg_replace('/light:js:submit="([^"]+)"/', 'data-light-js-submit="$1"', $view);
            $view = preg_replace('/light:js:bind="([^"]+)"/', 'data-light-js-bind="$1"', $view);
            $view = preg_replace('/light:js:html="([^"]+)"/', 'data-light-js-html="$1"', $view);
            $view = preg_replace('/light:js:rules="([^"]+)"/', 'data-light-js-rules="$1"', $view);
            $view = preg_replace('/light:error="([^"]+)"/', 'data-light-error="$1"', $view);
            $view = preg_replace('/light:error-message="([^"]+)"/', 'data-light-error-message="$1"', $view);
            $view = preg_replace('/light:js:show="([^"]+)"/', 'data-light-js-show="$1"', $view);
            $view = preg_replace('/light:js:class="([^"]+)"/', 'data-light-js-class="$1"', $view);
            $view = preg_replace('/light:js:init="([^"]+)"/', 'data-light-js-init="$1"', $view);
            $view = preg_replace('/\s+light:navigate(?:="[^"]*")?/', ' data-light-navigate="true"', $view);

            return preg_replace('/light:html="([^"]+)"/', 'data-light-html="$1"', $view);
        });

        Blade::directive('lightScripts', function () {
            return Assets::scripts();
        });
    }
}
