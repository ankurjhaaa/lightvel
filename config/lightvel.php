<?php

return [
    // Default layout when none is specified in component attribute
    'default_layout' => env('LIGHTVEL_LAYOUT', 'app'),

    // Folder where layout blade files are stored
    'layout_folder' => 'layouts',

    // Optional view root prefix for generated pages
    'view_root' => '',

    // Custom runtime script path (optional override)
    'script_path' => env('LIGHTVEL_SCRIPT_PATH'),

    // Prefer published JS (public/vendor/lightvel/lightvel.js) when true
    'use_published_script' => env('LIGHTVEL_USE_PUBLISHED_SCRIPT', false),

    // Top progress bar color for SPA navigation/loading
    'progress_bar_color' => env('LIGHTVEL_PROGRESS_BAR_COLOR', '#111827'),

    // Message endpoint used by the runtime for action requests
    'message_endpoint' => env('LIGHTVEL_MESSAGE_ENDPOINT', '/lightvel/message'),

    // Include current state snapshot with each action request
    'hydrate_state_on_action' => env('LIGHTVEL_HYDRATE_STATE_ON_ACTION', true),

    // Allow light:model.live to call explicit action without form wrapper
    'allow_live_action_without_form' => env('LIGHTVEL_ALLOW_LIVE_ACTION_WITHOUT_FORM', true),

    // Return strict 422 style responses for invalid actions
    'strict_action_errors' => env('LIGHTVEL_STRICT_ACTION_ERRORS', true),

    // Expose internal exception messages to response (keep false in production)
    'expose_action_exceptions' => env('LIGHTVEL_EXPOSE_ACTION_EXCEPTIONS', false),
];
