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
    | Optional extra subfolder under resources/views for generated pages.
    | Keep empty to generate directly in resources/views.
    | Example: "modules" => resources/views/modules/pages/home.blade.php
    |
    */
    'view_root' => '',

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

    /*
    |--------------------------------------------------------------------------
    | Navigation progress bar color
    |--------------------------------------------------------------------------
    |
    | Used when light:navigate links are fetched without a full refresh.
    |
    */
    'progress_bar_color' => env('LIGHTVEL_PROGRESS_BAR_COLOR', '#111827'),

    /*
    |--------------------------------------------------------------------------
    | Message endpoint
    |--------------------------------------------------------------------------
    |
    | Dedicated endpoint used by the runtime to dispatch component actions.
    | Keeps page routes simple (GET) while actions are sent through this path.
    |
    */
    'message_endpoint' => env('LIGHTVEL_MESSAGE_ENDPOINT', '/lightvel/message'),
];
