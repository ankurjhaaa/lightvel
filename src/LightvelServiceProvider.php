<?php

namespace Lightvel;

use Illuminate\Support\ServiceProvider;
use Lightvel\Providers\BladeServiceProvider;
use Lightvel\Providers\CommandServiceProvider;
use Lightvel\Providers\ConfigServiceProvider;
use Lightvel\Providers\RouteServiceProvider;

class LightvelServiceProvider extends ServiceProvider
{
    /**
     * Register all Lightvel sub-providers.
     */
    public function register(): void
    {
        $this->app->register(ConfigServiceProvider::class);
        $this->app->register(RouteServiceProvider::class);
        $this->app->register(BladeServiceProvider::class);
        $this->app->register(CommandServiceProvider::class);
    }
}
