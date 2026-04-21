<?php

namespace Lightvel\Support;

/**
 * Generates the Lightvel JavaScript runtime output for @lightScripts.
 *
 * Outputs three things in order:
 *   1. Boot styles — prevents FOUC by hiding reactive elements during load
 *   2. Boot script — sets up window.Lightvel config before the runtime loads
 *   3. Runtime script — the full lightvel.js IIFE
 *
 * The boot sequence ensures:
 *   - Elements with light:if, light:show, light:for are hidden until JS initializes
 *   - light:text empty spans don't flash blank content
 *   - data-light-booting attribute is set on <html> and removed after init
 *
 * @see \Lightvel\Support\Blade\Directives::register() — registers @lightScripts
 * @see resources/js/lightvel.js — initJsState() removes data-light-booting after boot sync
 */
class Assets
{
    /** @var string|null Cached JS runtime content (avoids repeated file_get_contents) */
    private static ?string $cachedJs = null;

    /**
     * Return the full Lightvel runtime: boot styles + config + JS.
     */
    public static function scripts(): string
    {
        // Resolve the JS runtime file path
        $published = public_path('vendor/lightvel/lightvel.js');
        $packagePath = __DIR__ . '/../../resources/js/lightvel.js';
        $configuredPath = config('lightvel.script_path');
        $defaultPath = is_string($configuredPath) && $configuredPath !== '' && is_file($configuredPath)
            ? $configuredPath
            : $packagePath;
        $usePublished = (bool) config('lightvel.use_published_script', false);

        $path = $defaultPath;
        if ($usePublished && file_exists($published)) {
            $path = $published;
        }

        if (!is_file($path)) {
            $path = $packagePath;
        }

        $progressColor = config('lightvel.progress_bar_color', '#111827');
        $messageEndpoint = config('lightvel.message_endpoint', '/lightvel/message');
        $hydrateStateOnAction = (bool) config('lightvel.hydrate_state_on_action', true);
        $allowLiveActionWithoutForm = (bool) config('lightvel.allow_live_action_without_form', true);

        // Boot config — sets window.Lightvel before the runtime IIFE executes
        $boot = 'window.Lightvel = window.Lightvel || {};'
            . 'document.documentElement.setAttribute("data-light-booting", "true");'
            . 'window.Lightvel.progressBarColor = ' . json_encode($progressColor) . ';'
            . 'window.Lightvel.messageEndpoint = ' . json_encode($messageEndpoint) . ';'
            . 'window.Lightvel.hydrateStateOnAction = ' . json_encode($hydrateStateOnAction) . ';'
            . 'window.Lightvel.allowLiveActionWithoutForm = ' . json_encode($allowLiveActionWithoutForm) . ';';

        // Boot styles — FOUC prevention
        // Hides ALL reactive elements during initial load to prevent:
        //   - light:if/light:show elements flashing visible before condition is evaluated
        //   - light:for templates showing the raw template row before list is rendered
        //   - light:text empty spans showing blank before state is initialized
        // The data-light-booting attribute is removed by lightvel.js in initJsState() after initial sync
        $bootStyles = '<style>'
            . '[data-light-booting] [data-light-if],'
            . '[data-light-booting] [data-light-show],'
            . '[data-light-booting] [data-light-for]'
            . '{display:none !important;}'
            . '[data-light-booting] [data-light-text]{visibility:hidden;}'
            // Loading elements are hidden by default, shown only during AJAX
            . '[data-light-loading]:not([data-light-loading-active="true"]){display:none !important;}'
            // loading-remove: VISIBLE by default, HIDDEN when loading is active (button text swap)
            . '[data-light-loading-active="true"] ~ [data-light-loading-remove],'
            . '[data-light-loading-remove][data-light-loading-active="true"]{display:none !important;}'
            // Cloak skeleton placeholders: visible during boot, hidden after JS init
            . '[data-light-cloak]{display:none !important;}'
            . '[data-light-booting] [data-light-cloak]{display:block !important;}'
            // Also allow cloak skeleton to appear when actively loading (optional)
            . '[data-light-cloak][data-light-loading-active="true"]{display:block !important;}'
            // Hide real content while boot cloak is visible
            . '[data-light-booting] [data-light-cloak-remove]{display:none !important;}'
            // Hide real content while target cloak/loading is active
            . '[data-light-loading-active="true"] ~ [data-light-cloak-remove],'
            . '[data-light-cloak-remove][data-light-loading-active="true"]{display:none !important;}'
            // Default spinner — use class="lightvel-spinner" for a built-in spinner
            . '@keyframes lightvel-spin{to{transform:rotate(360deg)}}'
            . '.lightvel-spinner{display:inline-block;width:20px;height:20px;'
            . 'border:2px solid #e5e7eb;border-top-color:#6366f1;'
            . 'border-radius:50%;animation:lightvel-spin .6s linear infinite;}'
            . '</style>';

        // Cache JS content in memory — file_get_contents runs only once per process
        if (self::$cachedJs === null) {
            self::$cachedJs = is_file($path) ? file_get_contents($path) : '';
        }

        return $bootStyles . PHP_EOL
            . '<script data-light-boot-config="true">' . $boot . '</script>' . PHP_EOL
            . '<script data-light-runtime="true">' . PHP_EOL . self::$cachedJs . PHP_EOL . '</script>';
    }
}
