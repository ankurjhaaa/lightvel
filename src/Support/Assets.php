<?php

namespace Lightvel\Support;

class Assets
{
    /**
     * Return the JavaScript runtime used by Lightvel pages.
     */
    public static function scripts(): string
    {
        $published = public_path('vendor/lightvel/lightvel.js');
        $path = file_exists($published)
            ? $published
            : config('lightvel.script_path', __DIR__ . '/../../resources/js/lightvel.js');
        $progressColor = config('lightvel.progress_bar_color', '#111827');
        $messageEndpoint = config('lightvel.message_endpoint', '/lightvel/message');
        $boot = 'window.Lightvel = window.Lightvel || {};' .
            'document.documentElement.setAttribute("data-light-booting", "true");' .
            'window.Lightvel.progressBarColor = ' . json_encode($progressColor) . ';' .
            'window.Lightvel.messageEndpoint = ' . json_encode($messageEndpoint) . ';';
        $bootStyles = '<style>[data-light-booting] [data-light-if], [data-light-booting] [data-light-show]{display:none !important;}</style>';

        return $bootStyles . PHP_EOL
            . '<script>' . $boot . '</script>' . PHP_EOL
            . '<script>' . PHP_EOL . file_get_contents($path) . PHP_EOL . '</script>';
    }
}
