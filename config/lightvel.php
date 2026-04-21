<?php

return [
    // ------------------------------------------------------------------
    // Default layout used when a component does not define #[Layout('...')].
    // Example: 'app' resolves to resources/views/layouts/app.blade.php
    // ------------------------------------------------------------------
    'default_layout' => env('LIGHTVEL_LAYOUT', 'app'),

    // ------------------------------------------------------------------
    // Base folder for layout views (relative to resources/views).
    // Keep as 'layouts' unless your project uses a custom structure.
    // ------------------------------------------------------------------
    'layout_folder' => 'layouts',

    // ------------------------------------------------------------------
    // Optional root namespace for generated page views.
    // Example: 'admin' makes generators target resources/views/admin/pages/*
    // Leave empty for default resources/views/pages/* paths.
    // ------------------------------------------------------------------
    'view_root' => '',

    // ------------------------------------------------------------------
    // Optional absolute path to a custom Lightvel runtime script.
    // Useful for local development overrides or custom JS builds.
    // If empty/invalid, package runtime at resources/js/lightvel.js is used.
    // ------------------------------------------------------------------
    'script_path' => env('LIGHTVEL_SCRIPT_PATH'),

    // ------------------------------------------------------------------
    // When true, prefer the published runtime file:
    // public/vendor/lightvel/lightvel.js
    // Recommended for production + long-lived browser caching.
    // ------------------------------------------------------------------
    'use_published_script' => env('LIGHTVEL_USE_PUBLISHED_SCRIPT', false),

    // ------------------------------------------------------------------
    // Top progress bar color used during action calls + light:navigate.
    // Accepts any valid CSS color string.
    // ------------------------------------------------------------------
    'progress_bar_color' => env('LIGHTVEL_PROGRESS_BAR_COLOR', '#111827'),

    // ------------------------------------------------------------------
    // Primary endpoint used by runtime POST action requests.
    // Keep default unless your app requires a prefixed/custom endpoint.
    // ------------------------------------------------------------------
    'message_endpoint' => env('LIGHTVEL_MESSAGE_ENDPOINT', '/lightvel/message'),

    // ------------------------------------------------------------------
    // Include the current client state snapshot with each action request.
    // Disable only if you intentionally want strict param-only requests.
    // ------------------------------------------------------------------
    'hydrate_state_on_action' => env('LIGHTVEL_HYDRATE_STATE_ON_ACTION', true),

    // ------------------------------------------------------------------
    // Allow light:model.live="actionName" to call a server action even
    // without a parent form[data-light-submit].
    // If false, explicit model.live actions require form context.
    // ------------------------------------------------------------------
    'allow_live_action_without_form' => env('LIGHTVEL_ALLOW_LIVE_ACTION_WITHOUT_FORM', true),

    // ------------------------------------------------------------------
    // Strict action error handling:
    // true  => invalid/missing action returns HTTP 422 style error payload
    // false => returns empty payload to avoid hard failures in production
    // ------------------------------------------------------------------
    'strict_action_errors' => env('LIGHTVEL_STRICT_ACTION_ERRORS', true),

    // ------------------------------------------------------------------
    // Expose internal exception messages in response JSON.
    // Keep FALSE in production to avoid leaking internal details.
    // ------------------------------------------------------------------
    'expose_action_exceptions' => env('LIGHTVEL_EXPOSE_ACTION_EXCEPTIONS', false),
];
