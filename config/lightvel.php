<?php

return [
    'default_layout' => env('LIGHTVEL_LAYOUT', 'app'),

    'layout_folder' => 'layouts',

    'view_root' => '',

    'script_path' => env('LIGHTVEL_SCRIPT_PATH'),

    'use_published_script' => env('LIGHTVEL_USE_PUBLISHED_SCRIPT', false),

    'progress_bar_color' => env('LIGHTVEL_PROGRESS_BAR_COLOR', '#111827'),

    'message_endpoint' => env('LIGHTVEL_MESSAGE_ENDPOINT', '/lightvel/message'),

    'hydrate_state_on_action' => env('LIGHTVEL_HYDRATE_STATE_ON_ACTION', true),

    'allow_live_action_without_form' => env('LIGHTVEL_ALLOW_LIVE_ACTION_WITHOUT_FORM', true),

    'strict_action_errors' => env('LIGHTVEL_STRICT_ACTION_ERRORS', true),

    'expose_action_exceptions' => env('LIGHTVEL_EXPOSE_ACTION_EXCEPTIONS', false),
];
