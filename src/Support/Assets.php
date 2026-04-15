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
 * @see resources/js/lightvel.js — last line removes data-light-booting
 */
class Assets
{
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

        // Boot config — sets window.Lightvel before the runtime IIFE executes
        $boot = 'window.Lightvel = window.Lightvel || {};'
            . 'document.documentElement.setAttribute("data-light-booting", "true");'
            . 'window.Lightvel.progressBarColor = ' . json_encode($progressColor) . ';'
            . 'window.Lightvel.messageEndpoint = ' . json_encode($messageEndpoint) . ';';

        // Boot styles — FOUC prevention
        // Hides ALL reactive elements during initial load to prevent:
        //   - light:if/light:show elements flashing visible before condition is evaluated
        //   - light:for templates showing the raw template row before list is rendered
        //   - light:text empty spans showing blank before state is initialized
        // The data-light-booting attribute is removed by lightvel.js after initJsState()
        $bootStyles = '<style>'
            . '[data-light-booting] [data-light-if],'
            . '[data-light-booting] [data-light-show],'
            . '[data-light-booting] [data-light-for]'
            . '{display:none !important;}'
            . '[data-light-booting] [data-light-text]{visibility:hidden;}'
            . '</style>';

        return $bootStyles . PHP_EOL
            . '<script>' . $boot . '</script>' . PHP_EOL
            . '<script>' . PHP_EOL . (is_file($path) ? file_get_contents($path) : '') . PHP_EOL . '</script>';
    }
}
