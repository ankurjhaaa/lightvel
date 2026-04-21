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

    /**
     * Life-wisdom Sanskrit lines injected into new component stubs.
     * A random line is selected on each make command run.
     */
    private const SANSKRIT_QUOTES = [
        'उद्यमेन हि सिध्यन्ति कार्याणि न मनोरथैः। — केवल इच्छा नहीं, निरंतर प्रयास ही जीवन बदलता है।',
        'क्षणशः कणशश्चैव विद्यामर्थं च साधयेत्। — छोटे-छोटे कदम से ही बड़ा ज्ञान और सफलता मिलती है।',
        'सत्यं वद, धर्मं चर। — जीवन में सत्य और कर्तव्य सबसे बड़ा आधार हैं।',
        'अयं निजः परो वेति गणना लघुचेतसाम्। — उदार मनुष्य सबको अपना मानता है।',
        'न हि ज्ञानेन सदृशं पवित्रमिह विद्यते। — ज्ञान से बढ़कर कोई पवित्र शक्ति नहीं।',
        'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन। — कर्म पर ध्यान दो, फल अपने समय पर आता है।',
        'धीरे-धीरे रे मना, धैर्य से सब काम। — समय और संयम से कठिन कार्य भी पूर्ण होते हैं।',
        'विद्या ददाति विनयं। — सच्चा ज्ञान विनम्रता सिखाता है।',
    ];

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
            'sanskrit_comment' => $this->randomSanskritComment(),
        ]);

        $filesystem->put($path, $stub);

        $this->info('Lightvel view created: ' . $path);

        return self::SUCCESS;
    }

    private function randomSanskritComment(): string
    {
        $index = array_rand(self::SANSKRIT_QUOTES);

        return self::SANSKRIT_QUOTES[$index];
    }
}
