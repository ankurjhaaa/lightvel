<?php

namespace Lightvel\Commands;

use Illuminate\Console\Command;

class InstallCommand extends Command
{
    protected $signature = 'lightvel:install';

    protected $description = 'Publish Lightvel config and runtime assets';

    public function handle(): int
    {
        $this->call('vendor:publish', [
            '--tag' => 'lightvel-config',
            '--force' => true,
        ]);

        $this->call('vendor:publish', [
            '--tag' => 'lightvel-resources',
            '--force' => true,
        ]);

        $this->info('Lightvel installed.');

        return self::SUCCESS;
    }
}
