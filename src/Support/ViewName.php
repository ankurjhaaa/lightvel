<?php

namespace Lightvel\Support;

class ViewName
{
    /**
     * Resolve the Laravel view name for a layout.
     *
     * If the user passes a plain name like "app", it maps to "layouts.app".
     * If they pass a dotted path like "components.layout.admin", it stays as-is.
     */
    public static function layout(string $name): string
    {
        $name = trim($name);
        $folder = trim((string) config('lightvel.layout_folder', 'layouts'), '/');

        if ($name === '') {
            return $folder . '.app';
        }

        if (str_contains($name, '.')) {
            return $name;
        }

        return $folder . '.' . $name;
    }

    /**
     * Resolve the filesystem path for a layout view.
     */
    public static function layoutPath(string $name): string
    {
        return resource_path('views/' . str_replace('.', '/', static::layout($name)) . '.blade.php');
    }

    /**
     * Resolve the filesystem path for a Lightvel page/component view.
     *
     * Supported format:
     * - pages::app.home => resources/views/pages/app/home.blade.php
     * - pages.home => resources/views/pages/home.blade.php
     * - home => resources/views/home.blade.php
     */
    public static function pagePath(string $name): string
    {
        $name = trim($name);

        if ($name === '') {
            return resource_path('views/' . trim((string) config('lightvel.view_root', 'views'), '/') . '/home.blade.php');
        }

        if (str_contains($name, '::')) {
            [$scope, $path] = explode('::', $name, 2);
            $path = str_replace('.', '/', trim($path, '.'));

            return resource_path('views/' . trim((string) config('lightvel.view_root', 'views'), '/') . '/' . trim($scope, '/') . '/' . $path . '.blade.php');
        }

        return resource_path('views/' . trim((string) config('lightvel.view_root', 'views'), '/') . '/' . str_replace('.', '/', $name) . '.blade.php');
    }
}
