<?php

namespace Lightvel\Providers;

use Illuminate\Support\ServiceProvider;
use Lightvel\Support\Blade\Compiler;
use Lightvel\Support\Blade\Directives;

class BladeServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        app('blade.compiler')->prepareStringsForCompilationUsing(function ($view) {
            return Compiler::transform($view);
        });

        Directives::register();
    }
}
