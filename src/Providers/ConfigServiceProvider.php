<?php

namespace Lightvel\Providers;

use Illuminate\Support\ServiceProvider;

class ConfigServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../../config/lightvel.php', 'lightvel');
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__ . '/../../config/lightvel.php' => config_path('lightvel.php'),
        ], 'lightvel-config');
    }
}
