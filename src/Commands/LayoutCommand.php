<?php

namespace Lightvel\Commands;

use Illuminate\Console\Command;
use Illuminate\Filesystem\Filesystem;
use Lightvel\Support\Stub;
use Lightvel\Support\ViewName;

class LayoutCommand extends Command
{
    protected $signature = 'lightvel:layout {name : Layout name such as app or components.layout.admin} {--force : Overwrite the layout if it already exists}';

    protected $description = 'Create a Lightvel layout view';

    public function handle(): int
    {
        $name = (string) $this->argument('name');
        $path = ViewName::layoutPath($name);

        if (file_exists($path) && ! $this->option('force')) {
            $this->error('Layout already exists: ' . $path);
            return self::FAILURE;
        }

        $filesystem = new Filesystem();
        $filesystem->ensureDirectoryExists(dirname($path));

        $stub = Stub::render(__DIR__ . '/../../stubs/layout.stub', [
            'layout_title' => ucfirst(basename(str_replace('.', '/', ViewName::layout($name)))),
        ]);

        $filesystem->put($path, $stub);

        $this->info('Layout created: ' . $path);

        return self::SUCCESS;
    }
}
