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

            $view = preg_replace('/light:state="([^"]+)"/', 'data-light-state="$1"', $view);
            $view = preg_replace('/light:variable="([^"]+)"/', 'data-light-state="$1"', $view);
            $view = preg_replace('/light:const="([^"]+)"/', 'data-light-const="$1"', $view);
            $view = preg_replace('/light:function="([^"]+)"/', 'type="button" data-light-function="$1"', $view);
            $view = preg_replace('/light:text="([^"]+)"/', 'data-light-text="$1"', $view);
            $view = preg_replace('/light:html="([^"]+)"/', 'data-light-html="$1"', $view);
            $view = preg_replace('/light:show="([^"]+)"/', 'data-light-show="$1"', $view);
            $view = preg_replace('/light:if="([^"]+)"/', 'data-light-if="$1"', $view);
            $view = preg_replace('/light:class="([^"]+)"/', 'data-light-class="$1"', $view);
            $view = preg_replace('/light:data="([^"]+)"/', 'data-light-data="$1"', $view);
            $view = preg_replace('/light:for="([^"]+)"/', 'data-light-for="$1"', $view);
            $view = preg_replace('/light:rules="([^"]+)"/', 'data-light-rules="$1"', $view);

            $view = preg_replace('/light:error="([^"]+)"/', 'data-light-error="$1"', $view);
            $view = preg_replace('/light:error-message="([^"]+)"/', 'data-light-error-message="$1"', $view);
            $view = preg_replace('/\s+light:navigate(?:="[^"]*")?/', ' data-light-navigate="true"', $view);

            return preg_replace('/light:html="([^"]+)"/', 'data-light-html="$1"', $view);
        });

        Blade::directive('lightScripts', function () {
            return Assets::scripts();
        });
    }
}
