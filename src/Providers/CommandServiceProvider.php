<?php

namespace Lightvel\Providers;

use Illuminate\Support\ServiceProvider;
use Lightvel\Commands\ComponentCommand;
use Lightvel\Commands\InstallCommand;
use Lightvel\Commands\LayoutCommand;
use Lightvel\Commands\MakeCommand;

class CommandServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $this->publishes([
            __DIR__ . '/../../stubs/layout.stub' => base_path('stubs/lightvel/layout.stub'),
            __DIR__ . '/../../stubs/page.stub' => base_path('stubs/lightvel/page.stub'),
            __DIR__ . '/../../resources/js/lightvel.js' => public_path('vendor/lightvel/lightvel.js'),
        ], 'lightvel-resources');

        if ($this->app->runningInConsole()) {
            $this->commands([
                InstallCommand::class,
                LayoutCommand::class,
                MakeCommand::class,
                ComponentCommand::class,
            ]);
        }
    }
}
