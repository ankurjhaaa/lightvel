<?php

namespace Lightvel\Support;

class Patch
{
    public function delete(string $resource, int|string $id): array
    {
        return [
            '__patch' => [
                $resource => [
                    'delete' => [$id],
                ],
            ],
        ];
    }

    public function update(string $resource, array $item): array
    {
        return [
            '__patch' => [
                $resource => [
                    'update' => [$item],
                ],
            ],
        ];
    }

    public function insert(string $resource, array $item): array
    {
        return [
            '__patch' => [
                $resource => [
                    'insert' => [$item],
                ],
            ],
        ];
    }
}
