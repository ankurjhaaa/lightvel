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
