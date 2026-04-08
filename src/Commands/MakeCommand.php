<?php

namespace Lightvel\Commands;

use Illuminate\Console\Command;
use Illuminate\Filesystem\Filesystem;
use Lightvel\Support\Stub;
use Lightvel\Support\ViewName;

class MakeCommand extends Command
{
    protected $signature = 'make:lightvel {name : Example: pages::app.home or pages.home} {--force : Overwrite the view if it already exists}';

    protected $description = 'Create a Lightvel page/component view';

    public function handle(): int
    {
        $name = (string) $this->argument('name');
        $path = ViewName::pagePath($name);
        $layoutName = 'app';

        if (str_contains($name, '::')) {
            [, $tail] = explode('::', $name, 2);
            $layoutName = explode('.', trim($tail, '.'))[0] ?: 'app';
        }

        if (file_exists($path) && ! $this->option('force')) {
            $this->error('View already exists: ' . $path);
            return self::FAILURE;
        }

        $filesystem = new Filesystem();
        $filesystem->ensureDirectoryExists(dirname($path));

        $stub = Stub::render(__DIR__ . '/../../stubs/page.stub', [
            'layout_name' => $layoutName,
            'class_comment' => 'Put your component state and actions here.',
            'status_label' => 'Ready',
            'action_label' => 'Action',
        ]);

        $filesystem->put($path, $stub);

        $this->info('Lightvel view created: ' . $path);

        return self::SUCCESS;
    }
}
