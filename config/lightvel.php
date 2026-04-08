<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Default layout
    |--------------------------------------------------------------------------
    |
    | When a Lightvel page does not specify a layout, this view name is used.
    | Plain names like "app" resolve to "layouts.app" automatically.
    |
    */
    'default_layout' => env('LIGHTVEL_LAYOUT', 'app'),

    /*
    |--------------------------------------------------------------------------
    | Layout folder
    |--------------------------------------------------------------------------
    |
    | Plain layout names are stored inside this folder.
    | Example: app => resources/views/layouts/app.blade.php
    |
    */
    'layout_folder' => 'layouts',

    /*
    |--------------------------------------------------------------------------
    | Generated views folder
    |--------------------------------------------------------------------------
    |
    | The first folder segment after a generator namespace is treated as the
    | top-level view folder.
    |
    */
    'view_root' => 'views',

    /*
    |--------------------------------------------------------------------------
    | JavaScript asset path
    |--------------------------------------------------------------------------
    |
    | The Lightvel runtime JS is kept in a separate file for maintainability.
    | It is rendered by the @lightScripts directive.
    |
    */
    'script_path' => __DIR__ . '/../resources/js/lightvel.js',
];
