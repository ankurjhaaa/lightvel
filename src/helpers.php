<?php

use Lightvel\Support\Patch;

if (! function_exists('patch')) {
    function patch(): Patch
    {
        return new Patch();
    }
}
