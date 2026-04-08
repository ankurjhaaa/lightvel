<?php

namespace Lightvel\Support;

class Stub
{
    /**
     * Render a stub file by replacing placeholder tokens.
     *
     * Placeholders are written as {{ token }} in the stub file.
     */
    public static function render(string $stubPath, array $replacements = []): string
    {
        $contents = file_get_contents($stubPath);

        foreach ($replacements as $key => $value) {
            $contents = str_replace('{{ ' . $key . ' }}', $value, $contents);
        }

        return $contents;
    }
}
