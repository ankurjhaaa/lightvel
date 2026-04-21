<?php

/**
 * Global helper function to create a Patch instance.
 *
 * Usage in component action methods:
 *   return ['message' => 'Created!', ...patch()->insert('users', $user)];
 *
 * @see \Lightvel\Support\Patch — generates __patch payloads for client-side array mutations
 */
if (! function_exists('patch')) {
    function patch(): \Lightvel\Support\Patch
    {
        return new \Lightvel\Support\Patch();
    }
}

/**
 * Global light helper.
 *
 * Primary purpose:
 *   - Prevent IDE/static-analysis warnings like
 *     "Call to unknown function light()" in Blade expressions.
 *
 * Runtime behavior:
 *   - Returns the provided value as-is.
 *   - For non-scalar values, returns empty string for safe echo contexts.
 *
 * Note:
 *   Lightvel's compiler transforms most `{{ light(...) }}` usages into
 *   reactive client bindings before Blade execution.
 */
if (! function_exists('light')) {
    function light(mixed $value = null): mixed
    {
        if (is_array($value) || is_object($value)) {
            return '';
        }

        return $value;
    }
}
