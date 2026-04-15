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

        // Publish AI reference guide to project root
        $this->call('vendor:publish', [
            '--tag' => 'lightvel-ai',
            '--force' => true,
        ]);

        $this->info('Lightvel installed.');
        $this->info('LIGHTVEL_AI.md published to project root (share with AI coding tools).');

        return self::SUCCESS;
    }
}
